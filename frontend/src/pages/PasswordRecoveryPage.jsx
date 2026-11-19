import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
        failure.message || 'Please check your connection and try again.'
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="account-page">
      <div className="account-intro">
        <p className="section-eyebrow">Your McLily</p>
        <h1>{reset ? 'Choose a new password.' : 'Forgot your password?'}</h1>
        <p>
          {reset
            ? 'Use at least eight characters.'
            : 'Enter the email address on your account. We’ll email a recovery link if it matches an active account.'}
        </p>
      </div>
      {message ? (
        <p role="status" className="text-sm leading-relaxed">
          {message}
        </p>
      ) : reset && !token ? (
        <p role="alert" className="account-error">
          This link is missing its recovery token. Request a new reset link.
        </p>
      ) : (
        <form className="account-form" onSubmit={submit}>
          {reset ? (
            <>
              <label htmlFor="new-password">
                New password
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={password}
                  disabled={busy}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label htmlFor="confirm-password">
                Confirm new password
                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={confirmation}
                  disabled={busy}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label htmlFor="recovery-email">
              Email address
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="account-error">
              {error}
            </p>
          )}
          <button className="account-submit pressable" disabled={busy}>
            {busy
              ? 'Please wait…'
              : reset
                ? 'Save new password'
                : 'Request reset link'}
          </button>
        </form>
      )}
      {reset && (
        <Link className="account-guest-link" to="/forgot-password">
          Request a new reset link
        </Link>
      )}
      <Link className="account-guest-link" to="/account">
        Back to sign in
      </Link>
    </div>
  );
}
