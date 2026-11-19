import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Field, Notice } from '../components/AdminUI';
import MonogramLogo from '../assets/logos/Minimalist McLily Monogram Logo (1).svg';
export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [credential, setCredential] = useState(''),
    [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await login(credential.trim(), password);
    if (result.success) navigate('/', { replace: true });
    else {
      setError(result.message || 'Could not sign in. Please try again.');
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <div className="login-form">
        <div className="brand">
          <img className="brand-mark" src={MonogramLogo} alt="" />
          <div>
            <span className="brand-name">McLily</span>
            <small>Store manager</small>
          </div>
        </div>
        <div>
          <h1>Welcome back.</h1>
          <p className="muted mt-3">Sign in to manage your store.</p>
        </div>
        <Link className="underline text-sm" to="/forgot-password">Forgot your password?</Link>
        <form className="form-stack" onSubmit={submit}>
          {error && <Notice>{error}</Notice>}
          <Field label="Email or phone">
            <input
              className="control"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              required
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <div className="password-wrap">
              <input
                className="control"
                name="password"
                autoComplete="current-password"
                type={visible ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                className="btn btn-quiet btn-icon"
                type="button"
                aria-label={visible ? 'Hide password' : 'Show password'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </Field>
          <button className="btn btn-primary btn-wide" disabled={busy}>
            {busy ? (
              'Signing in…'
            ) : (
              <>
                Sign in
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
        <p className="row-meta">
          Need access? Contact your store administrator.
        </p>
      </div>
    </main>
  );
}
