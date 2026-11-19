import { processPendingPayments } from './paymentEventService.js';
import { expireReservations } from './reservationService.js';
import { processPendingRefunds } from './refundService.js';

export function startPaymentWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await expireReservations(); await processPendingPayments(); await processPendingRefunds(); }
    catch { console.error('Payment maintenance failed; next poll will retry.'); }
    finally { running = false; }
  };
  const interval = setInterval(tick, 15000);
  interval.unref();
  void tick();
  return () => clearInterval(interval);
}
