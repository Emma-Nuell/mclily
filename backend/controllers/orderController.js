import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import Order from '../models/Order.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { calculateTotalAmount } from '../utils/feeCalculator.js';
import paymentFactory from '../services/payment/PaymentFactory.js';
import { inTransaction } from '../services/transactionService.js';
import { priceItems, moveInventory } from '../services/inventoryService.js';
import { releaseOrderHold } from '../services/reservationService.js';
import { AppError } from '../utils/AppError.js';
import env from '../config/env.js';
import { transitionOrder } from '../services/orderStatusService.js';
import { queueOrderCreated } from '../services/notificationService.js';
import validator from 'validator';
import { selectDelivery } from '../services/deliveryService.js';

const digest = token => createHash('sha256').update(token).digest('hex');

export const createOrder = asyncHandler(async (req, res) => {
  if (env.STOREFRONT_CATALOG_MODE === 'preview') throw new AppError(409, 'PREVIEW_CHECKOUT_DISABLED', 'This is the sample storefront. Payments and online orders are unavailable.');
  const { customer, shippingAddress, items } = req.body;
  if (!customer || !['name', 'email', 'phone'].every(key => typeof customer[key] === 'string' && customer[key].trim())) {
    throw new AppError(400, 'CUSTOMER_REQUIRED', 'Enter your name, email and phone number.');
  }
  if (!validator.isEmail(customer.email.trim())) throw new AppError(400, 'INVALID_EMAIL', 'Enter a valid email address for your private order link.');
  const delivery = selectDelivery(shippingAddress, req.body.deliveryPolicyVersion, req.body.courierDeliveryAccepted);
  const token = randomBytes(32).toString('hex');
  const gateway = paymentFactory.getGateway(), gatewayName = paymentFactory.getActiveGatewayName();
  const order = await inTransaction(async session => {
    const orderItems = await priceItems(items, session, { deliveryMethod: delivery.snapshot.method });
    const subtotal = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
    const deliveryFee = delivery.snapshot.feeCollectedOnline;
    const candidate = new Order({ user: req.user?.isActive ? req.user._id : null, customer,
      guestAccessHash: digest(token), shippingAddress: delivery.shippingAddress, delivery: delivery.snapshot, orderItems,
      pricing: { subtotal, deliveryFee, ...calculateTotalAmount(subtotal + deliveryFee) },
      payment: { gateway: gatewayName, reference: 'MCL-' + randomBytes(12).toString('hex').toUpperCase(), status: 'pending' },
      inventory: { status: 'held', expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      fulfillment: { status: 'pending', timeline: [{ status: 'pending', note: 'Awaiting verified payment.', updatedBy: 'Customer' }] },
    });
    await moveInventory(orderItems, 'reserve', session, { source: 'ORDER_' + candidate._id });
    await candidate.save({ session });
    await queueOrderCreated(candidate, token, session);
    return candidate;
  });
  const callback = new URL('/checkout/confirmation', env.FRONTEND_URL);
  callback.searchParams.set('order', order.orderNumber);
  callback.searchParams.set('access', token);
  let checkout;
  try {
    // Never make provider calls inside a driver-retryable database transaction.
    checkout = await gateway.initializePayment({ orderNumber: order.payment.reference,
      amount: order.pricing.totalAmount, customer, callbackUrl: callback.toString(),
      metadata: { order_number: order.payment.reference, items_count: order.orderItems.length } });
    if (checkout.reference !== order.payment.reference || typeof checkout.authorizationUrl !== 'string' || !checkout.authorizationUrl.startsWith('https://')) {
      throw new Error('Incomplete or inconsistent payment session');
    }
    await Order.updateOne({ _id: order._id }, { $set: {
      'payment.checkoutId': checkout.checkoutId || checkout.accessCode,
      'payment.checkoutUrl': checkout.authorizationUrl,
    } });
  } catch {
    await inTransaction(async session => {
      const current = await Order.findById(order._id).session(session);
      if (current.payment.status === 'pending') {
        await releaseOrderHold(current, session);
        current.payment.status = 'failed';
        await current.save({ session });
      }
    });
    throw new AppError(503, 'PAYMENT_UNAVAILABLE', 'Payment could not be opened. Your bag is saved. Please retry.');
  }
  res.status(201).json({ success: true, data: {
    orderId: order._id, orderNumber: order.orderNumber, authorizationUrl: checkout.authorizationUrl,
    reference: order.payment.reference, gateway: gatewayName, totalAmount: order.pricing.totalAmount,
    breakdown: order.pricing, confirmationUrl: callback.toString(),
  } });
});

export const getOrderById = asyncHandler(async (req, res) => {
  const { idOrNumber } = req.params;
  const query = /^[a-fA-F0-9]{24}$/.test(idOrNumber)
    ? { $or: [{ _id: idOrNumber }, { orderNumber: idOrNumber }] } : { orderNumber: idOrNumber };
  const order = await Order.findOne(query).select('+guestAccessHash').populate('orderItems.product', 'name slug images');
  const admin = req.user?.isActive && ['admin', 'superadmin'].includes(req.user.role);
  const owner = req.user?.isActive && order?.user && String(order.user) === String(req.user._id);
  const token = req.get('X-Order-Access') || req.query.access;
  const validToken = order?.guestAccessHash && typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    && timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(order.guestAccessHash, 'hex'));
  if (!order || (!admin && !owner && !validToken)) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found or private access link required.');
  const data = order.toObject();
  if (!admin && data.delivery) { delete data.delivery.customerAcceptanceNote; delete data.delivery.confirmedBy; }
  delete data.guestAccessHash;
  delete data.payment.checkoutUrl;
  if (!admin) { delete data.support; if (data.refundSummary) delete data.refundSummary.active; delete data.payment.chargeId; }
  res.json({ success: true, data });
});

export const getMyOrders = asyncHandler(async (req, res) => {
  const orders = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  const data = orders.map(order => {
    const value = order.toObject(); delete value.support; delete value.payment.chargeId; delete value.payment.checkoutUrl;
    if (value.delivery) { delete value.delivery.customerAcceptanceNote; delete value.delivery.confirmedBy; }
    if (value.refundSummary) delete value.refundSummary.active;
    return value;
  });
  res.json({ success: true, count: orders.length, data });
});

export const getAllOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1), limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const query = {};
  if (req.query.status) query['fulfillment.status'] = req.query.status;
  if (req.query.paymentStatus) query['payment.status'] = req.query.paymentStatus;
  if (req.query.gateway) query['payment.gateway'] = req.query.gateway;
  if (req.query.search) {
    if (typeof req.query.search !== 'string' || req.query.search.length > 200) throw new AppError(400, 'INVALID_SEARCH', 'Search must be at most 200 characters.');
    const term = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = ['orderNumber', 'customer.name', 'customer.phone', 'shippingAddress.city'].map(field => ({ [field]: term }));
  }
  const [total, orders] = await Promise.all([Order.countDocuments(query), Order.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)]);
  res.json({ success: true, total, page, pages: Math.ceil(total / limit) || 1, data: orders });
});

export const updateOrderStatus = asyncHandler(async (req, res) => {
  const order = await transitionOrder(req.params.id, req.body.status, {
    note: req.body.note, actor: req.user?.fullName || 'Admin',
  });
  res.json({ success: true, data: order });
});
