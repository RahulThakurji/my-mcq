import React, { useEffect, useRef } from 'react';
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

export default function GlobalCanvas({
    containerRef,
    isDrawingMode,
    tool = 'pen',
    color = '#FF003C',
    lineWidth = 3,
    eraserMode = 'precision',
    strokes = [],
    setStrokes,
    onStrokeStart,
    onStrokeEnd,
    onPointerErase,
    zIndex = 100
}) {
    const canvasRef = useRef(null);
    const previewCanvasRef = useRef(null);

    const isDrawing = useRef(false);
    const isSnapped = useRef(false);
    const snapshot = useRef(null);
    const preStrokeSnapshot = useRef(null);
    const startX = useRef(0);
    const startY = useRef(0);
    const strokePoints = useRef([]);
    const holdTimeout = useRef(null);
    const activePointerType = useRef(null);
    const activePointers = useRef(new Map());
    const drawingPointerId = useRef(null);

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
                ctx.beginPath(); ctx.moveTo(s.points[0].x, s.points[0].y); ctx.lineTo(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y); ctx.stroke();
            } else if (s.tool === 'rectangle') {
                const p1 = s.points[0]; const p2 = s.points[s.points.length - 1];
                ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
            } else if (s.tool === 'circle') {
                const p1 = s.points[0]; const p2 = s.points[s.points.length - 1];
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

    // Resize Observer to match parent container automatically
    useEffect(() => {
        const container = containerRef?.current;
        if (!container) return;

        const handleResize = () => {
            const canvas = canvasRef.current;
            const pCanvas = previewCanvasRef.current;
            if (!canvas || !pCanvas) return;

            const ratio = window.devicePixelRatio || 1;
            const tw = Math.round(container.offsetWidth * ratio);
            const th = Math.round(container.offsetHeight * ratio);

            if (canvas.width !== tw || canvas.height !== th) {
                canvas.width = tw; canvas.height = th;
                canvas.style.width = `${container.offsetWidth}px`;
                canvas.style.height = `${container.offsetHeight}px`;

                pCanvas.width = tw; pCanvas.height = th;
                pCanvas.style.width = `${container.offsetWidth}px`;
                pCanvas.style.height = `${container.offsetHeight}px`;

                redrawCanvas(canvas, strokes);
            }
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(container);
        handleResize(); // Initial sizing

        return () => observer.disconnect();
    }, [containerRef, strokes]);

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
        const diag = Math.hypot(width, height);
        const gap = Math.hypot(start.x - end.x, start.y - end.y);
        const canvas = canvasRef.current; if (!canvas) return;

        const ctx = canvas.getContext('2d');
        ctx.putImageData(preStrokeSnapshot.current, 0, 0);
        ctx.beginPath();
        ctx.globalAlpha = 1.0; ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
        ctx.shadowBlur = 1; ctx.shadowColor = color;

        const isClosedShape = gap < diag * 0.3;
        if (isClosedShape) {
            const aspect = Math.min(width, height) / Math.max(width, height);
            if (aspect > 0.7) {
                const centerX = minX + width / 2; const centerY = minY + height / 2;
                const radius = Math.max(width, height) / 2;
                ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            } else ctx.rect(minX, minY, width, height);
        } else {
            ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
        }
        ctx.stroke(); isSnapped.current = true;
    };

    const startDrawing = (e) => {
        const { nativeEvent } = e;
        if (!isDrawingMode) return;
        if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return; // Palm rejection

        activePointerType.current = nativeEvent.pointerType;
        drawingPointerId.current = nativeEvent.pointerId;

        const canvas = canvasRef.current; if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const offsetX = nativeEvent.clientX - rect.left;
        const offsetY = nativeEvent.clientY - rect.top;

        isSnapped.current = false; startX.current = offsetX; startY.current = offsetY;
        const ctx = canvas.getContext('2d');
        const state = ctx.getImageData(0, 0, canvas.width, canvas.height);
        preStrokeSnapshot.current = state; snapshot.current = state;

        if (onStrokeStart) onStrokeStart();

        strokePoints.current = [{ x: offsetX, y: offsetY, pressure: nativeEvent.pressure || 0.5 }];
        isDrawing.current = true;

        const pCanvas = previewCanvasRef.current;
        if (pCanvas) {
            const pCtx = pCanvas.getContext('2d');
            pCtx.imageSmoothingEnabled = false;
            pCtx.setTransform(1, 0, 0, 1, 0, 0);
            pCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
            pCtx.clearRect(0, 0, canvas.width, canvas.height);
        }
    };

    const draw = (e) => {
        if (!isDrawing.current || e.nativeEvent.pointerId !== drawingPointerId.current) return;
        const canvas = canvasRef.current; const rect = canvas.getBoundingClientRect();
        const offsetX = e.nativeEvent.clientX - rect.left; const offsetY = e.nativeEvent.clientY - rect.top;
        strokePoints.current.push({ x: offsetX, y: offsetY, pressure: e.nativeEvent.pressure || 0.5 });

        const pts = strokePoints.current;
        const ctx = canvas.getContext('2d');

        if (tool === 'eraser' && eraserMode === 'stroke') {
            const eraserRadius = 30; let hit = false;
            const nextStrokes = strokes.filter(s => {
                const isHit = s.points.some(p => Math.hypot(p.x - offsetX, p.y - offsetY) < eraserRadius);
                if (isHit) hit = true;
                return !isHit;
            });
            if (hit) {
                setStrokes(nextStrokes);
                redrawCanvas(canvas, nextStrokes);
            }
            if (onPointerErase) onPointerErase(e.nativeEvent.clientX, e.nativeEvent.clientY);
        } else if (tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out'; ctx.lineWidth = 25; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(startX.current, startY.current); ctx.lineTo(offsetX, offsetY); ctx.stroke();
            startX.current = offsetX; startY.current = offsetY;
            if (onPointerErase) onPointerErase(e.nativeEvent.clientX, e.nativeEvent.clientY);
        } else if (tool === 'pen') {
            if (isSnapped.current) return;
            const pCanvas = previewCanvasRef.current; const pCtx = pCanvas?.getContext('2d');
            if (pCtx) {
                pCtx.imageSmoothingEnabled = false;
                pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
                const stroke = getStroke(pts, { size: lineWidth, thinning: 0.2, smoothing: 0.8, streamline: 0.8, simulatePressure: e.nativeEvent.pointerType !== 'pen' });
                const pathData = getSvgPathFromStroke(stroke); const path = new Path2D(pathData);
                pCtx.fillStyle = color; pCtx.shadowBlur = 0.5; pCtx.shadowColor = color;
                pCtx.fill(path);
            }
            clearTimeout(holdTimeout.current);
            holdTimeout.current = setTimeout(() => { if (isDrawing.current && !isSnapped.current) snapShape(); }, 600);
        } else {
            ctx.putImageData(snapshot.current, 0, 0); ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = lineWidth;
            ctx.shadowBlur = 1; ctx.shadowColor = color;
            if (tool === 'line') { ctx.moveTo(startX.current, startY.current); ctx.lineTo(offsetX, offsetY); }
            else if (tool === 'rectangle') { ctx.rect(startX.current, startY.current, offsetX - startX.current, offsetY - startY.current); }
            else if (tool === 'circle') { ctx.arc(startX.current, startY.current, Math.hypot(offsetX - startX.current, offsetY - startY.current), 0, 2 * Math.PI); }
            ctx.stroke();
        }
    };

    const abortDrawing = () => {
        if (!isDrawing.current) return;
        clearTimeout(holdTimeout.current);
        isDrawing.current = false;
        const canvas = canvasRef.current;
        if (canvas && preStrokeSnapshot.current) {
            canvas.getContext('2d').putImageData(preStrokeSnapshot.current, 0, 0);
        }
    };

    const stopDrawing = (e) => {
        if (!isDrawing.current || (e && e.nativeEvent.pointerId !== drawingPointerId.current)) return;
        drawingPointerId.current = null;
        clearTimeout(holdTimeout.current);
        isDrawing.current = false;
        const canvas = canvasRef.current;

        if (canvas) {
            let nextStrokes = strokes;
            if (tool !== 'eraser' || eraserMode !== 'stroke') {
                if (!isSnapped.current) {
                    const newStroke = {
                        points: [...strokePoints.current], tool, color,
                        width: tool === 'eraser' ? 25 : lineWidth, id: Date.now()
                    };
                    nextStrokes = [...strokes, newStroke];
                    setStrokes(nextStrokes);
                    redrawCanvas(canvas, nextStrokes);
                }
            }
            if (previewCanvasRef.current) previewCanvasRef.current.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
            if (onStrokeEnd) onStrokeEnd(nextStrokes);
        }
    };

    return (
        <>
            <canvas
                ref={canvasRef}
                style={{
                    position: "absolute", top: 0, left: 0,
                    zIndex: isDrawingMode ? zIndex : 2,
                    pointerEvents: 'none', opacity: 1,
                    userSelect: 'none', WebkitUserSelect: 'none'
                }}
            />
            <canvas
                ref={previewCanvasRef}
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
                    if (isDrawing.current && e.pointerId === drawingPointerId.current) {
                        e.preventDefault(); draw(e);
                    } else {
                        const touches = Array.from(activePointers.current.values()).filter(t => t === 'touch');
                        if (touches.length > 1) abortDrawing();
                    }
                }}
                onPointerUp={(e) => {
                    activePointers.current.delete(e.pointerId);
                    if (isDrawing.current && e.pointerId === drawingPointerId.current) {
                        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { }
                        stopDrawing(e);
                    }
                }}
                onPointerLeave={(e) => {
                    if (isDrawing.current && e.pointerId === drawingPointerId.current) stopDrawing(e);
                }}
                onPointerCancel={(e) => {
                    activePointers.current.delete(e.pointerId); abortDrawing();
                }}
                style={{
                    position: "absolute", top: 0, left: 0,
                    zIndex: isDrawingMode ? zIndex + 1 : 2,
                    pointerEvents: isDrawingMode ? 'auto' : 'none',
                    opacity: 1, touchAction: 'none',
                    userSelect: 'none', WebkitUserSelect: 'none'
                }}
            />
        </>
    );
}