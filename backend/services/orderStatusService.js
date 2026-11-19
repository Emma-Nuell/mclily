import Order from '../models/Order.js';
import { inTransaction } from './transactionService.js';
import { releaseOrderHold } from './reservationService.js';
import { AppError } from '../utils/AppError.js';
import { queueOrderUpdate } from './notificationService.js';

export async function transitionOrder(id, status, { actor = 'Admin', note, session: existingSession } = {}) {
  const work = async session => {
    const order = await Order.findById(id).session(session);
    if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
    if (status !== 'cancelled' && order.delivery?.method === 'courier' && order.delivery.courierStatus !== 'confirmed') throw new AppError(409, 'COURIER_NOT_CONFIRMED', 'Confirm the courier’s recipient-paid fee and the customer’s acceptance before preparing or dispatching this order.');
    if (status !== 'cancelled' && (order.support?.open || ['requested', 'processing', 'completed'].includes(order.refundSummary?.status))) throw new AppError(409, 'ORDER_BLOCKED', 'Resolve the issue or refund before preparing this order.');
    const transitions = { pending: ['cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [], needs_resolution: [] };
    if (!transitions[order.fulfillment.status]?.includes(status)) throw new AppError(400, 'INVALID_STATUS_TRANSITION', 'This order cannot move to that status.');
    if (status !== 'cancelled' && (order.payment.status !== 'paid' || order.inventory.status !== 'consumed')) {
      throw new AppError(409, 'ORDER_NOT_READY', 'Verified payment and committed stock are required.');
    }
    if (status === 'cancelled') await releaseOrderHold(order, session);
    order.fulfillment.status = status;
    order.support.revision = (order.support.revision || 0) + 1;
    order.fulfillment.timeline.push({ status, note: note || 'Status updated to ' + status, updatedBy: actor });
    await order.save({ session });
    await queueOrderUpdate(order, status, session);
    return order;
  };
  if (existingSession) {
    if (!existingSession.inTransaction()) throw new Error('Order transitions require an active transaction.');
    return work(existingSession);
  }
  return inTransaction(work);
}
