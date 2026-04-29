import React, { useState, useEffect, useRef } from 'react';
import { getStroke } from 'perfect-freehand';

export function getSvgPathFromStroke(stroke) {
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

// ==========================================
// 1. ANNOTATION TOOLBAR COMPONENT
// ==========================================
export function AnnotationToolbar({
    isDrawingMode, setIsDrawingMode,
    isHighlightMode, setIsHighlightMode,
    drawTool, setDrawTool,
    eraserMode, setEraserMode,
    penColor, setPenColor,
    highlightColor, setHighlightColor,
    penWidth, setPenWidth,
    canUndo, handleUndo,
    canRedo, handleRedo,
    hasUnsavedChanges, isSaving, manualSaveToCloud,
    onClearPage, onDownloadPDF, onDownloadImage
}) {
    const [activeMenu, setActiveMenu] = useState(null);
    const [toolbarStyle, setToolbarStyle] = useState({
        position: 'fixed', top: '15px', left: '50%', transform: 'translateX(-50%)',
        zIndex: 10000, width: 'max-content'
    });

    useEffect(() => {
        const updateToolbar = () => {
            if (window.visualViewport) {
                const vv = window.visualViewport;
                setToolbarStyle({
                    position: 'fixed', top: `${vv.offsetTop + 15}px`, left: `${vv.offsetLeft + (vv.width / 2)}px`,
                    transform: `translate(-50%, 0) scale(${1 / vv.scale})`, transformOrigin: 'top center', zIndex: 10000, width: 'max-content'
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

    const tb = {
        wrap: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%)', borderRadius: '50px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '1.5px solid rgba(255,255,255,0.1)', flexWrap: "nowrap" },
        pill: (active, color, activeColor) => ({ padding: '6px 14px', borderRadius: '25px', border: active && !activeColor ? '1.5px solid white' : 'none', background: active ? (activeColor || color) : 'rgba(255,255,255,0.08)', color: active ? 'white' : '#ccc', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }),
        toolBtn: (active) => ({ padding: '8px 12px', borderRadius: '8px', border: 'none', background: active ? 'rgba(124,111,255,0.35)' : 'transparent', color: active ? '#c9c4ff' : '#bbb', cursor: 'pointer', textAlign: 'left', display: 'block', width: '100%', fontSize: '14px' }),
        undoBtn: (active) => ({ padding: '6px 10px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', color: active ? 'white' : '#555', cursor: active ? 'pointer' : 'not-allowed', fontSize: '1.1rem' }),
        dot: (active, color) => ({ width: '18px', height: '18px', borderRadius: '50%', background: color, border: active ? '2px solid white' : 'none', cursor: 'pointer' }),
        card: { display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(255,255,255,0.06)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer', color: '#ccc', fontSize: '14px', fontWeight: 'bold' },
        sep: { width: '1px', height: '24px', background: 'rgba(255,255,255,0.15)', margin: '0 4px' }
    };

    const popoverStyle = { position: 'absolute', top: 'calc(100% + 10px)', left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%)', padding: '8px', borderRadius: '12px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: '1.5px solid rgba(255,255,255,0.1)', display: 'flex', gap: '6px', flexDirection: 'column', minWidth: '160px', zIndex: 10002 };

    const penColors = [{ c: '#FF003C', n: 'Red' }, { c: '#00D0FF', n: 'Cyan' }, { c: '#00FF33', n: 'Green' }, { c: '#FF8800', n: 'Orange' }, { c: '#D500F9', n: 'Purple' }, { c: '#111111', n: 'Black' }, { c: '#FFFFFF', n: 'White' }];
    const hlColors = [{ c: '#FFF800', n: 'Yellow' }, { c: '#00FF66', n: 'Green' }, { c: '#FF007F', n: 'Pink' }, { c: '#00E5FF', n: 'Blue' }];
    const tools = [{ v: 'pen', icon: '✏️', label: 'Pen' }, { v: 'line', icon: '╱', label: 'Line' }, { v: 'rectangle', icon: '▭', label: 'Rect' }, { v: 'circle', icon: '◯', label: 'Circle' }];

    return (
        <div style={toolbarStyle}>
            <div style={tb.wrap}>
                <button onClick={() => { if (isDrawingMode && drawTool !== 'eraser') setIsDrawingMode(false); else { setIsDrawingMode(true); setIsHighlightMode(false); if (drawTool === 'eraser') setDrawTool('pen'); setActiveMenu(null); } }} style={tb.pill(isDrawingMode && drawTool !== 'eraser', '#4a90d9', '#5c80ff')}>✏️ Pen</button>
                <button onClick={() => { setIsHighlightMode(!isHighlightMode); setIsDrawingMode(false); setActiveMenu(null); }} style={tb.pill(isHighlightMode, '#ff9f43', '#ee5a24')}>🖍️ Highlighter</button>

                <div style={{ position: 'relative' }}>
                    <button onClick={() => { if (isDrawingMode && drawTool === 'eraser') setActiveMenu(activeMenu === 'eraser' ? null : 'eraser'); else { setIsDrawingMode(true); setIsHighlightMode(false); setDrawTool('eraser'); setActiveMenu(null); } }} style={tb.pill(isDrawingMode && drawTool === 'eraser', '#ff4757', '#c0392b')}>🧽 {eraserMode === 'precision' ? 'Precision' : 'Stroke'} Eraser ▼</button>
                    {activeMenu === 'eraser' && (
                        <div style={popoverStyle}>
                            <button onClick={() => { setEraserMode('precision'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'precision')}>🎯 Precision Eraser</button>
                            <button onClick={() => { setEraserMode('stroke'); setDrawTool('eraser'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'stroke')}>🌊 Stroke Eraser</button>
                            {onClearPage && (
                                <>
                                    <div style={{ ...tb.sep, width: '100%', height: '1px', margin: '4px 0' }} />
                                    <button onClick={() => { if (window.confirm('Clear all drawings on this page?')) { onClearPage(); setActiveMenu(null); } }} style={{ ...tb.toolBtn(false), color: '#ff4757' }}>🗑️ Clear Page</button>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div style={tb.sep} />
                <button onClick={handleUndo} style={tb.undoBtn(canUndo)} title="Undo">↩</button>
                <button onClick={handleRedo} style={tb.undoBtn(canRedo)} title="Redo">↪</button>
                <div style={tb.sep} />

                <button onClick={manualSaveToCloud} style={tb.pill(hasUnsavedChanges, '#ff9800', '#e67e22')} disabled={isSaving}>{isSaving ? '⏳' : '💾'} {hasUnsavedChanges ? 'Save' : 'Saved'}</button>

                {isHighlightMode && (
                    <>
                        <div style={tb.sep} />
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setActiveMenu(activeMenu === 'hColor' ? null : 'hColor')} style={tb.card}><div style={tb.dot(true, highlightColor)} /> ▼</button>
                            {activeMenu === 'hColor' && (
                                <div style={{ ...popoverStyle, flexDirection: 'row' }}>
                                    {hlColors.map(({ c, n }) => <button key={c} title={n} onClick={() => { setHighlightColor(c); setActiveMenu(null); }} style={tb.dot(highlightColor === c, c)} />)}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {isDrawingMode && drawTool !== 'eraser' && (
                    <>
                        <div style={tb.sep} />
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setActiveMenu(activeMenu === 'tool' ? null : 'tool')} style={tb.card}>{tools.find(t => t.v === drawTool)?.icon} ▼</button>
                            {activeMenu === 'tool' && (
                                <div style={popoverStyle}>
                                    {tools.map(({ v, icon, label }) => <button key={v} title={label} onClick={() => { setDrawTool(v); setActiveMenu(null); }} style={tb.toolBtn(drawTool === v)}>{icon} {label}</button>)}
                                </div>
                            )}
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setActiveMenu(activeMenu === 'color' ? null : 'color')} style={tb.card}><div style={tb.dot(true, penColor)} /> ▼</button>
                            {activeMenu === 'color' && (
                                <div style={{ ...popoverStyle, flexDirection: 'row', flexWrap: 'wrap', width: '120px' }}>
                                    {penColors.map(({ c, n }) => <button key={c} title={n} onClick={() => { setPenColor(c); setActiveMenu(null); }} style={tb.dot(penColor === c, c)} />)}
                                </div>
                            )}
                        </div>
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setActiveMenu(activeMenu === 'size' ? null : 'size')} style={tb.card}><span style={{ color: penColor }}>•</span> {penWidth} ▼</button>
                            {activeMenu === 'size' && (
                                <div style={{ ...popoverStyle, padding: "12px", width: "160px" }}>
                                    <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} style={{ width: "100%", accentColor: "#7c6fff" }} />
                                </div>
                            )}
                        </div>
                    </>
                )}

                {(onDownloadPDF || onDownloadImage) && (
                    <>
                        <div style={tb.sep} />
                        <div style={{ position: 'relative' }}>
                            <button onClick={() => setActiveMenu(activeMenu === 'dl' ? null : 'dl')} style={tb.pill(true, '#2196f3', '#1976d2')}>📥 Download ▼</button>
                            {activeMenu === 'dl' && (
                                <div style={popoverStyle}>
                                    {onDownloadImage && <button onClick={() => { onDownloadImage(); setActiveMenu(null); }} style={tb.toolBtn(false)}>🖼️ Current Page (PNG)</button>}
                                    {onDownloadPDF && <button onClick={() => { onDownloadPDF(); setActiveMenu(null); }} style={tb.toolBtn(false)}>📄 Full Notes (PDF)</button>}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ==========================================
// 2. CANVAS OVERLAY COMPONENT
// ==========================================
export function CanvasOverlay({
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
                canvas.style.width = `${container.offsetWidth}px`; canvas.style.height = `${container.offsetHeight}px`;
                pCanvas.width = tw; pCanvas.height = th;
                pCanvas.style.width = `${container.offsetWidth}px`; pCanvas.style.height = `${container.offsetHeight}px`;
                redrawCanvas(canvas, strokes);
            }
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(container);
        handleResize();

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
        if (activePointerType.current === 'pen' && nativeEvent.pointerType === 'touch') return;

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
            <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? zIndex : 2, pointerEvents: 'none', opacity: 1, userSelect: 'none', WebkitUserSelect: 'none' }} />
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
                style={{ position: "absolute", top: 0, left: 0, zIndex: isDrawingMode ? zIndex + 1 : 2, pointerEvents: isDrawingMode ? 'auto' : 'none', opacity: 1, touchAction: isDrawingMode ? 'pinch-zoom' : 'auto', userSelect: 'none', WebkitUserSelect: 'none' }}
            />
        </>
    );
}