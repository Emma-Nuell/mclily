import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Plus,
  ReceiptText,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
  LogOut,
  UsersRound,
  Mail,
  ChartNoAxesCombined,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { PageHeading, Notice } from '../components/AdminUI';

export default function MorePage() {
  const { user, logout } = useAuth();
  const { preference, setPreference } = useTheme();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <div className="page-stack form-narrow">
      <PageHeading title="More" description="Your orders, sales and account." />
      <section className="panel panel-pad" aria-label="Store tools">
        {[
          [ShoppingBag, 'Orders', '/orders'],
          [Plus, 'Add product', '/quick-post'],
          [ReceiptText, 'Sales & payments', '/pos?view=history'],
          [ChartNoAxesCombined, 'Sales reports', '/reports'],
          [UsersRound, 'Customers & credit', '/customers'],
          [Mail, 'Email delivery', '/email'],
        ].map(([Icon, label, to]) => (
          <Link key={to} className="menu-link" to={to}>
            <Icon size={21} strokeWidth={1.6} />
            <span>{label}</span>
            <ChevronRight size={18} />
          </Link>
        ))}
      </section>
      <section className="panel panel-pad form-stack">
        <h2>Appearance</h2>
        <div className="segmented" aria-label="Appearance">
          {[
            [Sun, 'light', 'Light'],
            [Moon, 'dark', 'Dark'],
            [Monitor, 'system', 'System'],
          ].map(([Icon, value, label]) => (
            <button
              key={value}
              aria-pressed={preference === value}
              onClick={() => setPreference(value)}
            >
              <Icon size={16} className="inline mr-1" />
              {label}
            </button>
          ))}
        </div>
      </section>
      <section className="panel panel-pad form-stack">
        <div>
          <h2>{user?.fullName || 'Store manager'}</h2>
          <p className="row-meta">{user?.email || user?.phone}</p>
          <p className="row-meta">Administrator · full store access</p>
        </div>
        {error && <Notice>{error}</Notice>}
        <button
          className="btn w-fit"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await logout();
              navigate('/login', { replace: true });
            } catch {
              setError('Could not sign out. Please try again.');
              setBusy(false);
            }
          }}
        >
          <LogOut size={18} />
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </section>
    </div>
  );
}
