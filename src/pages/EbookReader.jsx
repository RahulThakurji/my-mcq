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
  const [strokes, setStrokes] = useState([]); // Array of { points, color, width, tool }
  const [savedContent, setSavedContent] = useState({}); // Segmented highlights
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // --- Refs ---
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const undoHistoryRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const contentAreaRef = useRef(null);
  const textRefs = useRef({}); // Still need segmented text refs for highlights
  
  const isDrawing = useRef(false);
  const isSnapped = useRef(false);
  const snapshot = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const activePointerType = useRef(null);
  const activePointers = useRef(new Map()); // ID -> Type
  const isHighlightErased = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const pendingUpdatesRef = useRef({});

  const updateHistoryState = () => {
    setHistoryState({
      undo: undoHistoryRef.current.length || 0,
      redo: redoHistoryRef.current.length || 0
    });
  };

  const getContent = () => {
    if (ebookId === '1') return historicalBackground; 
    if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContent();

  const abortDrawing = () => {
    if (!isDrawing.current) return;
    clearTimeout(holdTimeout.current);
    isDrawing.current = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && preStrokeSnapshot.current) {
      ctx.putImageData(preStrokeSnapshot.current, 0, 0);
    }
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

  // --- Selection Lock ---
  useEffect(() => {
    if (isDrawingMode) {
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.body.style.webkitTouchCallout = 'none';
    } else {
      document.body.style.userSelect = 'auto';
      document.body.style.webkitUserSelect = 'auto';
      document.body.style.webkitTouchCallout = 'default';
    }
    return () => {
      document.body.style.userSelect = 'auto';
      document.body.style.webkitUserSelect = 'auto';
      document.body.style.webkitTouchCallout = 'default';
    };
  }, [isDrawingMode]);

  // --- Persistence ---
  useEffect(() => {
    if (!user || !ebookId || !chapterId) { setIsInitialLoadComplete(true); return; }
    const docRef = doc(db, 'users', user.uid, 'ebooks', `${ebookId}-${chapterId}`);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.strokes !== undefined) setStrokes(data.strokes || []);
        if (data.savedContent !== undefined) setSavedContent(data.savedContent);
      } else if (!docSnap.exists()) {
        setStrokes([]); setSavedContent({});
        setDoc(docRef, { strokes: [], savedContent: {} }).catch(() => {});
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

  const redrawCanvas = (canvas, strokeList) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const ratio = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);

    strokeList.forEach(s => {
      ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (s.tool === 'pen') {
        const stroke = getStroke(s.points, { size: s.width, thinning: 0.2, smoothing: 0.8, streamline: 0.8 });
        const pathData = getSvgPathFromStroke(stroke);
        ctx.fill(new Path2D(pathData));
      } else if (s.tool === 'line') {
        ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y); ctx.lineTo(s.points[s.points.length-1].x, s.points[s.points.length-1].y); ctx.stroke();
      } else if (s.tool === 'rectangle') {
        const p1 = s.points[0]; const p2 = s.points[s.points.length-1];
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      } else if (s.tool === 'circle') {
        const p1 = s.points[0]; const p2 = s.points[s.points.length-1];
        const r = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        ctx.beginPath(); ctx.arc(p1.x, p1.y, r, 0, 2 * Math.PI); ctx.stroke();
      } else if (s.tool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i].x, s.points[i].y);
        ctx.stroke();
      }
    });
  };

  const startDrawing = (e) => {
    const { nativeEvent } = e;
    if (!isDrawingMode) return;
    if (activeMenu) setActiveMenu(null);
    if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return;
    activePointerType.current = nativeEvent.pointerType;
    const canvas = canvasRef.current; if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const offsetX = nativeEvent.clientX - rect.left; const offsetY = nativeEvent.clientY - rect.top;
    const ctx = canvas.getContext('2d');
    
    isSnapped.current = false; startX.current = offsetX; startY.current = offsetY;
    lastPos.current = { x: nativeEvent.clientX, y: nativeEvent.clientY };
    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    preStrokeSnapshot.current = state; snapshot.current = state;
    
    undoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });
    if (undoHistoryRef.current.length > 20) undoHistoryRef.current.shift();
    redoHistoryRef.current = [];
    
    strokePoints.current = [{ x: offsetX, y: offsetY, pressure: nativeEvent.pressure || 0.5 }];
    isDrawing.current = true; updateHistoryState();

    // Fix: Restore preview canvas initialization for the Pen tool
    const pCanvas = previewCanvasRef.current;
    if (pCanvas) {
      const ratio = window.devicePixelRatio || 1;
      if (pCanvas.width !== canvas.width || pCanvas.height !== canvas.height) {
        pCanvas.width = canvas.width;
        pCanvas.height = canvas.height;
        pCanvas.style.width = canvas.style.width;
        pCanvas.style.height = canvas.style.height;
      }
      const pCtx = pCanvas.getContext('2d');
      pCtx.imageSmoothingEnabled = false;
      pCtx.setTransform(1, 0, 0, 1, 0, 0);
      pCtx.scale(ratio, ratio);
      pCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect();
    const offsetX = e.nativeEvent.clientX - rect.left; const offsetY = e.nativeEvent.clientY - rect.top;
    strokePoints.current.push({ x: offsetX, y: offsetY, pressure: e.nativeEvent.pressure || 0.5 });
    const pts = strokePoints.current; const ctx = canvas.getContext('2d');

    if (drawTool === 'eraser' && eraserMode === 'stroke') {
      // Stroke Eraser Logic: Find strokes that intersect with the eraser path
      const eraserRadius = 30;
      let hit = false;
      const nextStrokes = strokes.filter(s => {
        const isHit = s.points.some(p => Math.hypot(p.x - offsetX, p.y - offsetY) < eraserRadius);
        if (isHit) hit = true;
        return !isHit;
      });
      if (hit) {
        setStrokes(nextStrokes);
        redrawCanvas(canvas, nextStrokes);
      }
      
      // Eraser for highlights
      Object.keys(textRefs.current).forEach(index => {
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
      });
    } else if (drawTool === 'eraser') {
      // Precision Eraser (Visual only until stopDrawing)
      ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(startX.current, startY.current); ctx.lineTo(offsetX, offsetY); ctx.stroke();
      startX.current = offsetX; startY.current = offsetY;

      // Eraser for highlights
      Object.keys(textRefs.current).forEach(index => {
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
      });
    } else if (drawTool === 'pen') {
      if (isSnapped.current) return;
      const pCanvas = previewCanvasRef.current; const pCtx = pCanvas?.getContext('2d');
      if (pCtx) {
        pCtx.imageSmoothingEnabled = false;
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
        const stroke = getStroke(pts, { size: penWidth, thinning: 0.2, smoothing: 0.8, streamline: 0.8, simulatePressure: e.nativeEvent.pointerType !== 'pen' });
        const pathData = getSvgPathFromStroke(stroke); const path = new Path2D(pathData);
        pCtx.fillStyle = penColor; 
        pCtx.shadowBlur = 0.5; pCtx.shadowColor = penColor;
        pCtx.fill(path);
      }
      clearTimeout(holdTimeout.current);
      holdTimeout.current = setTimeout(() => { if (isDrawing.current && !isSnapped.current) snapShape(); }, 600);
    } else {
      ctx.putImageData(snapshot.current, 0, 0); ctx.beginPath(); ctx.strokeStyle = penColor; ctx.lineWidth = penWidth;
      ctx.shadowBlur = 1; ctx.shadowColor = penColor;
      if (drawTool === 'line') { ctx.moveTo(startX.current, startY.current); ctx.lineTo(offsetX, offsetY); }
      else if (drawTool === 'rectangle') { ctx.rect(startX.current, startY.current, offsetX - startX.current, offsetY - startY.current); }
      else if (drawTool === 'circle') { ctx.arc(startX.current, startY.current, Math.hypot(offsetX - startX.current, offsetY - startY.current), 0, 2 * Math.PI); }
      ctx.stroke();
    }
  };

  const stopDrawing = (e) => {
    if (!isDrawing.current) return;
    clearTimeout(holdTimeout.current);
    
    // Tap-to-interact logic from Quiz.jsx
    if (e) {
      const { clientX, clientY } = e.nativeEvent;
      const dist = Math.hypot(clientX - lastPos.current.x, clientY - lastPos.current.y);
      if (dist < 5) {
        const elements = document.elementsFromPoint(clientX, clientY);
        const targetBtn = elements.find(el => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button');
        if (targetBtn) { targetBtn.click(); isDrawing.current = false; return; }
      }
    }

    isDrawing.current = false;
    const canvas = canvasRef.current;
    
    if (canvas) {
      if (drawTool === 'eraser' && eraserMode === 'stroke') {
        // Already handled
      } else if (isSnapped.current) {
        // Already handled by snapShape()
      } else {
        const newStroke = {
          points: [...strokePoints.current],
          tool: drawTool,
          color: penColor,
          width: drawTool === 'eraser' ? 25 : penWidth,
          id: Date.now()
        };
        const nextStrokes = [...strokes, newStroke];
        setStrokes(nextStrokes);
        redrawCanvas(canvas, nextStrokes);
        queueUpdate({ strokes: nextStrokes });
      }
      
      // Fix: Ensure preview canvas is cleared after baking the stroke
      const pCanvas = previewCanvasRef.current;
      if (pCanvas) {
        const pCtx = pCanvas.getContext('2d');
        pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
      }
    }

    if (isHighlightErased.current) {
      const nextSavedContent = {};
      Object.keys(textRefs.current).forEach(idx => { if (textRefs.current[idx]) nextSavedContent[idx] = textRefs.current[idx].innerHTML; });
      setSavedContent(nextSavedContent); queueUpdate({ savedContent: nextSavedContent });
      isHighlightErased.current = false;
    }
    updateHistoryState();
  };

  const handleUndo = () => {
    if (!undoHistoryRef.current.length) return;
    const prevState = undoHistoryRef.current.pop();
    redoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });
    
    setStrokes(prevState.strokes);
    redrawCanvas(canvasRef.current, prevState.strokes);
    
    if (prevState.html) {
      setSavedContent(prevState.html);
      setTimeout(() => { Object.keys(prevState.html).forEach(idx => { if (textRefs.current[idx]) textRefs.current[idx].innerHTML = prevState.html[idx]; }); }, 0);
    }
    queueUpdate({ strokes: prevState.strokes, savedContent: prevState.html });
    updateHistoryState();
  };

  const handleRedo = () => {
    if (!redoHistoryRef.current.length) return;
    const nextState = redoHistoryRef.current.pop();
    undoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });
    
    setStrokes(nextState.strokes);
    redrawCanvas(canvasRef.current, nextState.strokes);
    
    if (nextState.html) {
      setSavedContent(nextState.html);
      setTimeout(() => { Object.keys(nextState.html).forEach(idx => { if (textRefs.current[idx]) textRefs.current[idx].innerHTML = nextState.html[idx]; }); }, 0);
    }
    queueUpdate({ strokes: nextState.strokes, savedContent: nextState.html });
    updateHistoryState();
  };

  const clearPage = () => {
    setStrokes([]);
    redrawCanvas(canvasRef.current, []);
    queueUpdate({ strokes: [] });
    updateHistoryState();
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

  // --- Auto-loader & Resize for Unified Canvas ---
  useEffect(() => {
    if (!chapterData || !isInitialLoadComplete) return;
    const canvas = canvasRef.current; const container = contentAreaRef.current;
    if (canvas && container) {
      const ratio = window.devicePixelRatio || 1;
      const tw = Math.round(container.offsetWidth * ratio); const th = Math.round(container.offsetHeight * ratio);
      if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw; canvas.height = th; canvas.style.width = `${container.offsetWidth}px`; canvas.style.height = `${container.offsetHeight}px`;
        redrawCanvas(canvas, strokes);
      }
    }
  }, [strokes, isInitialLoadComplete, chapterData]);


  const renderContent = (item, index) => {
    const isSaved = !!savedContent[index];
    const contentText = isSaved ? savedContent[index] : (item.type === 'list' ? `${item.items.map(li => `• ${li}`).join('\n')}` : item.text);
    
    let defaultContent;
    if (!isSaved) {
      if (item.type === 'h2') defaultContent = <h2 style={{ color: '#1a237e', marginTop: '2rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}><LatexRenderer>{contentText}</LatexRenderer></h2>;
      else if (item.type === 'h3') defaultContent = <h3 style={{ color: '#283593', marginTop: '1.5rem' }}><LatexRenderer>{contentText}</LatexRenderer></h3>;
      else if (item.type === 'p') defaultContent = <p style={{ lineHeight: '1.8', color: '#333', marginBottom: '1.2rem', textAlign: 'justify' }}><LatexRenderer>{contentText}</LatexRenderer></p>;
      else if (item.type === 'list') defaultContent = <div style={{ marginBottom: '1.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#444' }}><LatexRenderer>{contentText}</LatexRenderer></div>;
    }
    
    return (
      <div key={index} style={{ position: 'relative', marginBottom: '10px' }}>
        {isSaved ? (
          <div 
            ref={el => textRefs.current[index] = el} 
            onPointerUp={() => handleMouseUp(index)} 
            style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none', pointerEvents: isDrawingMode ? 'none' : 'auto' }}
            dangerouslySetInnerHTML={{ __html: savedContent[index] }}
          />
        ) : (
          <div 
            ref={el => textRefs.current[index] = el} 
            onPointerUp={() => handleMouseUp(index)} 
            style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none', pointerEvents: isDrawingMode ? 'none' : 'auto' }}
          >
            {defaultContent}
          </div>
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
  const popoverStyle = { position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '10px', background: '#2f3542', padding: '10px', borderRadius: '12px', boxShadow: '0 8px 30px rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '160px', zIndex: 10002 };

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
                <div style={{ ...tb.sep, width: '100%', height: '1px', margin: '4px 0' }} />
                <button onClick={() => { if (window.confirm('Clear all drawings?')) { clearPage(); setActiveMenu(null); } }} style={{ ...tb.toolBtn(false), color: '#ff4757' }}>🗑️ Clear All</button>
              </div>
            )}
          </div>
          <div style={tb.sep} />
          <button onClick={handleUndo} style={tb.undoBtn(historyState.undo > 0)}>↩</button>
          <button onClick={handleRedo} style={tb.undoBtn(historyState.redo > 0)}>↪</button>
          <div style={tb.sep} />
          <button onClick={manualSaveToCloud} style={tb.pill(hasUnsavedChanges, '#ff9800', '#e67e22')} disabled={isSaving}>{isSaving ? '⏳' : '💾'} {hasUnsavedChanges ? 'Save' : 'Saved'}</button>
          {isHighlightMode && (<><div style={tb.sep} /><div style={{ position: 'relative' }}><button onClick={() => setActiveMenu(activeMenu === 'hColor' ? null : 'hColor')} style={tb.card}><div style={tb.dot(true, highlightColor)} /> ▼</button>{activeMenu === 'hColor' && <div style={popoverStyle}>{hlColors.map(({ c, n }) => <button key={c} title={n} onClick={() => { setHighlightColor(c); setActiveMenu(null); }} style={tb.dot(highlightColor === c, c)} />)}</div>}</div></>)}
          {isDrawingMode && drawTool !== 'eraser' && (<><div style={tb.sep} /><div style={{ position: 'relative' }}><button onClick={() => setActiveMenu(activeMenu === 'tool' ? null : 'tool')} style={tb.toolBtn(true)}>{tools.find(t => t.v === drawTool)?.icon} ▼</button>{activeMenu === 'tool' && <div style={popoverStyle}>{tools.map(({ v, icon, label }) => <button key={v} title={label} onClick={() => { setDrawTool(v); setActiveMenu(null); }} style={tb.toolBtn(drawTool === v)}>{icon}</button>)}</div>}</div><div style={{ position: 'relative' }}><button onClick={() => setActiveMenu(activeMenu === 'color' ? null : 'color')} style={tb.card}><div style={tb.dot(true, penColor)} /> ▼</button>{activeMenu === 'color' && <div style={popoverStyle}>{penColors.map(({ c, n }) => <button key={c} title={n} onClick={() => { setPenColor(c); setActiveMenu(null); }} style={tb.dot(penColor === c, c)} />)}</div>}</div><div style={{ position: 'relative' }}><button onClick={() => setActiveMenu(activeMenu === 'size' ? null : 'size')} style={tb.card}><div style={{ width: '8px', height: '8px', backgroundColor: penColor, borderRadius: '50%' }} /><span style={{ fontSize: "0.7rem", color: "#ccc" }}>{penWidth}</span> ▼</button>{activeMenu === 'size' && <div style={{ ...popoverStyle, padding: "12px", width: "160px" }}><input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c6fff" }} /></div>}</div></>)}
        </div>
      </div>

      <div id="ebook-card" style={{ maxWidth: '750px', margin: '40px auto 0', background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #eee', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div><span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span><h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1></div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>
        
        <div id="content-area" ref={contentAreaRef} 
          onPointerDown={(e) => { 
            activePointers.current.set(e.pointerId, e.pointerType);
            const touches = Array.from(activePointers.current.values()).filter(t => t === 'touch');
            const pens = Array.from(activePointers.current.values()).filter(t => t === 'pen');
            if (touches.length > 1) { abortDrawing(); return; }
            if (isDrawingMode) {
              if (e.pointerType === 'touch' && pens.length > 0) return;
              try { e.currentTarget.setPointerCapture(e.pointerId); } catch { }
              startDrawing(e); 
            } 
          }}
          onPointerMove={(e) => { 
            const touches = Array.from(activePointers.current.values()).filter(t => t === 'touch');
            if (touches.length > 1) { abortDrawing(); return; }
            if (isDrawing.current) draw(e); 
          }}
          onPointerUp={(e) => { 
            activePointers.current.delete(e.pointerId); 
            if (isDrawing.current) { 
              try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { } 
              stopDrawing(e); 
            } 
          }}
          onPointerLeave={(e) => { 
            if (isDrawing.current && activePointers.current.size <= 1) stopDrawing(e); 
          }}
          onPointerCancel={(e) => { 
            activePointers.current.delete(e.pointerId); 
            abortDrawing(); 
          }}
          style={{ 
            fontSize: '1.1rem', 
            position: 'relative', 
            touchAction: isDrawingMode ? 'pinch-zoom' : 'auto',
            userSelect: isDrawingMode ? 'none' : 'auto',
            WebkitUserSelect: isDrawingMode ? 'none' : 'auto',
            WebkitTouchCallout: 'none'
          }}
        >
          {chapterData.content.map((item, index) => renderContent(item, index))}
          {isInitialLoadComplete && (
            <><canvas 
                ref={canvasRef} 
                style={{ 
                  position: "absolute", top: 0, left: 0, 
                  zIndex: isDrawingMode ? 100 : 2, 
                  pointerEvents: 'none', opacity: 1,
                  userSelect: 'none', WebkitUserSelect: 'none'
                }} 
              />
              <canvas 
                ref={previewCanvasRef} 
                style={{ 
                  position: "absolute", top: 0, left: 0, 
                  zIndex: isDrawingMode ? 101 : 2, 
                  pointerEvents: 'none', 
                  opacity: 1, touchAction: 'none',
                  userSelect: 'none', WebkitUserSelect: 'none'
                }} 
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