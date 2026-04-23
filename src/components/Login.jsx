import React from 'react';
import { useAuth } from '../context/AuthContext';

function Login() {
  const { user, login, logout } = useAuth();

  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
      {user ? (
        <>
          <span style={{ fontSize: '0.9rem', color: '#555' }}>Hi, {user.displayName || user.email}</span>
          <button 
            onClick={logout}
            style={{ padding: '6px 12px', background: '#f44336', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
          >
            Logout
          </button>
        </>
      ) : (
        <button 
          onClick={login}
          style={{ padding: '6px 12px', background: '#2196f3', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
        >
          Login with Google
        </button>
      )}
    </div>
  );
}

export default Login;
