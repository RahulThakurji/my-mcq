import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getStroke } from 'perfect-freehand';
import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import { electromagnetism } from '../data/ebooks/physics/electromagnetism';
import LatexRenderer from '../components/LatexRenderer';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

function getSvgPathFromStroke(stroke) {
  if (!stroke.length) return "";
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length];
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
      return acc;
    },
    ["M", ...stroke[0], "Q"]
  );
  d.push("Z");
  return d.join(" ");
}

function EbookReader() {
  const { ebookId, chapterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // --- States ---
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [drawTool, setDrawTool] = useState('pen');
  const [penColor, setPenColor] = useState('#FF003C');
  const [penWidth, setPenWidth] = useState(3);
  const [activeMenu, setActiveMenu] = useState(null);
  const [eraserMode, setEraserMode] = useState('precision');
  const [drawingData, setDrawingData] = useState(null); // Single drawing for the whole page
  const [savedContent, setSavedContent] = useState({}); // Highlights still need to be segmented for precision
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // --- Refs ---
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const undoHistoryRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const contentAreaRef = useRef(null);
  const textRefs = useRef({});
  const isDrawing = useRef(false);
  const pendingUpdatesRef = useRef({});
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePointerType = useRef(null);
  const isSnapped = useRef(false);
  const isHighlightErased = useRef(false);

  const [toolbarStyle, setToolbarStyle] = useState({
    position: 'fixed', top: '15px', left: '50%', transform: 'translateX(-50%)',
    zIndex: 10000, width: 'max-content'
  });

  useEffect(() => {
    const updateToolbar = () => {
      if (window.visualViewport) {
        const vv = window.visualViewport;
        setToolbarStyle({
          position: 'fixed',
          top: `${vv.offsetTop + 15}px`,
          left: `${vv.offsetLeft + (vv.width / 2)}px`,
          transform: `translate(-50%, 0) scale(${1 / vv.scale})`,
          transformOrigin: 'top center', zIndex: 10000, width: 'max-content'
        });
      }
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', updateToolbar);
      window.visualViewport.addEventListener('scroll', updateToolbar);
      updateToolbar();
    }
    return () => {
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', updateToolbar);
        window.visualViewport.removeEventListener('scroll', updateToolbar);
      }
    };
  }, []);

  // --- Persistence ---
  useEffect(() => {
    if (!user || !ebookId || !chapterId) { setIsInitialLoadComplete(true); return; }
    const docRef = doc(db, 'users', user.uid, 'ebooks', `${ebookId}-${chapterId}`);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.drawingData !== undefined) setDrawingData(data.drawingData);
        if (data.savedContent !== undefined) setSavedContent(data.savedContent);
      } else if (!docSnap.exists()) {
        setDrawingData(null); setSavedContent({});
        setDoc(docRef, { drawingData: null, savedContent: {} }).catch(() => {});
      }
      setIsInitialLoadComplete(true);
    }, () => setIsInitialLoadComplete(true));
    return () => unsubscribe();
  }, [user, ebookId, chapterId]);

  const queueUpdate = (updates) => {
    if (!user) return;
    pendingUpdatesRef.current = { ...pendingUpdatesRef.current, ...updates };
    setHasUnsavedChanges(true);
  };

  const manualSaveToCloud = async () => {
    if (!user || Object.keys(pendingUpdatesRef.current).length === 0) return;
    setIsSaving(true);
    const updatesToApply = { ...pendingUpdatesRef.current };
    pendingUpdatesRef.current = {};
    const docRef = doc(db, 'users', user.uid, 'ebooks', `${ebookId}-${chapterId}`);
    try {
      await updateDoc(docRef, updatesToApply);
      setHasUnsavedChanges(false);
    } catch {
      pendingUpdatesRef.current = { ...updatesToApply, ...pendingUpdatesRef.current };
      setHasUnsavedChanges(true);
    } finally { setIsSaving(false); }
  };

  // --- Drawing Logic ---
  const startDrawing = (e) => {
    const { nativeEvent } = e;
    if (!isDrawingMode) return;
    if (activeMenu) setActiveMenu(null);
    if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return;
    activePointerType.current = nativeEvent.pointerType;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = nativeEvent.clientX - rect.left;
    const offsetY = nativeEvent.clientY - rect.top;
    const ctx = canvas.getContext('2d');
    preStrokeSnapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    undoHistoryRef.current.push({ canvas: preStrokeSnapshot.current, html: JSON.stringify(savedContent) });
    if (undoHistoryRef.current.length > 20) undoHistoryRef.current.shift();
    redoHistoryRef.current = [];
    strokePoints.current = [{ x: offsetX, y: offsetY, pressure: nativeEvent.pressure || 0.5 }];
    isDrawing.current = true; isSnapped.current = false;
    const pCanvas = previewCanvasRef.current;
    if (pCanvas) {
      const ratio = window.devicePixelRatio || 1;
      pCanvas.width = canvas.width; pCanvas.height = canvas.height;
      const pCtx = pCanvas.getContext('2d');
      pCtx.setTransform(1, 0, 0, 1, 0, 0); pCtx.scale(ratio, ratio); pCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const draw = (e) => {
    if (!isDrawing.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const offsetX = e.nativeEvent.clientX - rect.left;
    const offsetY = e.nativeEvent.clientY - rect.top;
    strokePoints.current.push({ x: offsetX, y: offsetY, pressure: e.nativeEvent.pressure || 0.5 });
    const pts = strokePoints.current;
    const ctx = canvasRef.current.getContext('2d');

    if (drawTool === 'eraser') {
      if (eraserMode === 'stroke') { 
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        setDrawingData(null); queueUpdate({ drawingData: null });
        isDrawing.current = false; return; 
      }
      ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (pts.length >= 3) {
        const mid1 = { x: (pts[pts.length - 3].x + pts[pts.length - 2].x) / 2, y: (pts[pts.length - 3].y + pts[pts.length - 2].y) / 2 };
        const mid2 = { x: (pts[pts.length - 2].x + offsetX) / 2, y: (pts[pts.length - 2].y + offsetY) / 2 };
        ctx.beginPath(); ctx.moveTo(mid1.x, mid1.y); ctx.quadraticCurveTo(pts[pts.length - 2].x, pts[pts.length - 2].y, mid2.x, mid2.y); ctx.stroke();
      }
      // Highlight erasing logic
      Object.keys(textRefs.current).forEach(index => {
        const textRef = textRefs.current[index];
        if (textRef) {
          const spans = textRef.querySelectorAll('span[style*="background-color"]');
          spans.forEach(span => {
            const rects = span.getClientRects();
            let hit = false;
            for (let i = 0; i < rects.length; i++) {
              const r = rects[i];
              if (e.nativeEvent.clientX >= r.left - 5 && e.nativeEvent.clientX <= r.right + 5 && e.nativeEvent.clientY >= r.top - 5 && e.nativeEvent.clientY <= r.bottom + 5) { hit = true; break; }
            }
            if (hit) {
              const parent = span.parentNode; while (span.firstChild) parent.insertBefore(span.firstChild, span);
              parent.removeChild(span); isHighlightErased.current = true;
            }
          });
        }
      });
    } else if (drawTool === 'pen') {
      if (isSnapped.current) return;
      const pCtx = previewCanvasRef.current?.getContext('2d');
      if (pCtx) {
        pCtx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        const stroke = getStroke(pts, { size: penWidth, thinning: 0.2, smoothing: 0.8, streamline: 0.8, simulatePressure: e.nativeEvent.pointerType !== 'pen' });
        pCtx.globalCompositeOperation = 'source-over'; pCtx.fillStyle = penColor; pCtx.fill(new Path2D(getSvgPathFromStroke(stroke)));
      }
    } else {
      ctx.putImageData(preStrokeSnapshot.current, 0, 0); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1.0; ctx.strokeStyle = penColor; ctx.lineWidth = penWidth; ctx.shadowBlur = 1; ctx.shadowColor = penColor; ctx.beginPath();
      if (drawTool === 'line') { ctx.moveTo(strokePoints.current[0].x, strokePoints.current[0].y); ctx.lineTo(offsetX, offsetY); }
      else if (drawTool === 'rectangle') { ctx.rect(strokePoints.current[0].x, strokePoints.current[0].y, offsetX - strokePoints.current[0].x, offsetY - strokePoints.current[0].y); }
      else if (drawTool === 'circle') { ctx.arc(strokePoints.current[0].x, strokePoints.current[0].y, Math.hypot(offsetX - strokePoints.current[0].x, offsetY - strokePoints.current[0].y), 0, 2*Math.PI); }
      ctx.stroke();
    }
  };

  const stopDrawing = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const canvas = canvasRef.current;
    const previewCanvas = previewCanvasRef.current;
    if (previewCanvas && canvas && drawTool === 'pen') {
      canvas.getContext('2d').drawImage(previewCanvas, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    if (canvas) {
      const url = canvas.toDataURL();
      setDrawingData(url);
      if (!isHighlightErased.current) queueUpdate({ drawingData: url });
    }
    if (isHighlightErased.current) {
      const nextSavedContent = {};
      Object.keys(textRefs.current).forEach(idx => { nextSavedContent[idx] = textRefs.current[idx].innerHTML; });
      setSavedContent(nextSavedContent);
      queueUpdate({ drawingData: canvas.toDataURL(), savedContent: nextSavedContent });
      isHighlightErased.current = false;
    }
  };

  const handleUndo = () => {
    if (!undoHistoryRef.current.length) return;
    const canvas = canvasRef.current; const ctx = canvas.getContext('2d');
    redoHistoryRef.current.push({ canvas: ctx.getImageData(0, 0, canvas.width, canvas.height), html: JSON.stringify(savedContent) });
    const prevState = undoHistoryRef.current.pop();
    if (prevState.canvas) ctx.putImageData(prevState.canvas, 0, 0);
    if (prevState.html) setSavedContent(JSON.parse(prevState.html));
    const url = canvas.toDataURL();
    setDrawingData(url); queueUpdate({ drawingData: url, savedContent: JSON.parse(prevState.html || '{}') });
  };

  // --- Highlighter ---
  const handleMouseUp = (index) => {
    if (!isHighlightMode) return;
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const textRef = textRefs.current[index];
    if (!textRef || !textRef.contains(range.commonAncestorContainer)) return;
    const span = document.createElement('span');
    span.style.backgroundColor = highlightColor; span.style.borderRadius = '3px';
    try { range.surroundContents(span); } catch { return; }
    selection.removeAllRanges();
    const nextSavedContent = { ...savedContent, [index]: textRef.innerHTML };
    setSavedContent(nextSavedContent); queueUpdate({ savedContent: nextSavedContent });
  };

  const clearHighlight = (index) => {
    setSavedContent(prev => { const next = { ...prev }; delete next[index]; queueUpdate({ savedContent: next }); return next; });
  };

  // --- Auto-loader & Resize ---
  useEffect(() => {
    if (!isInitialLoadComplete || !contentAreaRef.current) return;
    const container = contentAreaRef.current;
    const canvas = canvasRef.current;
    if (canvas && container) {
      const ratio = window.devicePixelRatio || 1;
      const tw = Math.round(container.offsetWidth * ratio);
      const th = Math.round(container.offsetHeight * ratio);
      if (canvas.width !== tw || canvas.height !== th || (drawingData && canvas.dataset.loaded !== drawingData)) {
        canvas.width = tw; canvas.height = th;
        canvas.style.width = `${container.offsetWidth}px`; canvas.style.height = `${container.offsetHeight}px`;
        const ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (drawingData) {
          const img = new Image(); img.src = drawingData;
          img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, container.offsetWidth, container.offsetHeight); };
          canvas.dataset.loaded = drawingData;
        }
      }
    }
  }, [drawingData, isInitialLoadComplete]);

  const getContent = () => {
    if (ebookId === '1') return historicalBackground;
    if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContent();

  const renderContent = (item, index) => {
    const contentHtml = savedContent[index] || `<span>${(item.type === 'list' ? `<ul>${item.items.map(li => `<li>${li}</li>`).join('')}</ul>` : item.text)}</span>`;
    let finalContent;
    if (item.type === 'h2') finalContent = <h2 style={{ color: '#1a237e', marginTop: '2rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: contentHtml }} />;
    else if (item.type === 'h3') finalContent = <h3 style={{ color: '#283593', marginTop: '1.5rem' }} dangerouslySetInnerHTML={{ __html: contentHtml }} />;
    else if (item.type === 'p') finalContent = <p style={{ lineHeight: '1.8', color: '#333', marginBottom: '1.2rem', textAlign: 'justify' }} dangerouslySetInnerHTML={{ __html: contentHtml }} />;
    else if (item.type === 'list') finalContent = <div style={{ marginBottom: '1.5rem', paddingLeft: '1.5rem' }} dangerouslySetInnerHTML={{ __html: contentHtml }} />;
    return <div key={index} ref={el => textRefs.current[index] = el} onPointerUp={() => handleMouseUp(index)} style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none' }}>{finalContent}</div>;
  };

  const tb = {
    card: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#ffffff', borderRadius: '50px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', border: '1px solid #e0e0e0' },
    pill: (active, color, activeColor) => ({ padding: '6px 14px', borderRadius: '25px', border: 'none', background: active ? (activeColor || color) : '#f1f2f6', color: active ? 'white' : '#2f3542', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }),
    toolBtn: (active) => ({ padding: '8px 12px', borderRadius: '8px', border: 'none', background: active ? '#7c6fff' : 'transparent', color: active ? 'white' : '#333', cursor: 'pointer', textAlign: 'left', display: 'block', width: '100%', fontSize: '14px' }),
    sep: { width: '1px', height: '24px', background: '#ddd', margin: '0 4px' }
  };
  const popoverStyle = { position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '10px', background: 'white', padding: '10px', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.2)', border: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px', zIndex: 10001 };

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={toolbarStyle}>
        <div style={tb.card}>
          <button onClick={() => { setIsDrawingMode(!isDrawingMode); setIsHighlightMode(false); }} style={tb.pill(isDrawingMode, '#7c6fff')}>{isDrawingMode ? '✅ Done' : '✏️ Draw'}</button>
          <button onClick={() => { setIsHighlightMode(!isHighlightMode); setIsDrawingMode(false); }} style={tb.pill(isHighlightMode, '#7c6fff')}>🖍️ Highlight</button>
          {(isDrawingMode || isHighlightMode) && (
            <>
              <div style={tb.sep} />
              {isDrawingMode && (
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setActiveMenu(activeMenu === 'tools' ? null : 'tools')} style={tb.pill(drawTool !== 'eraser', '#7c6fff')}>🛠️ Tools ▼</button>
                  {activeMenu === 'tools' && (
                    <div style={popoverStyle}>
                      <button onClick={() => { setDrawTool('pen'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'pen')}>✏️ Pen</button>
                      <button onClick={() => { setDrawTool('line'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'line')}>📏 Line</button>
                      <button onClick={() => { setDrawTool('rectangle'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'rectangle')}>⬜ Rectangle</button>
                      <button onClick={() => { setDrawTool('circle'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'circle')}>⭕ Circle</button>
                    </div>
                  )}
                </div>
              )}
              <div style={{ position: 'relative' }}>
                <button onClick={() => { if (drawTool === 'eraser') setActiveMenu(activeMenu === 'eraser' ? null : 'eraser'); else { setDrawTool('eraser'); setActiveMenu(null); setIsDrawingMode(true); } }} style={tb.pill(drawTool === 'eraser', '#ff4757', '#c0392b')}>🧽 Eraser ▼</button>
                {activeMenu === 'eraser' && (
                  <div style={popoverStyle}>
                    <button onClick={() => { setEraserMode('precision'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'precision')}>🎯 Precision</button>
                    <button onClick={() => { setEraserMode('stroke'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'stroke')}>🌊 Clear All</button>
                  </div>
                )}
              </div>
              <div style={tb.sep} /><button onClick={handleUndo} style={tb.pill(false, '#f1f2f6')}>↩️ Undo</button>
              <div style={tb.sep} /><button onClick={manualSaveToCloud} style={tb.pill(hasUnsavedChanges, '#2ed573', '#27ae60')} disabled={isSaving}>{isSaving ? '⏳ Saving...' : hasUnsavedChanges ? '💾 Save Now' : '☁️ Saved'}</button>
            </>
          )}
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '40px auto 0', background: 'white', padding: '3rem', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div><span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span><h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1></div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>

        <div ref={contentAreaRef} style={{ fontSize: '1.1rem', position: 'relative' }}>
          {chapterData.content.map((item, index) => renderContent(item, index))}
          
          {isInitialLoadComplete && (
            <>
              <canvas 
                ref={canvasRef} 
                onPointerDown={startDrawing} onPointerMove={draw} onPointerUp={stopDrawing} onPointerLeave={stopDrawing}
                style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? 100 : -1, touchAction: isDrawingMode ? "none" : "auto", cursor: isDrawingMode ? 'crosshair' : 'default' }} 
              />
              <canvas 
                ref={previewCanvasRef} 
                style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? 101 : -1, pointerEvents: "none" }} 
              />
            </>
          )}
        </div>

        <div style={{ marginTop: '4rem', paddingTop: '2rem', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
          <button style={{ padding: '10px 20px', background: '#eee', border: 'none', borderRadius: '6px', color: '#999', cursor: 'not-allowed' }}>← Previous Chapter</button>
          <button onClick={() => alert("Next chapter coming soon!")} style={{ padding: '10px 20px', background: '#1a237e', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Next Chapter →</button>
        </div>
      </div>
    </div>
  );
}

export default EbookReader;
