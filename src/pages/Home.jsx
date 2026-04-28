import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

function Home() {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      // For now, we'll just navigate to the quizzes page or a search results page
      // Assuming we'll implement search functionality later
      navigate(`/quizzes?search=${encodeURIComponent(searchQuery)}`);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Hero Section */}
      <section style={{ 
        padding: '80px 20px', 
        background: 'linear-gradient(135deg, var(--accent-bg) 0%, transparent 100%)',
        textAlign: 'center'
      }}>
        <h1 style={{ marginBottom: '24px' }}>Master Your Exams with Precision</h1>
        <p style={{ 
          fontSize: '20px', 
          maxWidth: '600px', 
          margin: '0 auto 40px',
          color: 'var(--text)'
        }}>
          Access high-quality MCQs, annotated study notes, and e-books designed for competitive exam success.
        </p>

        {/* Search Bar */}
        <form onSubmit={handleSearch} style={{
          display: 'flex',
          maxWidth: '600px',
          margin: '0 auto',
          gap: '12px',
          padding: '8px',
          background: 'var(--bg)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow)',
          border: '1px solid var(--border)'
        }}>
          <input
            type="text"
            placeholder="Search for subjects, chapters, or e-books..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              padding: '12px 20px',
              border: 'none',
              borderRadius: '12px',
              fontSize: '16px',
              outline: 'none',
              background: 'transparent',
              color: 'var(--text-h)'
            }}
          />
          <button type="submit" style={{
            padding: '12px 28px',
            background: 'var(--accent)',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontWeight: 'bold',
            cursor: 'pointer',
            transition: 'opacity 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
          >
            <span>🔍</span>
            Search
          </button>
        </form>
      </section>

      {/* Featured Sections Quick Access */}
      <section style={{ padding: '60px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '32px' }}>
        <div style={cardStyle}>
          <h2>Latest Quizzes</h2>
          <p>Practice with the most recent MCQ sets updated daily.</p>
          <button onClick={() => navigate('/quizzes')} style={linkBtnStyle}>Browse Quizzes →</button>
        </div>
        <div style={cardStyle}>
          <h2>E-Books Library</h2>
          <p>Download comprehensive PDF notes and reference books.</p>
          <button onClick={() => navigate('/ebooks')} style={linkBtnStyle}>Explore Library →</button>
        </div>
        <div style={cardStyle}>
          <h2>Courses</h2>
          <p>Join structured courses for in-depth subject mastery.</p>
          <button onClick={() => navigate('/courses')} style={linkBtnStyle}>View Courses →</button>
        </div>
      </section>
    </div>
  );
}

const cardStyle = {
  padding: '32px',
  background: 'var(--bg)',
  borderRadius: '20px',
  border: '1px solid var(--border)',
  textAlign: 'left',
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  transition: 'transform 0.2s, box-shadow 0.2s',
  cursor: 'pointer'
};

const linkBtnStyle = {
  marginTop: 'auto',
  background: 'none',
  border: 'none',
  color: 'var(--accent)',
  fontWeight: 'bold',
  cursor: 'pointer',
  padding: '0',
  fontSize: '16px',
  width: 'fit-content'
};

export default Home;
