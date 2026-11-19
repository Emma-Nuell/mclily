import { processEmailOutbox } from './emailOutboxService.js';
import { scheduleFinancialSummary } from './financialSummaryService.js';
export function startEmailWorker() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await scheduleFinancialSummary();
      await processEmailOutbox();
    } catch {
      console.warn(
        'Email maintenance needs attention; it will retry without interrupting sales.'
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 15000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
