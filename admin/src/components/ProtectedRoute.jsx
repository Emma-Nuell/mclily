import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loading } from './AdminUI';

export default function ProtectedRoute({ children }) {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
        <Loading text="Opening your store…" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
