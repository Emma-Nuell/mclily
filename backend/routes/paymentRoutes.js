import express from 'express';
import { handlePaymentWebhook } from '../controllers/paymentWebhookController.js';
import paymentFactory from '../services/payment/PaymentFactory.js';

const router = express.Router();

// Webhook endpoints
router.post('/webhook', handlePaymentWebhook);
router.post('/webhook/:gateway', handlePaymentWebhook);
router.post('/paystack/webhook', (req, res, next) => {
  req.params.gateway = 'paystack';
  handlePaymentWebhook(req, res, next);
});
router.post('/bachs/webhook', (req, res, next) => {
  req.params.gateway = 'bachs';
  handlePaymentWebhook(req, res, next);
});

// Informational endpoint: active gateway
router.get('/active-gateway', (req, res) => {
  res.status(200).json({
    success: true,
    activeGateway: paymentFactory.getActiveGatewayName(),
  });
});

export default router;
