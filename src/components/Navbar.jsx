import { Link } from 'react-router-dom';
import Login from './Login';

function Navbar() {
  return (
    <nav style={{ padding: '1rem', background: '#f0f0f0', display: 'flex', gap: '1rem', alignItems: 'center' }}>
      <Link to="/">Home</Link>
      <Link to="/courses">Courses</Link>
      <Link to="/quizzes">Quizzes</Link>
      <Link to="/contact">Contact Us</Link>
      <Link to="/about">About Us</Link>
      
      <div style={{ marginLeft: 'auto' }}>
        <Login />
      </div>
    </nav>
  );
}

export default Navbar;
