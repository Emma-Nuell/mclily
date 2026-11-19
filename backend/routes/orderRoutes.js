import express from 'express';
import {
  createOrder,
  getOrderById,
  getMyOrders,
  getAllOrders,
  updateOrderStatus,
} from '../controllers/orderController.js';
import { protect, optionalAuth, requireAdmin } from '../middlewares/authMiddleware.js';
import { getOrderResolution, resolveOrderAction } from '../controllers/orderResolutionController.js';
import { confirmCourier } from '../controllers/deliveryController.js';

const router = express.Router();

router.post('/', optionalAuth, createOrder);
router.get('/my-orders', protect, getMyOrders);
router.get('/:idOrNumber', optionalAuth, getOrderById);

// Admin endpoints
router.get('/', protect, requireAdmin, getAllOrders);
router.put('/:id/status', protect, requireAdmin, updateOrderStatus);
router.post('/:id/delivery/confirm', protect, requireAdmin, confirmCourier);
router.get('/:id/resolution', protect, requireAdmin, getOrderResolution);
router.post('/:id/resolution/:action', protect, requireAdmin, resolveOrderAction);

export default router;
