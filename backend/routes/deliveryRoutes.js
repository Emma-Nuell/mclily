import express from 'express';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { deliveryOptions } from '../services/deliveryService.js';
const router = express.Router();
router.get(
  '/options',
  asyncHandler(async (req, res) => {
    res
      .set('Cache-Control', 'no-store')
      .json({ success: true, data: deliveryOptions() });
  })
);
export default router;
