import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import { electromagnetism } from '../data/ebooks/physics/electromagnetism';
import LatexRenderer from '../components/LatexRenderer';
import { doc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';

function EbookReader() {
  const { ebookId, chapterId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  // --- States ---
  const [isHighlightMode, setIsHighlightMode] = useState(false);
  const [highlightColor, setHighlightColor] = useState('#FFF800');
  const [savedContent, setSavedContent] = useState({}); // Segmented highlights
  const [isInitialLoadComplete, setIsInitialLoadComplete] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  // --- Refs ---
  const contentContainersRef = useRef({});
  const textRefs = useRef({});
  const pendingUpdatesRef = useRef({});

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
        if (data.savedContent !== undefined) setSavedContent(data.savedContent);
      } else if (!docSnap.exists()) {
        setSavedContent({});
        setDoc(docRef, { savedContent: {} }).catch(() => {});
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

  // --- Highlighter Logic ---
  const handleMouseUp = (index) => {
    if (!isHighlightMode) return;
    const selection = window.getSelection();
    if (!selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const textRef = textRefs.current[index];
    if (!textRef || !textRef.contains(range.commonAncestorContainer)) return;
    
    const span = document.createElement('span');
    span.style.backgroundColor = highlightColor;
    span.style.borderRadius = '3px';
    try {
      range.surroundContents(span);
    } catch {
      return;
    }
    selection.removeAllRanges();
    const nextSavedContent = { ...savedContent, [index]: textRef.innerHTML };
    setSavedContent(nextSavedContent);
    queueUpdate({ savedContent: nextSavedContent });
  };

  const clearHighlight = (index) => {
    setSavedContent(prev => {
      const next = { ...prev };
      delete next[index];
      queueUpdate({ savedContent: next });
      return next;
    });
  };

  const getContent = () => {
    if (ebookId === '1') return historicalBackground;
    if (ebookId === '4') return electromagnetism;
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
      <div key={index} 
        ref={el => contentContainersRef.current[index] = el}
        style={{ position: 'relative', marginBottom: '10px' }}
      >
        <div 
          ref={el => textRefs.current[index] = el} 
          onPointerUp={() => handleMouseUp(index)} 
          style={{ position: 'relative', zIndex: 1, userSelect: isHighlightMode ? 'text' : 'none' }}
        >
          {finalContent}
        </div>
        {savedContent[index] && (
          <button 
            onClick={() => clearHighlight(index)}
            style={{ position: 'absolute', top: '-15px', right: 0, fontSize: '0.7rem', color: '#999', background: 'none', border: 'none', cursor: 'pointer', zIndex: 10 }}
          >
            ✕ Clear Highlight
          </button>
        )}
      </div>
    );
  };

  const tb = {
    card: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: '#ffffff', borderRadius: '50px', boxShadow: '0 4px 15px rgba(0,0,0,0.15)', border: '1px solid #e0e0e0' },
    pill: (active, color, activeColor) => ({ padding: '6px 14px', borderRadius: '25px', border: 'none', background: active ? (activeColor || color) : '#f1f2f6', color: active ? 'white' : '#2f3542', fontSize: '14px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '4px' }),
    sep: { width: '1px', height: '24px', background: '#ddd', margin: '0 4px' }
  };

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={toolbarStyle}>
        <div style={tb.card}>
          <button onClick={() => setIsHighlightMode(!isHighlightMode)} style={tb.pill(isHighlightMode, '#7c6fff')}>
            {isHighlightMode ? '✅ Done' : '🖍️ Highlight Mode'}
          </button>
          
          {isHighlightMode && (
            <>
              <div style={tb.sep} />
              <div style={{ display: 'flex', gap: '4px' }}>
                {['#FFF800', '#FFD700', '#7CFFC4', '#FFBABA'].map(color => (
                  <button 
                    key={color}
                    onClick={() => setHighlightColor(color)}
                    style={{ width: '20px', height: '20px', borderRadius: '50%', background: color, border: highlightColor === color ? '2px solid #333' : '1px solid #ddd', cursor: 'pointer' }}
                  />
                ))}
              </div>
            </>
          )}

          <div style={tb.sep} />
          <button onClick={manualSaveToCloud} style={tb.pill(hasUnsavedChanges, '#2ed573', '#27ae60')} disabled={isSaving}>
            {isSaving ? '⏳ Saving...' : hasUnsavedChanges ? '💾 Save Changes' : '☁️ Saved'}
          </button>
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
