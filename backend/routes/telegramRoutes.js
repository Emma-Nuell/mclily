import express from 'express';
import { handleTelegramWebhook } from '../controllers/telegramWebhookController.js';

const router = express.Router();

router.post('/webhook', handleTelegramWebhook);

export default router;
