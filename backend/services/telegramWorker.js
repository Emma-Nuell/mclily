import telegramBotService from './telegramBotService.js';
let busy = false;
export function startTelegramWorker() {
  const tick = async () => {
    if (busy || !telegramBotService.isConfigured()) return;
    busy = true;
    try {
      await telegramBotService.processUpdates();
      await telegramBotService.processReplies();
    } catch {
      console.warn(
        'Telegram worker needs attention. Requests remain in durable storage.'
      );
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 3000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
