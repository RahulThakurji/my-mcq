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

  // --- Drawing & Highlight State ---
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [drawTool, setDrawTool] = useState('pen');
  const [penColor, setPenColor] = useState('#FF003C');
  const [penWidth, setPenWidth] = useState(3);
  const [activeMenu, setActiveMenu] = useState(null);
  const [eraserMode, setEraserMode] = useState('precision');
  const [drawings, setDrawings] = useState({});
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // --- Refs ---
  const canvasRefs = useRef({});
  const previewCanvasRefs = useRef({});
  const undoHistoryRefs = useRef({});
  const redoHistoryRefs = useRef({});
  const contentContainersRef = useRef({});
  const activeCanvasIndex = useRef(null);
  const isDrawing = useRef(false);
  const pendingUpdatesRef = useRef({});
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePointerType = useRef(null);

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
      } else if (!docSnap.exists()) {
        setDrawings({});
        setDoc(docRef, { drawings: {} }).catch(() => {});
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
  const startDrawing = (e, index) => {
    const { nativeEvent } = e;
    if (!isDrawingMode) return;
    if (activeMenu) setActiveMenu(null);
    if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return;
    activePointerType.current = nativeEvent.pointerType;
    activeCanvasIndex.current = index;
    const canvas = canvasRefs.current[index];
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = nativeEvent.clientX - rect.left;
    const offsetY = nativeEvent.clientY - rect.top;
    const ctx = canvas.getContext('2d');
    preStrokeSnapshot.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (!undoHistoryRefs.current[index]) undoHistoryRefs.current[index] = [];
    undoHistoryRefs.current[index].push({ canvas: preStrokeSnapshot.current });
    redoHistoryRefs.current[index] = [];
    strokePoints.current = [{ x: offsetX, y: offsetY, pressure: nativeEvent.pressure || 0.5 }];
    isDrawing.current = true;
    const previewCanvas = previewCanvasRefs.current[index];
    if (previewCanvas) {
      const ratio = window.devicePixelRatio || 1;
      previewCanvas.width = canvas.width; previewCanvas.height = canvas.height;
      const pCtx = previewCanvas.getContext('2d');
      pCtx.setTransform(1, 0, 0, 1, 0, 0); pCtx.scale(ratio, ratio);
      pCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const draw = (e, index) => {
    if (!isDrawing.current || activeCanvasIndex.current !== index) return;
    const canvas = canvasRefs.current[index];
    const rect = canvas.getBoundingClientRect();
    const offsetX = e.nativeEvent.clientX - rect.left;
    const offsetY = e.nativeEvent.clientY - rect.top;
    strokePoints.current.push({ x: offsetX, y: offsetY, pressure: e.nativeEvent.pressure || 0.5 });
    const pts = strokePoints.current;
    const ctx = canvas.getContext('2d');

    if (drawTool === 'eraser') {
      if (eraserMode === 'stroke') { clearPage(index); isDrawing.current = false; return; }
      ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (pts.length >= 3) {
        const mid1 = { x: (pts[pts.length - 3].x + pts[pts.length - 2].x) / 2, y: (pts[pts.length - 3].y + pts[pts.length - 2].y) / 2 };
        const mid2 = { x: (pts[pts.length - 2].x + offsetX) / 2, y: (pts[pts.length - 2].y + offsetY) / 2 };
        ctx.beginPath(); ctx.moveTo(mid1.x, mid1.y); ctx.quadraticCurveTo(pts[pts.length - 2].x, pts[pts.length - 2].y, mid2.x, mid2.y); ctx.stroke();
      }
    } else if (drawTool === 'pen') {
      const pCtx = previewCanvasRefs.current[index]?.getContext('2d');
      if (pCtx) {
        pCtx.clearRect(0, 0, canvas.width, canvas.height);
        const stroke = getStroke(pts, { size: penWidth, thinning: 0.2, smoothing: 0.8, streamline: 0.8, simulatePressure: e.nativeEvent.pointerType !== 'pen' });
        const path = new Path2D(getSvgPathFromStroke(stroke));
        pCtx.globalCompositeOperation = 'source-over'; pCtx.fillStyle = penColor; pCtx.fill(path);
      }
    }
  };

  const stopDrawing = (index) => {
    if (activeCanvasIndex.current !== index) return;
    isDrawing.current = false;
    const canvas = canvasRefs.current[index];
    const previewCanvas = previewCanvasRefs.current[index];
    if (previewCanvas && canvas && drawTool === 'pen') {
      canvas.getContext('2d').drawImage(previewCanvas, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      previewCanvas.getContext('2d').clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
    if (canvas) {
      const url = canvas.toDataURL();
      setDrawings(prev => {
        const next = { ...prev, [index]: url };
        queueUpdate({ drawings: next });
        return next;
      });
    }
    activeCanvasIndex.current = null;
  };

  const clearPage = (index) => {
    const canvas = canvasRefs.current[index];
    if (canvas) {
      canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
      setDrawings(prev => { const next = { ...prev }; delete next[index]; queueUpdate({ drawings: next }); return next; });
    }
  };

  const handleUndo = (index) => {
    if (!undoHistoryRefs.current[index]?.length) return;
    const canvas = canvasRefs.current[index];
    const ctx = canvas.getContext('2d');
    if (!redoHistoryRefs.current[index]) redoHistoryRefs.current[index] = [];
    redoHistoryRefs.current[index].push({ canvas: ctx.getImageData(0, 0, canvas.width, canvas.height) });
    const prevState = undoHistoryRefs.current[index].pop();
    ctx.putImageData(prevState.canvas, 0, 0);
    const url = canvas.toDataURL();
    setDrawings(prev => { const next = { ...prev, [index]: url }; queueUpdate({ drawings: next }); return next; });
  };

  const handleRedo = (index) => {
    if (!redoHistoryRefs.current[index]?.length) return;
    const canvas = canvasRefs.current[index];
    const ctx = canvas.getContext('2d');
    undoHistoryRefs.current[index].push({ canvas: ctx.getImageData(0, 0, canvas.width, canvas.height) });
    const nextState = redoHistoryRefs.current[index].pop();
    ctx.putImageData(nextState.canvas, 0, 0);
    const url = canvas.toDataURL();
    setDrawings(prev => { const next = { ...prev, [index]: url }; queueUpdate({ drawings: next }); return next; });
  };

  // --- Auto-loader ---
  useEffect(() => {
    if (!chapterData) return;
    chapterData.content.forEach((_, index) => {
      const canvas = canvasRefs.current[index];
      const container = contentContainersRef.current[index];
      if (canvas && container) {
        const ratio = window.devicePixelRatio || 1;
        const tw = Math.round(container.offsetWidth * ratio);
        const th = Math.round(container.offsetHeight * ratio);
        if (canvas.width !== tw || canvas.height !== th || (drawings[index] && canvas.dataset.loaded !== drawings[index])) {
          canvas.width = tw; canvas.height = th;
          canvas.style.width = `${container.offsetWidth}px`; canvas.style.height = `${container.offsetHeight}px`;
          const ctx = canvas.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.scale(ratio, ratio);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          if (drawings[index]) {
            const img = new Image(); img.src = drawings[index];
            img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, container.offsetWidth, container.offsetHeight); };
            canvas.dataset.loaded = drawings[index];
          }
        }
      }
    });
  }, [drawings, isInitialLoadComplete]);

  const getContent = () => {
    if (ebookId === '1') return historicalBackground;
    if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContent();

  const renderContent = (item, index) => {
    const content = (() => {
      switch (item.type) {
        case 'h2': return <h2 style={{ color: '#1a237e', marginTop: '2rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}><LatexRenderer>{item.text}</LatexRenderer></h2>;
        case 'h3': return <h3 style={{ color: '#283593', marginTop: '1.5rem' }}><LatexRenderer>{item.text}</LatexRenderer></h3>;
        case 'p': return <p style={{ lineHeight: '1.8', color: '#333', marginBottom: '1.2rem', textAlign: 'justify' }}><LatexRenderer>{item.text}</LatexRenderer></p>;
        case 'list': return (
          <ul style={{ marginBottom: '1.5rem', paddingLeft: '1.5rem' }}>
            {item.items.map((li, i) => <li key={i} style={{ marginBottom: '0.8rem', lineHeight: '1.6', color: '#444' }}>{li}</li>)}
          </ul>
        );
        default: return null;
      }
    })();

    return (
      <div key={index} ref={el => contentContainersRef.current[index] = el} style={{ position: 'relative', marginBottom: '10px' }}>
        <div style={{ position: 'relative', zIndex: 1 }}>{content}</div>
        {isInitialLoadComplete && (
          <>
            <canvas ref={el => canvasRefs.current[index] = el} onPointerDown={(e) => startDrawing(e, index)} onPointerMove={(e) => draw(e, index)} onPointerUp={() => stopDrawing(index)} onPointerLeave={() => stopDrawing(index)}
              style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? 100 : -1, touchAction: isDrawingMode ? "none" : "auto", cursor: isDrawingMode ? 'crosshair' : 'default' }} />
            <canvas ref={el => previewCanvasRefs.current[index] = el} style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? 101 : -1, pointerEvents: "none" }} />
          </>
        )}
      </div>
    );
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
      {/* DRAWING TOOLBAR (Ported from Quiz.jsx) */}
      <div style={toolbarStyle}>
        <div style={tb.card}>
          <button onClick={() => setIsDrawingMode(!isDrawingMode)} style={tb.pill(isDrawingMode, '#7c6fff')}>
            {isDrawingMode ? '✅ Done' : '✏️ Draw'}
          </button>
          
          {isDrawingMode && (
            <>
              <div style={tb.sep} />
              
              <div style={{ position: 'relative' }}>
                <button onClick={() => setActiveMenu(activeMenu === 'tools' ? null : 'tools')} style={tb.pill(drawTool === 'pen' || drawTool === 'line' || drawTool === 'rectangle' || drawTool === 'circle', '#7c6fff')}>
                  🛠️ Tools ▼
                </button>
                {activeMenu === 'tools' && (
                  <div style={popoverStyle}>
                    <button onClick={() => { setDrawTool('pen'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'pen')}>✏️ Pen</button>
                    <button onClick={() => { setDrawTool('line'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'line')}>📏 Line</button>
                    <button onClick={() => { setDrawTool('rectangle'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'rectangle')}>⬜ Rectangle</button>
                    <button onClick={() => { setDrawTool('circle'); setActiveMenu(null); }} style={tb.toolBtn(drawTool === 'circle')}>⭕ Circle</button>
                  </div>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <button onClick={() => { if (drawTool === 'eraser') { setActiveMenu(activeMenu === 'eraser' ? null : 'eraser'); } else { setDrawTool('eraser'); setActiveMenu(null); } }} style={tb.pill(drawTool === 'eraser', '#ff4757', '#c0392b')}>
                  🧽 {eraserMode === 'precision' ? 'Precision' : 'Stroke'} Eraser ▼
                </button>
                {activeMenu === 'eraser' && (
                  <div style={popoverStyle}>
                    <button onClick={() => { setEraserMode('precision'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'precision')}>🎯 Precision Eraser</button>
                    <button onClick={() => { setEraserMode('stroke'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'stroke')}>🌊 Stroke Eraser</button>
                  </div>
                )}
              </div>

              <div style={tb.sep} />
              <button onClick={() => handleUndo(activeCanvasIndex.current || 0)} style={tb.pill(false, '#f1f2f6')}>↩️ Undo</button>
              <button onClick={() => handleRedo(activeCanvasIndex.current || 0)} style={tb.pill(false, '#f1f2f6')}>↪️ Redo</button>
              
              <div style={tb.sep} />
              <button 
                onClick={manualSaveToCloud} 
                style={tb.pill(hasUnsavedChanges, '#2ed573', '#27ae60')}
                disabled={isSaving}
              >
                {isSaving ? '⏳ Saving...' : hasUnsavedChanges ? '💾 Save Now' : '☁️ Saved'}
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ maxWidth: '800px', margin: '40px auto 0', background: 'white', padding: '3rem', borderRadius: '8px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span>
            <h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1>
          </div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>

        <div style={{ fontSize: '1.1rem' }}>
          {chapterData.content.map((item, index) => renderContent(item, index))}
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
