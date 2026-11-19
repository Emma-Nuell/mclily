import { useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import api from '../api/client';

export default function useOrderOperation(onSuccess) {
  const { user } = useAuth(),
    storageKey = `mcl_order_pending_${user._id}`;
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey)) || null;
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function perform(operation) {
    if (lock.current) return;
    if (!navigator.onLine) {
      setError('Connect to the internet before updating an order.');
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
    } catch {
      setError(
        'Your browser could not save this update for a safe retry. Contact the technical administrator.'
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setPending(operation);
    setError('');
    try {
      const { data } = await api.post(operation.endpoint, operation.payload);
      if (!data?.success || !data.data?.orderId)
        throw new Error('The server did not confirm this update.');
      sessionStorage.removeItem(storageKey);
      setPending(null);
      onSuccess(data.data);
    } catch (err) {
      const status = err.response?.status;
      if (
        status >= 400 &&
        status < 500 &&
        ![401, 408, 429].includes(status) &&
        err.response?.data?.code !== 'IDEMPOTENCY_CONFLICT'
      ) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(
        err.response?.data?.message ||
          'We could not confirm this order update. Check the saved update before starting another.'
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return {
    pending,
    busy,
    error,
    blocked: Boolean(pending) || busy,
    perform,
    clearError: () => setError(''),
  };
}
