import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import { electromagnetism } from '../data/ebooks/physics/electromagnetism';
import LatexRenderer from '../components/LatexRenderer';

// Import the modular components
import { AnnotationToolbar, CanvasOverlay } from '../components/GlobalAnnotationTool';

export default function EbookReader() {
  const { ebookId, chapterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // --- Shared Tool States ---
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [drawTool, setDrawTool] = useState('pen');
  const [penColor, setPenColor] = useState('#FF003C');
  const [highlightColor, setHighlightColor] = useState('#FFF800');
  const [penWidth, setPenWidth] = useState(3);
  const [eraserMode, setEraserMode] = useState('precision');

  // --- Data States ---
  const [strokes, setStrokes] = useState([]);
  const [savedContent, setSavedContent] = useState({});
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);

  // --- Refs ---
  const undoHistoryRef = useRef([]);
  const redoHistoryRef = useRef([]);
  const contentAreaRef = useRef(null);
  const textRefs = useRef({});
  const isHighlightErased = useRef(false);
  const pendingUpdatesRef = useRef({});

  // Selection Lock
  useEffect(() => {
    document.body.style.userSelect = isDrawingMode ? 'none' : 'auto';
    document.body.style.webkitUserSelect = isDrawingMode ? 'none' : 'auto';
    document.body.style.webkitTouchCallout = isDrawingMode ? 'none' : 'default';
  }, [isDrawingMode]);

  // Persistence
  useEffect(() => {
    if (!user || !ebookId || !chapterId) { setIsInitialLoadComplete(true); return; }
    const docRef = doc(db, 'users', user.uid, 'ebooks', `${ebookId}-${chapterId}`);

    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists() && !docSnap.metadata.hasPendingWrites) {
        const data = docSnap.data();
        if (data.strokes !== undefined) setStrokes(data.strokes || []);
        if (data.savedContent !== undefined) setSavedContent(data.savedContent || {});
      } else if (!docSnap.exists()) {
        setStrokes([]); setSavedContent({});
        setDoc(docRef, { strokes: [], savedContent: {} }).catch(() => { });
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

  const updateHistoryState = () => {
    setHistoryState({ undo: undoHistoryRef.current.length || 0, redo: redoHistoryRef.current.length || 0 });
  };

  // --- Drawing Tool Intercepts ---
  const handleStrokeStart = () => {
    undoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });
    if (undoHistoryRef.current.length > 20) undoHistoryRef.current.shift();
    redoHistoryRef.current = [];
    updateHistoryState();
  };

  const handlePointerErase = (clientX, clientY) => {
    Object.keys(textRefs.current).forEach(index => {
      const textRef = textRefs.current[index];
      if (textRef) {
        const spans = textRef.querySelectorAll('span[style*="background-color"]');
        spans.forEach(span => {
          const rcts = span.getClientRects(); let hit = false;
          for (let i = 0; i < rcts.length; i++) {
            const r = rcts[i];
            if (clientX >= r.left - 5 && clientX <= r.right + 5 && clientY >= r.top - 5 && clientY <= r.bottom + 5) { hit = true; break; }
          }
          if (hit) {
            const parent = span.parentNode; while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span); isHighlightErased.current = true;
          }
        });
      }
    });
  };

  const handleStrokeEnd = (newStrokes) => {
    if (isHighlightErased.current) {
      const nextSavedContent = {};
      Object.keys(textRefs.current).forEach(idx => { if (textRefs.current[idx]) nextSavedContent[idx] = textRefs.current[idx].innerHTML; });
      setSavedContent(nextSavedContent);
      queueUpdate({ savedContent: nextSavedContent, strokes: newStrokes });
      isHighlightErased.current = false;
    } else {
      queueUpdate({ strokes: newStrokes });
    }
  };

  // --- History Controls ---
  const handleUndo = () => {
    if (!undoHistoryRef.current.length) return;
    const prevState = undoHistoryRef.current.pop();
    redoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });

    setStrokes(prevState.strokes);
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
    if (nextState.html) {
      setSavedContent(nextState.html);
      setTimeout(() => { Object.keys(nextState.html).forEach(idx => { if (textRefs.current[idx]) textRefs.current[idx].innerHTML = nextState.html[idx]; }); }, 0);
    }
    queueUpdate({ strokes: nextState.strokes, savedContent: nextState.html });
    updateHistoryState();
  };

  const clearPage = () => {
    undoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });
    setStrokes([]);
    queueUpdate({ strokes: [] });
    updateHistoryState();
  };

  // --- Highlighter Logic ---
  const handleHighlightMouseUp = (index) => {
    if (!isHighlightMode) return;
    const selection = window.getSelection(); if (!selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0); const textRef = textRefs.current[index];
    if (!textRef || !textRef.contains(range.commonAncestorContainer)) return;

    undoHistoryRef.current.push({ strokes: [...strokes], html: { ...savedContent } });
    if (undoHistoryRef.current.length > 20) undoHistoryRef.current.shift();
    redoHistoryRef.current = [];
    updateHistoryState();

    const span = document.createElement('span'); span.style.backgroundColor = highlightColor; span.style.borderRadius = '3px';
    try { range.surroundContents(span); } catch { return; }
    selection.removeAllRanges();
    const nextSavedContent = { ...savedContent, [index]: textRef.innerHTML };
    setSavedContent(nextSavedContent); queueUpdate({ savedContent: nextSavedContent });
  };

  // --- Content Loading ---
  const getContentData = () => {
    if (ebookId === '1') return historicalBackground;
    if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContentData();

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
          <div ref={el => textRefs.current[index] = el} onPointerUp={() => handleHighlightMouseUp(index)} style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none' }} dangerouslySetInnerHTML={{ __html: savedContent[index] }} />
        ) : (
          <div ref={el => textRefs.current[index] = el} onPointerUp={() => handleHighlightMouseUp(index)} style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none' }}>
            {defaultContent}
          </div>
        )}
      </div>
    );
  };

  const getCustomCursor = () => {
    if (!isDrawingMode) return 'default';
    if (drawTool === 'eraser') return `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><circle cx="12" cy="12" r="10" fill="white" opacity="0.8"/></svg>') 12 12, cell`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${penWidth + 4}" height="${penWidth + 4}" viewBox="0 0 ${penWidth + 4} ${penWidth + 4}"><circle cx="${(penWidth + 4) / 2}" cy="${(penWidth + 4) / 2}" r="${penWidth / 2}" fill="${encodeURIComponent(penColor)}" fill-opacity="1" stroke="rgba(0,0,0,0.1)" stroke-width="1"/></svg>`;
    return `url('data:image/svg+xml;utf8,${svg}') ${(penWidth + 4) / 2} ${(penWidth + 4) / 2}, crosshair`;
  };

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '2rem 1rem' }}>

      {/* 1. RENDER MODULAR TOOLBAR */}
      <AnnotationToolbar
        isDrawingMode={isDrawingMode} setIsDrawingMode={setIsDrawingMode}
        isHighlightMode={isHighlightMode} setIsHighlightMode={setIsHighlightMode}
        drawTool={drawTool} setDrawTool={setDrawTool}
        eraserMode={eraserMode} setEraserMode={setEraserMode}
        penColor={penColor} setPenColor={setPenColor}
        highlightColor={highlightColor} setHighlightColor={setHighlightColor}
        penWidth={penWidth} setPenWidth={setPenWidth}
        canUndo={historyState.undo > 0} handleUndo={handleUndo}
        canRedo={historyState.redo > 0} handleRedo={handleRedo}
        hasUnsavedChanges={hasUnsavedChanges} isSaving={isSaving} manualSaveToCloud={manualSaveToCloud}
        onClearPage={clearPage}
      />

      <div style={{ maxWidth: '800px', margin: '40px auto 0', background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #eee', position: 'relative' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div><span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span><h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1></div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>

        {/* TEXT CONTENT CONTAINER */}
        <div id="content-area" ref={contentAreaRef}
          style={{
            fontSize: '1.1rem', position: 'relative',
            touchAction: isDrawingMode ? 'pinch-zoom' : 'auto',
            userSelect: isDrawingMode ? 'none' : 'auto',
            WebkitUserSelect: isDrawingMode ? 'none' : 'auto',
            WebkitTouchCallout: 'none',
            cursor: isDrawingMode ? getCustomCursor() : 'default'
          }}
        >
          {chapterData.content.map((item, index) => renderContent(item, index))}

          {/* 2. RENDER MODULAR CANVAS OVERLAY */}
          {isInitialLoadComplete && (
            <CanvasOverlay
              containerRef={contentAreaRef}
              isDrawingMode={isDrawingMode}
              tool={drawTool}
              color={penColor}
              lineWidth={penWidth}
              eraserMode={eraserMode}
              strokes={strokes}
              setStrokes={setStrokes}
              onStrokeStart={handleStrokeStart}
              onStrokeEnd={handleStrokeEnd}
              onPointerErase={handlePointerErase}
              zIndex={100}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ marginTop: '4rem', paddingTop: '2rem', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
          <button style={{ padding: '10px 20px', background: '#eee', border: 'none', borderRadius: '6px', color: '#999', cursor: 'not-allowed' }}>← Previous Chapter</button>
          <button onClick={() => alert("Next chapter coming soon!")} style={{ padding: '10px 20px', background: '#1a237e', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>Next Chapter →</button>
        </div>
      </div>
    </div>
  );
}