import React from 'react';

const AnnotationToolbar = ({ 
  isDrawingMode, setIsDrawingMode,
  drawTool, setDrawTool,
  penColor, setPenColor,
  penWidth, setPenWidth,
  eraserMode, setEraserMode,
  canUndo, handleUndo,
  canRedo, handleRedo,
  onClear,
  activeMenu, setActiveMenu,
  toolbarStyle = {}
}) => {
  const tb = {
    wrap: {
      display: 'flex', gap: '8px', padding: '8px 12px', background: 'rgba(23, 25, 35, 0.85)',
      backdropFilter: 'blur(12px)', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.3)', pointerEvents: 'auto', ...toolbarStyle
    },
    pill: (active, color, bg) => ({
      padding: '8px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer',
      background: active ? bg : 'rgba(255,255,255,0.05)',
      color: active ? '#fff' : '#ccc', fontWeight: 'bold', fontSize: '0.85rem',
      display: 'flex', alignItems: 'center', gap: '6px', transition: 'all 0.2s'
    }),
    sep: { width: '1px', height: '24px', background: 'rgba(255,255,255,0.1)', alignSelf: 'center' },
    dot: (active, color) => ({
      width: '18px', height: '18px', borderRadius: '50%', background: color,
      border: active ? '2px solid white' : '2px solid transparent', cursor: 'pointer'
    }),
    toolBtn: (active) => ({
      padding: '6px', borderRadius: '6px', border: 'none', background: active ? 'rgba(124, 111, 255, 0.2)' : 'transparent',
      color: active ? '#7c6fff' : '#fff', cursor: 'pointer', fontSize: '1.1rem'
    })
  };

  const popoverStyle = {
    position: 'absolute', top: '100%', left: '0', marginTop: '8px', padding: '8px',
    background: '#1a1c2e', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', gap: '8px', zIndex: 10002, boxShadow: '0 4px 20px rgba(0,0,0,0.4)'
  };

  const penColors = [
    { c: '#FF003C', n: 'Red' }, { c: '#00D0FF', n: 'Blue' }, { c: '#00FF33', n: 'Green' },
    { c: '#FFEA00', n: 'Yellow' }, { c: '#FFFFFF', n: 'White' }
  ];

  const tools = [
    { v: 'pen', icon: '✏️', label: 'Pen' },
    { v: 'line', icon: '╱', label: 'Line' },
    { v: 'rectangle', icon: '▭', label: 'Rect' },
    { v: 'circle', icon: '◯', label: 'Circle' }
  ];

  return (
    <div style={tb.wrap}>
      <button 
        onClick={() => { setIsDrawingMode(!isDrawingMode); setActiveMenu(null); if (!isDrawingMode && drawTool === 'eraser') setDrawTool('pen'); }} 
        style={tb.pill(isDrawingMode && drawTool !== 'eraser', '#7c6fff', '#4a90d9')}
      >
        ✏️ Pen
      </button>

      <div style={{ position: 'relative' }}>
        <button 
          onClick={() => { 
            if (isDrawingMode && drawTool === 'eraser') setActiveMenu(activeMenu === 'eraser' ? null : 'eraser');
            else { setIsDrawingMode(true); setDrawTool('eraser'); setActiveMenu(null); }
          }} 
          style={tb.pill(isDrawingMode && drawTool === 'eraser', '#ff4757', '#c0392b')}
        >
          🧽 {eraserMode === 'precision' ? 'Precision' : 'Stroke'} Eraser ▼
        </button>
        {activeMenu === 'eraser' && (
          <div style={popoverStyle}>
            <button onClick={() => { setEraserMode('precision'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'precision')}>🎯 Precision</button>
            <button onClick={() => { setEraserMode('stroke'); setActiveMenu(null); }} style={tb.toolBtn(eraserMode === 'stroke')}>🌊 Stroke</button>
            <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)' }} />
            <button onClick={() => { onClear(); setActiveMenu(null); }} style={{ ...tb.toolBtn(false), color: '#ff4757' }}>🗑️ Clear All</button>
          </div>
        )}
      </div>

      <div style={tb.sep} />

      <button onClick={handleUndo} style={tb.toolBtn(false)} disabled={!canUndo} style={{ opacity: canUndo ? 1 : 0.4 }}>↩</button>
      <button onClick={handleRedo} style={tb.toolBtn(false)} disabled={!canRedo} style={{ opacity: canRedo ? 1 : 0.4 }}>↪</button>

      {isDrawingMode && drawTool !== 'eraser' && (
        <>
          <div style={tb.sep} />
          
          <div style={{ position: 'relative' }}>
            <button onClick={() => setActiveMenu(activeMenu === 'tool' ? null : 'tool')} style={tb.toolBtn(true)}>
              {tools.find(t => t.v === drawTool)?.icon} ▼
            </button>
            {activeMenu === 'tool' && (
              <div style={popoverStyle}>
                {tools.map(({ v, icon, label }) => (
                  <button key={v} title={label} onClick={() => { setDrawTool(v); setActiveMenu(null); }} style={tb.toolBtn(drawTool === v)}>{icon}</button>
                ))}
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button onClick={() => setActiveMenu(activeMenu === 'color' ? null : 'color')} style={{ ...tb.pill(false), padding: '6px' }}>
              <div style={tb.dot(true, penColor)} /> ▼
            </button>
            {activeMenu === 'color' && (
              <div style={popoverStyle}>
                {penColors.map(({ c, n }) => (
                  <button key={c} title={n} onClick={() => { setPenColor(c); setActiveMenu(null); }} style={tb.dot(penColor === c, c)} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default AnnotationToolbar;
