import React, { useState } from 'react';

function Ebooks() {
  const [expandedId, setExpandedId] = useState(null);

  const ebooks = [
    { 
      id: 1, 
      title: 'Indian Polity - Comprehensive Guide', 
      category: 'Polity', 
      price: 'Free',
      chapters: [
        '1. Historical Background',
        '2. Making of the Constitution',
        '3. Salient Features of the Constitution',
        '4. Preamble of the Constitution',
        '5. Union and its Territory',
        '6. Citizenship',
        '7. Fundamental Rights',
        '8. Directive Principles of State Policy',
        '9. Fundamental Duties',
        '10. Amendment of the Constitution'
      ]
    },
    { id: 2, title: 'Modern Indian History', category: 'History', price: 'Premium', chapters: [] },
    { id: 3, title: 'Geography of India', category: 'Geography', price: 'Free', chapters: [] },
  ];

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ color: '#1a237e', marginBottom: '1.5rem' }}>E-Books Library</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>Explore our collection of high-quality study materials and e-books.</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '2rem' }}>
        {ebooks.map(ebook => (
          <div key={ebook.id} style={{ 
            padding: '1.5rem', 
            borderRadius: '12px', 
            background: 'white', 
            boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
            border: '1px solid #eee',
            transition: 'all 0.3s ease',
            cursor: 'default'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#7c6fff', fontWeight: 'bold', marginBottom: '0.5rem', textTransform: 'uppercase' }}>{ebook.category}</div>
                <h3 style={{ margin: '0', color: '#333' }}>{ebook.title}</h3>
              </div>
              <span style={{ 
                padding: '4px 12px', 
                borderRadius: '20px', 
                fontSize: '0.8rem', 
                fontWeight: 'bold', 
                background: ebook.price === 'Free' ? '#e8f5e9' : '#fff3e0',
                color: ebook.price === 'Free' ? '#2e7d32' : '#ef6c00'
              }}>
                {ebook.price}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button 
                onClick={() => toggleExpand(ebook.id)}
                style={{ 
                  padding: '10px 20px', 
                  background: expandedId === ebook.id ? '#eee' : '#1a237e', 
                  color: expandedId === ebook.id ? '#333' : 'white', 
                  border: 'none', 
                  borderRadius: '8px', 
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                {expandedId === ebook.id ? '🔼 Hide Chapters' : '📖 View Chapters'}
              </button>
              {ebook.price === 'Free' && (
                <button style={{ 
                  padding: '10px 20px', 
                  background: 'transparent', 
                  color: '#1a237e', 
                  border: '2px solid #1a237e', 
                  borderRadius: '8px', 
                  fontWeight: 'bold',
                  cursor: 'pointer'
                }}>
                  Download PDF
                </button>
              )}
            </div>

            {/* Chapters list */}
            {expandedId === ebook.id && ebook.chapters.length > 0 && (
              <div style={{ 
                marginTop: '1.5rem', 
                padding: '1.5rem', 
                background: '#f8f9fa', 
                borderRadius: '8px',
                borderLeft: '4px solid #1a237e',
                animation: 'fadeIn 0.3s ease'
              }}>
                <h4 style={{ margin: '0 0 1rem 0', color: '#1a237e' }}>Table of Contents</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.8rem' }}>
                  {ebook.chapters.map((chapter, i) => (
                    <div key={i} style={{ 
                      padding: '8px', 
                      fontSize: '0.9rem', 
                      color: '#444',
                      borderBottom: '1px solid #eee',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ color: '#7c6fff' }}>•</span>
                      {chapter}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expandedId === ebook.id && ebook.chapters.length === 0 && (
              <div style={{ marginTop: '1.5rem', color: '#777', fontStyle: 'italic' }}>
                Chapters for this book will be added soon.
              </div>
            )}
          </div>
        ))}
      </div>
      
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default Ebooks;
