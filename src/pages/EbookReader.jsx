import { useParams, useNavigate } from 'react-router-dom';
import { historicalBackground } from '../data/ebooks/polity/historicalBackground';
import { electromagnetism } from '../data/ebooks/physics/electromagnetism';
import LatexRenderer from '../components/LatexRenderer';

function EbookReader() {
  const { ebookId, chapterId } = useParams();
  const navigate = useNavigate();

  const getContent = () => {
    if (ebookId === '1') return historicalBackground; 
    if (ebookId === '4') return electromagnetism;
    return historicalBackground;
  };
  const chapterData = getContent();


  const renderContent = (item, index) => {
    const contentText = item.type === 'list' ? `${item.items.map(li => `• ${li}`).join('\n')}` : item.text;
    
    let defaultContent;
    if (item.type === 'h2') defaultContent = <h2 style={{ color: '#1a237e', marginTop: '2rem', borderBottom: '2px solid #eee', paddingBottom: '0.5rem' }}><LatexRenderer>{contentText}</LatexRenderer></h2>;
    else if (item.type === 'h3') defaultContent = <h3 style={{ color: '#283593', marginTop: '1.5rem' }}><LatexRenderer>{contentText}</LatexRenderer></h3>;
    else if (item.type === 'p') defaultContent = <p style={{ lineHeight: '1.8', color: '#333', marginBottom: '1.2rem', textAlign: 'justify' }}><LatexRenderer>{contentText}</LatexRenderer></p>;
    else if (item.type === 'list') defaultContent = <div style={{ marginBottom: '1.5rem', paddingLeft: '1.5rem', lineHeight: '1.8', color: '#444' }}><LatexRenderer>{contentText}</LatexRenderer></div>;
    
    return (
      <div key={index} style={{ position: 'relative', marginBottom: '10px' }}>
        <div style={{ position: 'relative', zIndex: 1 }}>
          {defaultContent}
        </div>
      </div>
    );
  };


  return (
    <div style={{ background: '#f8f9fa', minHeight: '100vh', padding: '20px' }}>
      <div id="ebook-card" style={{ maxWidth: '750px', margin: '40px auto 0', background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', border: '1px solid #eee', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem', borderBottom: '1px solid #eee', paddingBottom: '1rem' }}>
          <div><span style={{ fontSize: '0.9rem', color: '#7c6fff', fontWeight: 'bold', textTransform: 'uppercase' }}>{chapterData.bookTitle}</span><h1 style={{ margin: '0', fontSize: '2rem', color: '#1a237e' }}>{chapterData.title}</h1></div>
          <button onClick={() => navigate('/ebooks')} style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', color: '#666' }}>✕ Close</button>
        </div>
        
        <div id="content-area" style={{ fontSize: '1.1rem', position: 'relative' }}>
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