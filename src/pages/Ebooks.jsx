import React from 'react';

function Ebooks() {
  const ebooks = [
    { id: 1, title: 'Indian Polity - Comprehensive Guide', category: 'Polity', price: 'Free' },
    { id: 2, title: 'Modern Indian History', category: 'History', price: 'Premium' },
    { id: 3, title: 'Geography of India', category: 'Geography', price: 'Free' },
  ];

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
      <h1 style={{ color: '#1a237e', marginBottom: '1.5rem' }}>E-Books Library</h1>
      <p style={{ color: '#555', marginBottom: '2rem' }}>Explore our collection of high-quality study materials and e-books.</p>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '2rem' }}>
        {ebooks.map(ebook => (
          <div key={ebook.id} style={{ 
            padding: '1.5rem', 
            borderRadius: '12px', 
            background: 'white', 
            boxShadow: '0 4px 15px rgba(0,0,0,0.1)',
            border: '1px solid #eee',
            transition: 'transform 0.2s',
            cursor: 'pointer'
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'translateY(-5px)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <div style={{ fontSize: '0.8rem', color: '#7c6fff', fontWeight: 'bold', marginBottom: '0.5rem', textTransform: 'uppercase' }}>{ebook.category}</div>
            <h3 style={{ margin: '0 0 1rem 0', color: '#333' }}>{ebook.title}</h3>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 'bold', color: ebook.price === 'Free' ? '#2ed573' : '#ff9800' }}>{ebook.price}</span>
              <button style={{ 
                padding: '8px 16px', 
                background: '#1a237e', 
                color: 'white', 
                border: 'none', 
                borderRadius: '6px', 
                fontWeight: 'bold',
                cursor: 'pointer'
              }}>Read Now</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default Ebooks;
