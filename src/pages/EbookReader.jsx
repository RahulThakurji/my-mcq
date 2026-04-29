import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import { electromagnetism } from '../data/ebooks/physics/electromagnetism';
import LatexRenderer from '../components/LatexRenderer';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import AnnotationCanvas from '../components/AnnotationCanvas';
import AnnotationToolbar from '../components/AnnotationToolbar';

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
  const [canvasData, setCanvasData] = useState(null); 
  const [savedContent, setSavedContent] = useState({}); 
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // --- Refs ---
  const canvasRef = useRef(null);
  const contentAreaRef = useRef(null);
  const textRefs = useRef({}); 
  const pendingUpdatesRef = useRef({});

  const getContent = () => {
    if (ebookId === '1') return historicalBackground; 
    if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContent();

  // --- Persistence ---
  useEffect(() => {
    if (!user || !ebookId || !chapterId) { setIsInitialLoadComplete(true); return; }
    const docRef = doc(db, 'users', user.uid, 'ebooks', `${ebookId}-${chapterId}`);
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.drawingData !== undefined) setCanvasData(data.drawingData);
        if (data.savedContent !== undefined) setSavedContent(data.savedContent);
      } else if (!docSnap.exists()) {
        setCanvasData(null); setSavedContent({});
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
    if (!user || Object.keys(pendingUpdatesRef.current).length === 0 && !hasUnsavedChanges) return;
    setIsSaving(true);
    pendingUpdatesRef.current = {};
    try {
      const docRef = doc(db, 'users', user.uid, 'ebooks', `${ebookId}-${chapterId}`);
      const drawingData = canvasRef.current?.getData();
      await updateDoc(docRef, { 
        drawingData: drawingData || null,
        savedContent: savedContent,
        lastUpdated: new Date()
      });
      setHasUnsavedChanges(false);
    } catch (err) {
      setHasUnsavedChanges(true);
    } finally { setIsSaving(false); }
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
    pill: (active, color, activeColor) => ({ padding: '6px 14px', borderRadius: '25px', border: 'none', background: active ? (activeColor || color) : 'transparent', color: active ? 'white' : '#ccc', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }),
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', paddingBottom: '100px', userSelect: 'none' }}>
      <div style={{ position: 'fixed', bottom: '30px', left: '50%', transform: 'translateX(-50%)', zIndex: 10001 }}>
        <AnnotationToolbar 
          isDrawingMode={isDrawingMode} setIsDrawingMode={setIsDrawingMode}
          drawTool={drawTool} setDrawTool={setDrawTool}
          penColor={penColor} setPenColor={setPenColor}
          penWidth={penWidth} setPenWidth={setPenWidth}
          eraserMode={eraserMode} setEraserMode={setEraserMode}
          canUndo={historyState.undo > 0}
          handleUndo={() => canvasRef.current?.undo()}
          canRedo={historyState.redo > 0}
          handleRedo={() => canvasRef.current?.redo()}
          onClear={() => canvasRef.current?.clear()}
          activeMenu={activeMenu} setActiveMenu={setActiveMenu}
        />
        <div style={{ marginTop: '8px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
          <button onClick={() => { setIsHighlightMode(!isHighlightMode); setIsDrawingMode(false); setActiveMenu(null); }} style={tb.pill(isHighlightMode, '#ff9f43', '#ee5a24')}>🖍️ Highlighter</button>
          <button onClick={manualSaveToCloud} style={tb.pill(hasUnsavedChanges, '#ff9800', '#e67e22')} disabled={isSaving}>{isSaving ? '⏳' : '💾'} {hasUnsavedChanges ? 'Save' : 'Saved'}</button>
        </div>
      </div>

      <div id="ebook-card" style={{ maxWidth: '750px', margin: '40px auto 0', background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #eee', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div><span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span><h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1></div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>
        
        <div id="content-area" ref={contentAreaRef} 
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
             <AnnotationCanvas 
                ref={canvasRef}
                id={`${ebookId}-${chapterId}`}
                isDrawingMode={isDrawingMode}
                drawTool={drawTool}
                penColor={penColor}
                penWidth={penWidth}
                eraserMode={eraserMode}
                initialData={canvasData}
                onDrawingUpdate={(data) => {
                   setHasUnsavedChanges(true);
                }}
             />
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