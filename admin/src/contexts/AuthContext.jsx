import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';
import api from '../api/client';
const AuthContext = createContext();
const administrator = (user) => ['admin', 'superadmin'].includes(user?.role);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(null);
  const acceptUser = useCallback((body) => {
    if (body?.success && administrator(body.data)) {
      setUser(body.data);
      setError(null);
    } else {
      setUser(null);
      if (body?.data) setError('Administrator access is required.');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api
      .get('/auth/me', { signal: controller.signal })
      .then((res) => acceptUser(res.data))
      .catch(() => {
        if (!controller.signal.aborted) setUser(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    const expired = () => setUser(null);
    window.addEventListener('auth:expired', expired);
    return () => {
      controller.abort();
      window.removeEventListener('auth:expired', expired);
    };
  }, [acceptUser]);
  async function login(credential, password) {
    setError(null);
    try {
      const res = await api.post('/auth/login', { credential, password });
      if (!res.data?.success)
        throw new Error(res.data?.message || 'Could not sign in.');
      if (!administrator(res.data.data)) {
        await api.post('/auth/logout').catch(() => {});
        throw new Error('Administrator access is required.');
      }
      setUser(res.data.data);
      return { success: true, user: res.data.data };
    } catch (err) {
      const message = err.response?.data?.message || err.message;
      setError(message);
      return { success: false, message };
    }
  }
  async function logout() {
    await api.post('/auth/logout');
    setUser(null);
  }
  async function refreshUser() {
    setLoading(true);
    try {
      acceptUser((await api.get('/auth/me')).data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        error,
        isAdmin: administrator(user),
        login,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
// eslint-disable-next-line react-refresh/only-export-components -- Provider and its context hook are intentionally colocated.
export const useAuth = () => useContext(AuthContext);
