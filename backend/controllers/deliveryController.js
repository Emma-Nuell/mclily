import mongoose from 'mongoose';
import { z } from 'zod';
import Order from '../models/Order.js';
import OrderAction from '../models/OrderAction.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import {
  idempotentTransaction,
  requestKey,
} from '../services/idempotencyService.js';
import { queueOrderUpdate } from '../services/notificationService.js';
const schema = z.object({
  courierName: z.string().trim().min(2).max(120),
  fee: z
    .number()
    .finite()
    .min(0)
    .max(1000000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001),
  recipientPaymentSupported: z.literal(true),
  customerAccepted: z.literal(true),
  note: z.string().trim().min(3).max(500),
  revision: z.number().int().min(0),
});
export const confirmCourier = asyncHandler(async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !mongoose.isObjectIdOrHexString(req.params.id))
    throw new AppError(
      400,
      'COURIER_CONFIRMATION_REQUIRED',
      'Enter the courier and agreed delivery fee, and confirm recipient payment and the customer’s acceptance.'
    );
  const input = parsed.data,
    key = requestKey(req);
  const result = await idempotentTransaction(
    `courier:${req.user._id}:${key}`,
    'ORDER_DELIVERY',
    { order: req.params.id, ...input },
    async (session) => {
      const order = await Order.findById(req.params.id).session(session);
      if (!order)
        throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
      if (
        order.delivery?.method !== 'courier' ||
        order.payment.status !== 'paid' ||
        order.inventory.status !== 'consumed' ||
        order.fulfillment.status !== 'processing' ||
        order.support?.open ||
        ['requested', 'processing', 'completed'].includes(
          order.refundSummary?.status
        )
      )
        throw new AppError(
          409,
          'ORDER_NOT_READY',
          'Resolve payment, stock or open issues before confirming this courier.'
        );
      if (order.delivery.revision !== input.revision)
        throw new AppError(
          409,
          'DELIVERY_CHANGED',
          'Courier details changed. Refresh the order before saving.'
        );
      order.delivery.courierStatus = 'confirmed';
      order.delivery.courierName = input.courierName;
      order.delivery.courierFee = input.fee;
      order.delivery.recipientPaymentSupported = true;
      order.delivery.customerAcceptanceNote = input.note;
      order.delivery.confirmedBy = req.user._id;
      order.delivery.confirmedAt = new Date();
      order.delivery.revision += 1;
      order.support.revision = (order.support.revision || 0) + 1;
      await order.save({ session });
      await OrderAction.create(
        [
          {
            order: order._id,
            type: 'courier_confirmation',
            reason: input.note,
            actor: String(req.user._id),
            actorName: req.user.fullName,
            details: {
              courierName: input.courierName,
              fee: input.fee,
              recipientPaymentSupported: true,
              customerAccepted: true,
              revision: order.delivery.revision,
            },
          },
        ],
        { session }
      );
      await queueOrderUpdate(
        order,
        'courier',
        session,
        `courier:${order.delivery.revision}`
      );
      return { orderId: order._id, delivery: order.delivery.toObject() };
    }
  );
  res.status(200).json({ success: true, ...result });
});
