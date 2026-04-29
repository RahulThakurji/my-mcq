import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import { electromagnetism } from '../data/ebooks/physics/electromagnetism';
import { getStroke } from 'perfect-freehand';
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
  const [highlightColor, setHighlightColor] = useState('#FFF800');
  const [penWidth, setPenWidth] = useState(3);
  const [activeMenu, setActiveMenu] = useState(null);
  const [eraserMode, setEraserMode] = useState('precision');
  const [drawings, setDrawings] = useState({}); 
  const [savedContent, setSavedContent] = useState({}); 
  const [historyState, setHistoryState] = useState({});
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // --- Refs ---
  const canvasRefs = useRef({});
  const previewCanvasRefs = useRef({});
  const undoHistoryRefs = useRef({});
  const redoHistoryRefs = useRef({});
  const contentContainersRef = useRef({});
  const textRefs = useRef({});
  
  const activeCanvasIndex = useRef(null);
  const isDrawing = useRef(false);
  const isSnapped = useRef(false);
  const snapshot = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const activePointerType = useRef(null);
  const activePointers = useRef(new Set());
  const isHighlightErased = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const pendingUpdatesRef = useRef({});

  const updateHistoryState = (index) => {
    if (index === null) return;
    setHistoryState(prev => ({
      ...prev,
      [index]: {
        undo: undoHistoryRefs.current[index]?.length || 0,
        redo: redoHistoryRefs.current[index]?.length || 0
      }
    }));
  };

  // --- Toolbar Viewport Logic ---
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
        if (data.drawings !== undefined) setDrawings(data.drawings);
        if (data.savedContent !== undefined) setSavedContent(data.savedContent);
      } else if (!docSnap.exists()) {
        setDrawings({}); setSavedContent({});
        setDoc(docRef, { drawings: {}, savedContent: {} }).catch(() => {});
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
  const snapShape = () => {
    const points = strokePoints.current;
    if (points.length < 15) return;
    const start = points[0]; const end = points[points.length - 1];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let p of points) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const width = maxX - minX; const height = maxY - minY;
    const diag = Math.hypot(width, height); const gap = Math.hypot(start.x - end.x, start.y - end.y);
    const canvas = canvasRefs.current[activeCanvasIndex.current];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(preStrokeSnapshot.current, 0, 0);
    ctx.beginPath(); ctx.globalAlpha = 1.0; ctx.strokeStyle = penColor; ctx.lineWidth = penWidth;
    ctx.shadowBlur = 1; ctx.shadowColor = penColor;
    const isClosedShape = gap < diag * 0.3;
    if (isClosedShape) {
      const aspect = Math.min(width, height) / Math.max(width, height);
      if (aspect > 0.7) {
        const centerX = minX + width / 2; const centerY = minY + height / 2;
        const radius = Math.max(width, height) / 2;
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      } else { ctx.rect(minX, minY, width, height); }
    } else { ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); }
    ctx.stroke(); isSnapped.current = true;
  };

  const startDrawing = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawingMode) return;
    if (activeMenu) setActiveMenu(null);
    if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return;
    activePointerType.current = nativeEvent.pointerType;
    activeCanvasIndex.current = index;
    const canvas = canvasRefs.current[index]; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = nativeEvent.clientX - rect.left; const offsetY = nativeEvent.clientY - rect.top;
    const ctx = canvas.getContext('2d');
    isSnapped.current = false; startX.current = offsetX; startY.current = offsetY;
    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    preStrokeSnapshot.current = state; snapshot.current = state;
    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: state, html: textRefs.current[index]?.innerHTML });
    redoHistoryRefs.current[index] = [];
    strokePoints.current = [{ x: offsetX, y: offsetY, pressure: nativeEvent.pressure || 0.5 }];
    isDrawing.current = true; updateHistoryState(index);
    const previewCanvas = previewCanvasRefs.current[index];
    if (previewCanvas) {
      const ratio = window.devicePixelRatio || 1;
      previewCanvas.width = canvas.width; previewCanvas.height = canvas.height;
      const pCtx = previewCanvas.getContext('2d');
      pCtx.setTransform(1, 0, 0, 1, 0, 0); pCtx.scale(ratio, ratio); pCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const draw = (e, index) => {
    if (!isDrawing.current || activeCanvasIndex.current !== index) return;
    const canvas = canvasRefs.current[index]; const rect = canvas.getBoundingClientRect();
    const offsetX = e.nativeEvent.clientX - rect.left; const offsetY = e.nativeEvent.clientY - rect.top;
    strokePoints.current.push({ x: offsetX, y: offsetY, pressure: e.nativeEvent.pressure || 0.5 });
    const pts = strokePoints.current; const ctx = canvas.getContext('2d');
    if (drawTool === 'eraser') {
      if (eraserMode === 'stroke') { clearPage(index); isDrawing.current = false; return; }
      ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(startX.current, startY.current); ctx.lineTo(offsetX, offsetY); ctx.stroke();
      startX.current = offsetX; startY.current = offsetY;
      const textRef = textRefs.current[index];
      if (textRef) {
        const spans = textRef.querySelectorAll('span[style*="background-color"]');
        spans.forEach(span => {
          const rcts = span.getClientRects(); let hit = false;
          for (let i = 0; i < rcts.length; i++) {
            const r = rcts[i];
            if (e.nativeEvent.clientX >= r.left - 5 && e.nativeEvent.clientX <= r.right + 5 && e.nativeEvent.clientY >= r.top - 5 && e.nativeEvent.clientY <= r.bottom + 5) { hit = true; break; }
          }
          if (hit) {
            const parent = span.parentNode; while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span); isHighlightErased.current = true;
          }
        });
      }
    } else if (drawTool === 'pen') {
      if (isSnapped.current) return;
      const pCanvas = previewCanvasRefs.current[index]; const pCtx = pCanvas?.getContext('2d');
      if (pCtx) {
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        const stroke = getStroke(pts, { size: penWidth, thinning: 0.2, smoothing: 0.8, streamline: 0.8, simulatePressure: e.nativeEvent.pointerType !== 'pen' });
        const pathData = getSvgPathFromStroke(stroke); const path = new Path2D(pathData);
        pCtx.fillStyle = penColor; pCtx.fill(path);
      }
      clearTimeout(holdTimeout.current);
      holdTimeout.current = setTimeout(() => { if (isDrawing.current && !isSnapped.current) snapShape(); }, 600);
    } else {
      ctx.putImageData(snapshot.current, 0, 0); ctx.beginPath(); ctx.strokeStyle = penColor; ctx.lineWidth = penWidth;
      if (drawTool === 'line') { ctx.moveTo(startX.current, startY.current); ctx.lineTo(offsetX, offsetY); }
      else if (drawTool === 'rectangle') { ctx.rect(startX.current, startY.current, offsetX - startX.current, offsetY - startY.current); }
      else if (drawTool === 'circle') { ctx.arc(startX.current, startY.current, Math.hypot(offsetX - startX.current, offsetY - startY.current), 0, 2 * Math.PI); }
      ctx.stroke();
    }
  };

  const stopDrawing = (index) => {
    if (activeCanvasIndex.current !== index) return;
    clearTimeout(holdTimeout.current); isDrawing.current = false;
    const canvas = canvasRefs.current[index]; const previewCanvas = previewCanvasRefs.current[index];
    if (previewCanvas && canvas && drawTool === 'pen') {
      const ctx = canvas.getContext('2d');
      ctx.drawImage(previewCanvas, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    if (canvas) {
      const url = canvas.toDataURL();
      setDrawings(prev => { const next = { ...prev, [index]: url }; if (!isHighlightErased.current) queueUpdate({ drawings: next }); return next; });
      canvas.dataset.loaded = url;
    }
    if (isHighlightErased.current) {
      setSavedContent(prev => { const next = { ...prev, [index]: textRefs.current[index].innerHTML }; queueUpdate({ drawings, savedContent: next }); return next; });
      isHighlightErased.current = false;
    }
    updateHistoryState(index); activeCanvasIndex.current = null;
  };

  const abortDrawing = (index) => {
    isDrawing.current = false; activeCanvasIndex.current = null; clearTimeout(holdTimeout.current);
    const canvas = canvasRefs.current[index]; const pCanvas = previewCanvasRefs.current[index];
    if (canvas && preStrokeSnapshot.current) canvas.getContext('2d').putImageData(preStrokeSnapshot.current, 0, 0);
    if (pCanvas) pCanvas.getContext('2d').clearRect(0, 0, pCanvas.width, pCanvas.height);
  };

  const handleUndo = (index) => {
    if (!undoHistoryRefs.current[index]?.length) return;
    const canvas = canvasRefs.current[index]; const ctx = canvas.getContext('2d');
    if (!redoHistoryRefs.current[index]) redoHistoryRefs.current[index] = [];
    redoHistoryRefs.current[index].push({ canvas: ctx.getImageData(0, 0, canvas.width, canvas.height), html: textRefs.current[index]?.innerHTML });
    const prevState = undoHistoryRefs.current[index].pop();
    if (prevState.canvas) ctx.putImageData(prevState.canvas, 0, 0);
    if (prevState.html !== undefined) textRefs.current[index].innerHTML = prevState.html;
    const url = canvas.toDataURL(); updateHistoryState(index);
    setDrawings(prev => { const next = { ...prev, [index]: url }; setSavedContent(prevC => { const nextC = { ...prevC, [index]: textRefs.current[index].innerHTML }; queueUpdate({ drawings: next, savedContent: nextC }); return nextC; }); return next; });
  };

  const handleRedo = (index) => {
    if (!redoHistoryRefs.current[index]?.length) return;
    const canvas = canvasRefs.current[index]; const ctx = canvas.getContext('2d');
    undoHistoryRefs.current[index].push({ canvas: ctx.getImageData(0, 0, canvas.width, canvas.height), html: textRefs.current[index]?.innerHTML });
    const nextState = redoHistoryRefs.current[index].pop();
    if (nextState.canvas) ctx.putImageData(nextState.canvas, 0, 0);
    if (nextState.html !== undefined) textRefs.current[index].innerHTML = nextState.html;
    const url = canvas.toDataURL(); updateHistoryState(index);
    setDrawings(prev => { const next = { ...prev, [index]: url }; setSavedContent(prevC => { const nextC = { ...prevC, [index]: textRefs.current[index].innerHTML }; queueUpdate({ drawings: next, savedContent: nextC }); return nextC; }); return next; });
  };

  const clearPage = (index) => {
    const canvas = canvasRefs.current[index]; if (canvas) { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); canvas.dataset.loaded = "empty"; }
    setDrawings(prev => { const next = { ...prev }; delete next[index]; queueUpdate({ drawings: next }); return next; });
  };

  // --- Highlighter Logic ---
  const handleMouseUp = (index) => {
    if (!isHighlightMode) return;
    const selection = window.getSelection(); if (!selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0); const textRef = textRefs.current[index];
    if (!textRef || !textRef.contains(range.commonAncestorContainer)) return;
    const span = document.createElement('span'); span.style.backgroundColor = highlightColor; span.style.borderRadius = '3px';
    try { range.surroundContents(span); } catch { return; }
    selection.removeAllRanges();
    const nextSavedContent = { ...savedContent, [index]: textRef.innerHTML };
    setSavedContent(nextSavedContent); queueUpdate({ savedContent: nextSavedContent });
  };

  // --- Auto-loader & Resize ---
  useEffect(() => {
    if (!chapterData || !isInitialLoadComplete) return;
    chapterData.content.forEach((_, index) => {
      const container = contentContainersRef.current[index]; const canvas = canvasRefs.current[index];
      if (canvas && container) {
        const ratio = window.devicePixelRatio || 1;
        const tw = Math.round(container.offsetWidth * ratio); const th = Math.round(container.offsetHeight * ratio);
        if (canvas.width !== tw || canvas.height !== th || (drawings[index] && canvas.dataset.loaded !== drawings[index])) {
          canvas.width = tw; canvas.height = th; canvas.style.width = `${container.offsetWidth}px`; canvas.style.height = `${container.offsetHeight}px`;
          const ctx = canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(ratio, ratio); ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (drawings[index]) { const img = new Image(); img.src = drawings[index]; img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, container.offsetWidth, container.offsetHeight); }; canvas.dataset.loaded = drawings[index]; }
        }
      }
    });
  }, [drawings, isInitialLoadComplete]);

  const getContent = () => {
    if (ebookId === '1') return historicalBackground; if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContent();

  const renderContent = (item, index) => {
    const contentText = savedContent[index] || (item.type === 'list' ? `${item.items.map(li => `• ${li}`).join('\n')}` : item.text);
    let finalContent;
    if (item.type === 'h2') finalContent = <h2 style={{ color: '#1a237e', marginTop: '2rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}><LatexRenderer>{contentText}</LatexRenderer></h2>;
    else if (item.type === 'h3') finalContent = <h3 style={{ color: '#283593', marginTop: '1.5rem' }}><LatexRenderer>{contentText}</LatexRenderer></h3>;
    else if (item.type === 'p') finalContent = <p style={{ lineHeight: '1.8', color: '#333', marginBottom: '1.2rem', textAlign: 'justify' }}><LatexRenderer>{contentText}</LatexRenderer></p>;
    else if (item.type === 'list') finalContent = <div style={{ marginBottom: '1.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#444' }}><LatexRenderer>{contentText}</LatexRenderer></div>;
    
    return (
      <div key={index} ref={el => contentContainersRef.current[index] = el}
        onPointerDown={(e) => {
          activePointers.current.add(e.pointerId); if (activePointers.current.size > 1) { abortDrawing(index); return; }
          if (isDrawingMode) { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { } startDrawing(e, index); }
        }}
        onPointerMove={(e) => { if (activePointers.current.size > 1) { abortDrawing(index); return; } if (isDrawing.current) draw(e, index); }}
        onPointerUp={(e) => { activePointers.current.delete(e.pointerId); if (isDrawing.current) { try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { } stopDrawing(index); } }}
        onPointerLeave={(e) => { if (isDrawing.current && activePointers.current.size <= 1) stopDrawing(index); }}
        onPointerCancel={(e) => { activePointers.current.delete(e.pointerId); abortDrawing(index); }}
        style={{ position: 'relative', marginBottom: '10px', touchAction: isDrawingMode ? 'pinch-zoom' : 'auto' }}
      >
        <div ref={el => textRefs.current[index] = el} onPointerUp={() => handleMouseUp(index)} style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none' }}>{finalContent}</div>
        {isInitialLoadComplete && (
          <><canvas ref={el => canvasRefs.current[index] = el} style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? 100 : -1, pointerEvents: 'none' }} />
          <canvas ref={el => previewCanvasRefs.current[index] = el} style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? 101 : -1, pointerEvents: "none" }} /></>
        )}
      </div>
    );
  };

  const tb = {
    wrap: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#2f3542', borderRadius: '50px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '1.5px solid rgba(255,255,255,0.1)', zIndex: 10001, flexWrap: "nowrap" },
    pill: (active, color, activeColor) => ({ padding: '6px 14px', borderRadius: '25px', border: 'none', background: active ? (activeColor || color) : 'transparent', color: active ? 'white' : '#ccc', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }),
    toolBtn: (active) => ({ padding: '8px 12px', borderRadius: '8px', border: 'none', background: active ? 'rgba(255,255,255,0.1)' : 'transparent', color: 'white', cursor: 'pointer', textAlign: 'left', display: 'block', width: '100%', fontSize: '14px' }),
    undoBtn: (active) => ({ padding: '6px 12px', background: 'transparent', border: 'none', color: active ? 'white' : '#555', cursor: active ? 'pointer' : 'not-allowed', fontSize: '1.2rem' }),
    dot: (active, color) => ({ width: '18px', height: '18px', borderRadius: '50%', background: color, border: active ? '2px solid white' : 'none', cursor: 'pointer' }),
    card: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.05)', padding: '4px 8px', borderRadius: '20px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' },
    sep: { width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }
  };
  const popoverStyle = { position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: '10px', background: '#2f3542', padding: '10px', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px', zIndex: 10002 };

  const penColors = [{ c: '#FF003C', n: 'Red' }, { c: '#00D0FF', n: 'Cyan' }, { c: '#00FF33', n: 'Green' }, { c: '#FF8800', n: 'Orange' }, { c: '#D500F9', n: 'Purple' }, { c: '#111111', n: 'Black' }, { c: '#FFFFFF', n: 'White' }];
  const hlColors = [{ c: '#FFF800', n: 'Yellow' }, { c: '#00FF66', n: 'Green' }, { c: '#FF007F', n: 'Pink' }, { c: '#00E5FF', n: 'Blue' }];
  const tools = [{ v: 'pen', icon: '✏️', label: 'Pen' }, { v: 'line', icon: '╱', label: 'Line' }, { v: 'rectangle', icon: '▭', label: 'Rect' }, { v: 'circle', icon: '◯', label: 'Circle' }];

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={toolbarStyle}>
        <div style={tb.wrap}>
          <button onClick={() => { if (isDrawingMode && drawTool !== 'eraser') setIsDrawingMode(false); else { setIsDrawingMode(true); setIsHighlightMode(false); if (drawTool === 'eraser') setDrawTool('pen'); setActiveMenu(null); } }} style={tb.pill(isDrawingMode && drawTool !== 'eraser', '#7c6fff', '#4a90d9')}>✏️ Pen</button>
          <button onClick={() => { setIsHighlightMode(!isHighlightMode); setIsDrawingMode(false); setActiveMenu(null); }} style={tb.pill(isHighlightMode, '#ff9f43', '#ee5a24')}>🖍️ Highlighter</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => { if (isDrawingMode && drawTool === 'eraser') setActiveMenu(activeMenu === 'eraser' ? null : 'eraser'); else { setIsDrawingMode(true); setIsHighlightMode(false); setDrawTool('eraser'); setActiveMenu(null); } }} style={tb.pill(isDrawingMode && drawTool === 'eraser', '#ff4757', '#c0392b')}>🧽 {eraserMode === 'precision' ? 'Precision' : 'Stroke'} Eraser ▼</button>
            {activeMenu === 'eraser' && (
              <div style={popoverStyle}>
                <button onClick={() => { setEraserMode('precision'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'precision')}>🎯 Precision Eraser</button>
                <button onClick={() => { setEraserMode('stroke'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'stroke')}>🌊 Stroke Eraser</button>
              </div>
            )}
          </div>
          <div style={tb.sep} />
          <button onClick={() => handleUndo(activeCanvasIndex.current || 0)} style={tb.undoBtn(true)}>↩</button>
          <button onClick={() => handleRedo(activeCanvasIndex.current || 0)} style={tb.undoBtn(true)}>↪</button>
          <div style={tb.sep} />
          <button onClick={manualSaveToCloud} style={tb.pill(hasUnsavedChanges, '#ff9800', '#e67e22')} disabled={isSaving}>{isSaving ? '⏳' : '💾'} {hasUnsavedChanges ? 'Save' : 'Saved'}</button>
          
          {isHighlightMode && (
            <><div style={tb.sep} /><div style={{ position: 'relative' }}>
              <button onClick={() => setActiveMenu(activeMenu === 'hColor' ? null : 'hColor')} style={tb.card}><div style={tb.dot(true, highlightColor)} /> ▼</button>
              {activeMenu === 'hColor' && <div style={popoverStyle}>{hlColors.map(({ c, n }) => <button key={c} title={n} onClick={() => { setHighlightColor(c); setActiveMenu(null); }} style={tb.dot(highlightColor === c, c)} />)}</div>}
            </div></>
          )}

          {isDrawingMode && drawTool !== 'eraser' && (
            <><div style={tb.sep} /><div style={{ position: 'relative' }}>
              <button onClick={() => setActiveMenu(activeMenu === 'tool' ? null : 'tool')} style={tb.toolBtn(true)}>{tools.find(t => t.v === drawTool)?.icon} ▼</button>
              {activeMenu === 'tool' && <div style={popoverStyle}>{tools.map(({ v, icon, label }) => <button key={v} title={label} onClick={() => { setDrawTool(v); setActiveMenu(null); }} style={tb.toolBtn(drawTool === v)}>{icon}</button>)}</div>}
            </div>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setActiveMenu(activeMenu === 'color' ? null : 'color')} style={tb.card}><div style={tb.dot(true, penColor)} /> ▼</button>
              {activeMenu === 'color' && <div style={popoverStyle}>{penColors.map(({ c, n }) => <button key={c} title={n} onClick={() => { setPenColor(c); setActiveMenu(null); }} style={tb.dot(penColor === c, c)} />)}</div>}
            </div>
            <div style={{ position: 'relative' }}>
              <button onClick={() => setActiveMenu(activeMenu === 'size' ? null : 'size')} style={tb.card}><div style={{ width: '8px', height: '8px', backgroundColor: penColor, borderRadius: '50%' }} /><span style={{ fontSize: "0.7rem", color: "#ccc" }}>{penWidth}</span> ▼</button>
              {activeMenu === 'size' && <div style={{ ...popoverStyle, padding: "12px", width: "160px" }}><input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c6fff" }} /></div>}
            </div></>
          )}
        </div>
      </div>

      <div id="ebook-card" style={{ maxWidth: '750px', margin: '40px auto 0', background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #eee', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div><span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span><h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1></div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>
        <div style={{ fontSize: '1.1rem' }}>{chapterData.content.map((item, index) => renderContent(item, index))}</div>
        <div style={{ marginTop: '4rem', paddingTop: '2rem', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
          <button style={{ padding: '10px 20px', background: '#eee', border: 'none', borderRadius: '6px', color: '#999', cursor: 'not-allowed' }}>← Previous Chapter</button>
          <button onClick={() => alert("Next chapter coming soon!")} style={{ padding: '10px 20px', background: '#1a237e', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Next Chapter →</button>
        </div>
      </div>
    </div>
  );
}

export default EbookReader;