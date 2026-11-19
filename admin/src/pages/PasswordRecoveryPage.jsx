import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Notice } from '../components/AdminUI';
import api from '../api/client';
export default function PasswordRecoveryPage({ reset = false }) {
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.slice(1)).get('token') || ''
  );
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (reset)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search
      );
  }, [reset]);
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (reset && password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(
        reset ? '/auth/reset-password' : '/auth/forgot-password',
        reset ? { token, password } : { email: email.trim() }
      );
      if (!data?.success) throw new Error(data?.message || 'Please try again.');
      setMessage(data.message);
      setPassword('');
      setConfirmation('');
      if (reset) window.dispatchEvent(new Event('auth:expired'));
    } catch (failure) {
      setError(
        failure.response?.data?.message ||
          failure.message ||
          'Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <div className="login-form">
        <Link className="brand-name" to="/login">
          McLily
        </Link>
        <div>
          <h1>{reset ? 'Choose a new password.' : 'Forgot your password?'}</h1>
          <p className="muted mt-3">
            {reset
              ? 'Use at least eight characters.'
              : 'Enter your account email to request a recovery link.'}
          </p>
        </div>
        {message ? (
          <Notice tone="success">{message}</Notice>
        ) : reset && !token ? (
          <Notice>
            This link is missing its recovery token. Request a new reset link.
          </Notice>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            {reset ? (
              <>
                <Field label="New password">
                  <input
                    className="control"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={password}
                    disabled={busy}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="Confirm new password">
                  <input
                    className="control"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={confirmation}
                    disabled={busy}
                    onChange={(e) => setConfirmation(e.target.value)}
                  />
                </Field>
              </>
            ) : (
              <Field label="Email address">
                <input
                  className="control"
                  type="email"
                  autoComplete="email"
                  required
                  maxLength={254}
                  value={email}
                  disabled={busy}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>
            )}
            {error && <Notice>{error}</Notice>}
            <button className="btn btn-primary btn-wide" disabled={busy}>
              {busy
                ? 'Please wait…'
                : reset
                  ? 'Save new password'
                  : 'Request reset link'}
            </button>
          </form>
        )}
        {reset && (
          <Link className="underline" to="/forgot-password">
            Request a new reset link
          </Link>
        )}
        <Link className="underline" to="/login">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
