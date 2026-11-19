import express from 'express';
import { protect, requireAdmin } from '../middlewares/authMiddleware.js';
import {
  listEmailDelivery,
  verifyEmailConfiguration,
  queueEmailTest,
  updateEmailDelivery,
} from '../controllers/emailController.js';
const router = express.Router();
router.use(protect, requireAdmin);
router.get('/', listEmailDelivery);
router.post('/verify', verifyEmailConfiguration);
router.post('/test', queueEmailTest);
router.post('/:id/:action', updateEmailDelivery);
export default router;
