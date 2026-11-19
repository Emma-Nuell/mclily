import { createRequestId } from '../../vendor/requestId.mjs';
import { useRef, useState } from 'react';
import {
  PageHeading,
  Notice,
  Loading,
  Empty,
  Modal,
  Pagination,
  Field,
} from '../components/AdminUI';
import useApiData from '../hooks/useApiData';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';
const labels = {
  pending: 'Queued',
  sending: 'Sending',
  sent: 'Accepted by SMTP',
  failed: 'Failed',
  uncertain: 'Check provider logs',
  expired: 'Expired',
  cancelled: 'Cancelled',
};
export default function EmailDeliveryPage() {
  const { user } = useAuth(),
    storageKey = 'mcl_email_pending_' + user._id;
  const [page, setPage] = useState(1),
    [status, setStatus] = useState('all'),
    [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [review, setReview] = useState(null),
    [decision, setDecision] = useState('retry'),
    [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey)) || null;
    } catch {
      return null;
    }
  });
  const lock = useRef(false),
    state = useApiData(`/email?page=${page}&status=${status}`, revision);
  const configuration = state.response?.configuration,
    rows = state.data || [];
  async function perform(operation) {
    if (lock.current) return;
    if (!navigator.onLine) {
      setError('Connect to the internet first.');
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
    } catch {
      setError('This browser could not preserve the update for a safe retry.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setPending(operation);
    setError('');
    setMessage('');
    try {
      const { data } = await api.post(operation.url, operation.body);
      if (!data?.success) throw new Error('The update was not confirmed.');
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setReview(null);
      setMessage(data.message || 'Email record updated.');
      setRevision((value) => value + 1);
    } catch (failure) {
      const code = failure.response?.status;
      if (
        code >= 400 &&
        code < 500 &&
        ![401, 408, 429].includes(code) &&
        failure.response?.data?.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(
        failure.response?.data?.message ||
          'The outcome is unconfirmed. Check the saved action before trying another.'
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function update(job, action) {
    perform({
      url: `/email/${job._id}/${action}`,
      body: {
        idempotencyKey: createRequestId(),
        expectedUpdatedAt: job.updatedAt,
        providerAccepted: action === 'accepted' && confirmed,
        checkedNotAccepted: job.status === 'uncertain' && confirmed,
      },
    });
  }
  const blocked = busy || Boolean(pending);
  return (
    <div className="page-stack form-narrow">
      <PageHeading
        title="Email delivery"
        description="Setup checks and messages that need attention."
      />
      {error && <Notice>{error}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}
      {pending && (
        <Notice tone="warning">
          <p>
            A saved email action needs confirmation before another is started.
          </p>
          <button
            className="btn mt-3"
            disabled={busy}
            onClick={() => perform(pending)}
          >
            Check saved email action
          </button>
        </Notice>
      )}
      {configuration && (
        <section className="panel panel-pad form-stack">
          <h2>
            {!configuration.enabled
              ? 'Email sending is off'
              : configuration.configured
                ? 'SMTP settings are present'
                : 'SMTP setup is incomplete'}
          </h2>
          <p className="row-meta">
            {!configuration.enabled
              ? 'Add your professional mailbox SMTP settings, then enable email in the backend environment.'
              : 'SMTP acceptance does not prove delivery to the inbox. Check a real test message and the provider logs.'}
          </p>
          <details className="disclosure">
            <summary>Connection checks & recipients</summary>
            <div className="form-stack">
              <p className="row-meta">
                {configuration.encryption} · Port {configuration.port}
                <br />
                From: {configuration.from || 'Not configured'}
              </p>
              {configuration.missing?.length > 0 && (
                <p className="row-meta">
                  Still needed: {configuration.missing.join(', ')}
                </p>
              )}
              {Object.entries(configuration.recipients).map(
                ([group, addresses]) => (
                  <p className="row-meta" key={group}>
                    {group === 'operations'
                      ? 'Order alerts'
                      : group === 'technical'
                        ? 'Technical alerts'
                        : 'Fortnightly summary'}
                    : {addresses.join(', ') || 'Not configured'}
                  </p>
                )
              )}
              <button
                className="btn"
                disabled={
                  blocked || !configuration.enabled || !configuration.configured
                }
                onClick={() => perform({ url: '/email/verify', body: {} })}
              >
                Verify SMTP connection
              </button>
              <button
                className="btn"
                disabled={
                  blocked || !configuration.enabled || !configuration.configured
                }
                onClick={() =>
                  perform({
                    url: '/email/test',
                    body: { idempotencyKey: createRequestId() },
                  })
                }
              >
                Queue a test email to me
              </button>
            </div>
          </details>
        </section>
      )}
      <Field label="Email status">
        <select
          className="control"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">All messages</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      {state.loading ? (
        <Loading text="Loading email delivery…" />
      ) : state.error ? (
        <Notice>{state.error}</Notice>
      ) : rows.length ? (
        <section className="panel panel-pad">
          {rows.map((job) => (
            <div className="list-row flex-wrap" key={job._id}>
              <div className="row-info">
                <h3>{labels[job.status]}</h3>
                <p className="row-meta break-all">{job.to}</p>
                <p className="row-meta">
                  {job.kind.startsWith('operations_')
                    ? 'Order notification'
                    : job.kind.startsWith('customer_')
                      ? 'Customer order update'
                      : {
                          password_reset: 'Password recovery',
                          password_changed: 'Password changed',
                          technical_alert: 'Technical alert',
                          financial_summary: 'Fortnightly summary',
                          order_placed: 'Order received',
                          smtp_test: 'SMTP test',
                        }[job.kind] || 'Notification'}{' '}
                  · {new Date(job.createdAt).toLocaleString('en-NG')}
                </p>
                {job.lastError && <p className="row-meta">{job.lastError}</p>}
              </div>
              {job.status === 'failed' && (
                <button
                  className="btn"
                  disabled={blocked}
                  onClick={() => update(job, 'retry')}
                >
                  Retry
                </button>
              )}
              {job.status === 'uncertain' && (
                <button
                  className="btn"
                  disabled={blocked}
                  onClick={() => {
                    setReview(job);
                    setConfirmed(false);
                    setDecision('retry');
                  }}
                >
                  Review outcome
                </button>
              )}
            </div>
          ))}
        </section>
      ) : (
        <Empty title="No messages here.">
          Notifications will appear when orders or account-recovery requests
          create them.
        </Empty>
      )}
      <Pagination
        page={page}
        pages={state.response?.pages || 1}
        onChange={setPage}
        loading={state.loading}
      />
      <button
        className="btn w-fit"
        disabled={busy}
        onClick={() => setRevision((value) => value + 1)}
      >
        Refresh delivery status
      </button>
      {review && (
        <Modal
          title="Check the provider outcome"
          busy={busy}
          onClose={() => setReview(null)}
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              if (!blocked && confirmed) update(review, decision);
            }}
          >
            <p className="row-meta">
              Check the SMTP provider’s logs before resending. A lost
              acknowledgement may mean the message was already accepted.
            </p>
            <Field label="Provider result">
              <select
                className="control"
                disabled={blocked}
                value={decision}
                onChange={(e) => {
                  setDecision(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="retry">
                  Not accepted — queue another attempt
                </option>
                <option value="accepted">
                  Accepted — record provider acceptance
                </option>
              </select>
            </Field>
            <label className="check-row">
              <input
                type="checkbox"
                required
                checked={confirmed}
                disabled={blocked}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked the provider logs and confirmed this result.
            </label>
            {error && <Notice>{error}</Notice>}
            <button
              className="btn btn-primary"
              disabled={blocked || !confirmed}
            >
              Confirm status
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
