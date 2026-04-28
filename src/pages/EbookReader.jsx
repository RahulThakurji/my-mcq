import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import LatexRenderer from '../components/LatexRenderer';


function EbookReader() {
  const { ebookId, chapterId } = useParams();
  const navigate = useNavigate();

  // For now, we only have one chapter implemented
  const chapterData = historicalBackground;

  const renderContent = (item, index) => {
    switch (item.type) {
      case 'h2':
        return <h2 key={index} style={{ color: '#1a237e', marginTop: '2rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}><LatexRenderer>{item.text}</LatexRenderer></h2>;
      case 'h3':
        return <h3 key={index} style={{ color: '#283593', marginTop: '1.5rem' }}><LatexRenderer>{item.text}</LatexRenderer></h3>;
      case 'p':
        return <p key={index} style={{ lineHeight: '1.8', color: '#333', marginBottom: '1.2rem', textAlign: 'justify' }}><LatexRenderer>{item.text}</LatexRenderer></p>;

      case 'list':
        return (
          <ul key={index} style={{ marginBottom: '1.5rem', paddingLeft: '1.5rem' }}>
            {item.items.map((li, i) => (
              <li key={i} style={{ marginBottom: '0.8rem', lineHeight: '1.6', color: '#444' }}>{li}</li>
            ))}
          </ul>
        );
      default:
        return null;
    }
  };

  return (
    <div style={{ background: '#f5f5f5', minHeight: '100vh', padding: '2rem 1rem' }}>
      <div style={{ 
        maxWidth: '800px', 
        margin: '0 auto', 
        background: 'white', 
        padding: '3rem', 
        borderRadius: '8px', 
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        position: 'relative'
      }}>
        {/* Navigation / Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div>
            <span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span>
            <h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1>
          </div>
          <button 
            onClick={() => navigate('/ebooks')}
            style={{ 
              padding: '8px 16px', 
              background: '#f0f0f0', 
              border: 'none', 
              borderRadius: '6px', 
              cursor: 'pointer',
              fontWeight: 'bold',
              color: '#666'
            }}>
            ✕ Close
          </button>
        </div>

        {/* Content Area */}
        <div style={{ fontSize: '1.1rem' }}>
          {chapterData.content.map((item, index) => renderContent(item, index))}
        </div>

        {/* Footer Navigation */}
        <div style={{ marginTop: '4rem', paddingTop: '2rem', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'space-between' }}>
          <button style={{ padding: '10px 20px', background: '#eee', border: 'none', borderRadius: '6px', color: '#999', cursor: 'not-allowed' }}>
            ← Previous Chapter
          </button>
          <button 
            onClick={() => alert("Next chapter coming soon!")}
            style={{ padding: '10px 20px', background: '#1a237e', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>
            Next Chapter →
          </button>
        </div>
      </div>
    </div>
  );
}

export default EbookReader;
