import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true, invalidated = false;
    const controller = new AbortController();
    const expired = () => { invalidated = true; setUser(null); }; window.addEventListener('auth:expired', expired);
    // Check if user is logged in via HttpOnly cookie
    api
      .get('/auth/me', { signal: controller.signal })
      .then((res) => {
        if (active && !invalidated && res.data?.success) {
          setUser(res.data.data);
        }
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; controller.abort(); window.removeEventListener('auth:expired', expired); };
  }, []);

  const login = async (credential, password) => {
    const res = await api.post('/auth/login', { credential, password });
    if (res.data?.success) {
      setUser(res.data.data);
    }
    return res.data;
  };

  const register = async (userData) => {
    const res = await api.post('/auth/register', userData);
    if (res.data?.success) {
      setUser(res.data.data);
    }
    return res.data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, isAuthenticated: Boolean(user) }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
export default AuthContext;
