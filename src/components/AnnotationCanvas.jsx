import React, { useState, useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import { getStroke } from 'perfect-freehand';

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

const AnnotationCanvas = forwardRef(({ 
  id, 
  isDrawingMode, 
  drawTool = 'pen', 
  penColor = '#FF003C', 
  penWidth = 3, 
  eraserMode = 'precision',
  onDrawingUpdate,
  initialData,
  zIndex = 10000
}, ref) => {
  const canvasRef = useRef(null);
  const previewCanvasRef = useRef(null);
  const containerRef = useRef(null);
  
  const isDrawing = useRef(false);
  const strokePoints = useRef([]);
  const holdTimeout = useRef(null);
  const snapshot = useRef(null);
  const preStrokeSnapshot = useRef(null);
  const isSnapped = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const activePointers = useRef(new Map());
  const drawingPointerId = useRef(null);

  const [undoHistory, setUndoHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);

  // Expose undo/redo to parent
  useImperativeHandle(ref, () => ({
    undo: handleUndo,
    redo: handleRedo,
    clear: clearCanvas,
    getData: () => canvasRef.current?.toDataURL(),
    canUndo: undoHistory.length > 0,
    canRedo: redoHistory.length > 0
  }));

  // Handle Resize
  useEffect(() => {
    const resize = () => {
      if (!containerRef.current || !canvasRef.current || !previewCanvasRef.current) return;
      const container = containerRef.current;
      const canvas = canvasRef.current;
      const pCanvas = previewCanvasRef.current;
      const ratio = window.devicePixelRatio || 1;

      const tw = Math.round(container.offsetWidth * ratio);
      const th = Math.round(container.offsetHeight * ratio);

      if (canvas.width !== tw || canvas.height !== th) {
        // Save current content before resize
        const temp = canvas.toDataURL();
        
        canvas.width = tw;
        canvas.height = th;
        canvas.style.width = `${container.offsetWidth}px`;
        canvas.style.height = `${container.offsetHeight}px`;
        
        pCanvas.width = tw;
        pCanvas.height = th;
        pCanvas.style.width = canvas.style.width;
        pCanvas.style.height = canvas.style.height;

        const ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        ctx.imageSmoothingEnabled = false;

        // Restore content
        const img = new Image();
        img.src = temp;
        img.onload = () => {
           const ctx = canvas.getContext('2d');
           ctx.imageSmoothingEnabled = false;
           ctx.drawImage(img, 0, 0, container.offsetWidth, container.offsetHeight);
        };
      }
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Handle Initial Data
  useEffect(() => {
    if (initialData && canvasRef.current) {
      const img = new Image();
      img.src = initialData;
      img.onload = () => {
        const ctx = canvasRef.current.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.drawImage(img, 0, 0, canvasRef.current.width / (window.devicePixelRatio || 1), canvasRef.current.height / (window.devicePixelRatio || 1));
      };
    }
  }, [initialData]);

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
    
    const ctx = canvasRef.current.getContext('2d');
    ctx.putImageData(preStrokeSnapshot.current, 0, 0);
    ctx.beginPath(); ctx.globalAlpha = 1.0; ctx.strokeStyle = penColor; ctx.lineWidth = penWidth;
    ctx.shadowBlur = 1; ctx.shadowColor = penColor;
    
    const isClosedShape = gap < diag * 0.3;
    if (isClosedShape) {
      const aspect = Math.min(width, height) / Math.max(width, height);
      if (aspect > 0.7) {
        const radius = Math.max(width, height) / 2;
        ctx.arc(minX + width/2, minY + height/2, radius, 0, Math.PI * 2);
      } else { ctx.rect(minX, minY, width, height); }
    } else { ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); }
    
    ctx.stroke(); isSnapped.current = true;
  };

  const startDrawing = (e) => {
    const { clientX, clientY, pointerId, pointerType, pressure } = e.nativeEvent;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;

    const ctx = canvas.getContext('2d');
    const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
    
    preStrokeSnapshot.current = state;
    snapshot.current = state;
    setUndoHistory(prev => [...prev.slice(-19), state]);
    setRedoHistory([]);

    strokePoints.current = [{ x: offsetX, y: offsetY, pressure: pressure || 0.5 }];
    lastPos.current = { x: clientX, y: clientY };
    drawingPointerId.current = pointerId;
    isDrawing.current = true;
    isSnapped.current = false;

    // Prepare preview
    const pCanvas = previewCanvasRef.current;
    const pCtx = pCanvas.getContext('2d');
    pCtx.imageSmoothingEnabled = false;
    pCtx.setTransform(1, 0, 0, 1, 0, 0);
    pCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
  };

  const draw = (e) => {
    if (!isDrawing.current || e.nativeEvent.pointerId !== drawingPointerId.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const offsetX = e.nativeEvent.clientX - rect.left;
    const offsetY = e.nativeEvent.clientY - rect.top;
    const pts = strokePoints.current;
    pts.push({ x: offsetX, y: offsetY, pressure: e.nativeEvent.pressure || 0.5 });

    const ctx = canvas.getContext('2d');
    
    if (drawTool === 'pen') {
      if (isSnapped.current) return;
      const pCtx = previewCanvasRef.current.getContext('2d');
      pCtx.clearRect(0, 0, canvas.width, canvas.height);
      const stroke = getStroke(pts, { size: penWidth, thinning: 0.2, smoothing: 0.8, streamline: 0.8, simulatePressure: e.nativeEvent.pointerType !== 'pen' });
      const pathData = getSvgPathFromStroke(stroke);
      const path = new Path2D(pathData);
      pCtx.fillStyle = penColor;
      pCtx.shadowBlur = 0.5; pCtx.shadowColor = penColor;
      pCtx.fill(path);

      clearTimeout(holdTimeout.current);
      holdTimeout.current = setTimeout(() => { if (isDrawing.current && !isSnapped.current) snapShape(); }, 600);
    } else if (drawTool === 'eraser') {
      if (eraserMode === 'stroke') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        isDrawing.current = false; return;
      }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = 25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      if (pts.length > 1) {
        ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
        ctx.lineTo(offsetX, offsetY);
        ctx.stroke();
      }
    } else {
      ctx.putImageData(snapshot.current, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = penColor; ctx.lineWidth = penWidth;
      ctx.shadowBlur = 1; ctx.shadowColor = penColor;
      ctx.beginPath();
      if (drawTool === 'line') { ctx.moveTo(pts[0].x, pts[0].y); ctx.lineTo(offsetX, offsetY); }
      else if (drawTool === 'rectangle') { ctx.rect(pts[0].x, pts[0].y, offsetX - pts[0].x, offsetY - pts[0].y); }
      else if (drawTool === 'circle') { ctx.arc(pts[0].x, pts[0].y, Math.hypot(offsetX - pts[0].x, offsetY - pts[0].y), 0, 2 * Math.PI); }
      ctx.stroke();
    }
  };

  const stopDrawing = (e) => {
    if (!isDrawing.current || (e && e.nativeEvent.pointerId !== drawingPointerId.current)) return;
    isDrawing.current = false;
    drawingPointerId.current = null;
    clearTimeout(holdTimeout.current);

    const canvas = canvasRef.current;
    const pCanvas = previewCanvasRef.current;

    if (pCanvas && canvas && drawTool === 'pen' && !isSnapped.current) {
      const ctx = canvas.getContext('2d');
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(pCanvas, 0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
      pCanvas.getContext('2d').clearRect(0, 0, pCanvas.width, pCanvas.height);
    }

    if (onDrawingUpdate) onDrawingUpdate(canvas.toDataURL());
  };

  const handleUndo = () => {
    if (undoHistory.length === 0) return;
    const ctx = canvasRef.current.getContext('2d');
    const currentState = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setRedoHistory(prev => [...prev, currentState]);
    const prevState = undoHistory[undoHistory.length - 1];
    setUndoHistory(prev => prev.slice(0, -1));
    ctx.putImageData(prevState, 0, 0);
    if (onDrawingUpdate) onDrawingUpdate(canvasRef.current.toDataURL());
  };

  const handleRedo = () => {
    if (redoHistory.length === 0) return;
    const ctx = canvasRef.current.getContext('2d');
    const currentState = ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height);
    setUndoHistory(prev => [...prev, currentState]);
    const nextState = redoHistory[redoHistory.length - 1];
    setRedoHistory(prev => prev.slice(0, -1));
    ctx.putImageData(nextState, 0, 0);
    if (onDrawingUpdate) onDrawingUpdate(canvasRef.current.toDataURL());
  };

  const clearCanvas = () => {
    const ctx = canvasRef.current.getContext('2d');
    setUndoHistory(prev => [...prev, ctx.getImageData(0, 0, canvasRef.current.width, canvasRef.current.height)]);
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    if (onDrawingUpdate) onDrawingUpdate(null);
  };

  return (
    <div 
      ref={containerRef}
      style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: zIndex }} />
      <canvas 
        ref={previewCanvasRef} 
        onPointerDown={(e) => {
          activePointers.current.set(e.pointerId, e.pointerType);
          const pens = Array.from(activePointers.current.values()).filter(t => t === 'pen');
          if (isDrawingMode) {
            if (e.pointerType === 'touch' && pens.length > 0) return;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
            startDrawing(e);
          }
        }}
        onPointerMove={(e) => {
          if (isDrawing.current && e.pointerId === drawingPointerId.current) { e.preventDefault(); draw(e); }
        }}
        onPointerUp={(e) => {
          activePointers.current.delete(e.pointerId);
          if (isDrawing.current && e.pointerId === drawingPointerId.current) {
            try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
            stopDrawing(e);
          }
        }}
        onPointerCancel={(e) => {
          activePointers.current.delete(e.pointerId);
          isDrawing.current = false;
        }}
        style={{ 
          position: 'absolute', top: 0, left: 0, 
          pointerEvents: isDrawingMode ? 'auto' : 'none', 
          zIndex: zIndex + 1, 
          touchAction: isDrawingMode ? 'none' : 'auto',
          userSelect: 'none', WebkitUserSelect: 'none'
        }} 
      />
    </div>
  );
});

export default AnnotationCanvas;
