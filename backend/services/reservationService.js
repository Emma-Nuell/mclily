import Order from '../models/Order.js';
import { inTransaction } from './transactionService.js';
import { moveInventory } from './inventoryService.js';

export async function releaseOrderHold(order, session) {
  if (order.inventory?.status !== 'held') return;
  await moveInventory(order.orderItems, 'release', session, { source: `ORDER_${order._id}` });
  order.inventory.status = 'released';
}

export async function expireReservations(now = new Date()) {
  const orders = await Order.find({ 'inventory.status': 'held', 'inventory.expiresAt': { $lte: now } }).select('_id').limit(100).lean();
  for (const { _id } of orders) {
    await inTransaction(async session => {
      const order = await Order.findById(_id).session(session);
      if (!order || order.inventory.status !== 'held' || order.inventory.expiresAt > now) return;
      await releaseOrderHold(order, session);
      // Expired is not payment-failed: an in-flight transfer can still arrive.
      await order.save({ session });
    });
  }
}
