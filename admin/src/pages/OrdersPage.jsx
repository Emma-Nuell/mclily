import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageCircle, Phone, Truck, Check, ChevronDown } from 'lucide-react';
import api from '../api/client';
import useCollection from '../hooks/useCollection';
import useDebouncedValue from '../hooks/useDebouncedValue';
import {
  PageHeading,
  Notice,
  Loading,
  Empty,
  Modal,
  Pagination,
  SearchField,
  Status,
} from '../components/AdminUI';
import { formatNaira } from '../utils/conversions';
import OrderResolution, {
  OrderOperationNotice,
} from '../components/OrderResolution';
import useOrderOperation from '../hooks/useOrderOperation';
import CourierConfirmation from '../components/CourierConfirmation';

const labels = {
  pending: 'Awaiting payment',
  processing: 'To prepare',
  shipped: 'On delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  needs_resolution: 'Needs a check',
};
const tone = (status) =>
  status === 'needs_resolution'
    ? 'warning'
    : status === 'cancelled'
      ? 'danger'
      : status === 'delivered'
        ? 'success'
        : '';
function whatsapp(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('0') ? '234' + digits.slice(1) : digits;
}
export default function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const status = Object.hasOwn(labels, params.get('status'))
    ? params.get('status')
    : 'all';
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [cancelOrder, setCancelOrder] = useState(null),
    [changed, setChanged] = useState('');
  const term = useDebouncedValue(search);
  const [resolutionId, setResolutionId] = useState(null),
    [resolutionVersion, setResolutionVersion] = useState(0);
  const [courierOrder, setCourierOrder] = useState(null);
  const orders = useCollection(
    '/orders?' +
      new URLSearchParams({
        page: String(page),
        limit: '15',
        ...(status !== 'all' ? { status } : {}),
        ...(term ? { search: term } : {}),
      })
  );
  const operation = useOrderOperation(({ orderId, delivery }) => {
    if (delivery) setCourierOrder(null);
    else {
      setResolutionId(orderId);
      setResolutionVersion((value) => value + 1);
    }
    setChanged('Order update confirmed.');
    orders.refresh();
  });
  async function transition(order, next) {
    if (busy) return;
    setBusy(true);
    setError('');
    setChanged('');
    try {
      const res = await api.put('/orders/' + order._id + '/status', {
        status: next,
      });
      if (!res.data?.success) throw new Error('The order was not updated.');
      setCancelOrder(null);
      setChanged(`Order ${order.orderNumber}: ${labels[next].toLowerCase()}.`);
      orders.refresh();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-stack">
      <PageHeading
        title="Orders"
        description="Prepare paid orders and keep deliveries up to date."
      />
      {!resolutionId && !courierOrder && (
        <OrderOperationNotice operation={operation} />
      )}
      <div className="toolbar flex-wrap">
        <SearchField
          label="Search orders"
          placeholder="Order, customer or delivery city…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          className="control !w-auto"
          aria-label="Order status"
          value={status}
          onChange={(e) => {
            setParams(
              e.target.value === 'all' ? {} : { status: e.target.value }
            );
            setPage(1);
          }}
        >
          <option value="all">All orders</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {(error || orders.error) && (
        <Notice>
          {error || orders.error}
          {orders.error && (
            <button className="underline block mt-2" onClick={orders.refresh}>
              Try again
            </button>
          )}
        </Notice>
      )}
      {changed && (
        <p className="text-sm text-[var(--accent)]" role="status">
          {changed}
        </p>
      )}
      {orders.loading ? (
        <Loading text="Loading orders…" />
      ) : orders.error ? null : orders.rows.length === 0 ? (
        <Empty title="No orders found.">
          Try a different search or order status.
        </Empty>
      ) : (
        <div className="page-stack">
          {orders.rows.map((order) => {
            const current = order.fulfillment?.status || 'pending',
              paid = order.payment?.status === 'paid';
            const canDispatch =
              paid &&
              (order.delivery?.method !== 'courier' ||
                order.delivery?.courierStatus === 'confirmed') &&
              !order.support?.open &&
              !['requested', 'processing', 'completed'].includes(
                order.refundSummary?.status
              ) &&
              order.inventory?.status === 'consumed' &&
              current === 'processing';
            const canDeliver =
              paid &&
              !order.support?.open &&
              !['requested', 'processing', 'completed'].includes(
                order.refundSummary?.status
              ) &&
              order.inventory?.status === 'consumed' &&
              current === 'shipped';
            const phone = whatsapp(order.customer?.phone),
              items = order.orderItems || [];
            return (
              <article className="panel order-card" key={order._id}>
                <div className="order-header">
                  <div className="row-info">
                    <Status tone={tone(current)}>
                      {labels[current] || current}
                    </Status>
                    <span className="row-title">{order.customer?.name}</span>
                    <p className="row-meta">{order.orderNumber}</p>
                    <p className="row-meta">
                      {order.shippingAddress?.city} ·{' '}
                      {new Date(order.createdAt).toLocaleDateString('en-NG')}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="amount">
                      {formatNaira(order.pricing?.totalAmount)}
                    </span>
                    <p className="row-meta">
                      {paid
                        ? 'Payment received'
                        : order.payment?.status === 'review'
                          ? 'Payment under review'
                          : order.payment?.status === 'refunded'
                            ? 'Refunded'
                            : order.payment?.status === 'failed'
                              ? 'Payment not completed'
                              : 'Payment pending'}
                    </p>
                  </div>
                </div>
                {current === 'needs_resolution' && (
                  <div className="mt-4">
                    <Notice tone="warning">
                      Check payment and availability before preparing this
                      order.
                    </Notice>
                  </div>
                )}
                {paid &&
                  current === 'processing' &&
                  order.delivery?.method === 'courier' &&
                  order.delivery.courierStatus !== 'confirmed' && (
                    <div className="mt-4 space-y-3">
                      <Notice tone="warning">
                        Confirm the courier fee and the customer’s acceptance
                        before preparing this order. Delivery is paid separately
                        to the courier.
                      </Notice>
                      <button
                        className="btn btn-primary"
                        disabled={operation.blocked}
                        onClick={() => setCourierOrder(order)}
                      >
                        Confirm courier fee
                      </button>
                    </div>
                  )}
                {(current === 'needs_resolution' ||
                  order.support?.open ||
                  order.refundSummary?.status) && (
                  <div className="mt-4">
                    <button
                      className="btn"
                      disabled={operation.blocked && !operation.pending}
                      onClick={() => setResolutionId(order._id)}
                    >
                      Resolve issue
                    </button>
                    {order.refundSummary?.status && (
                      <p className="row-meta mt-2">
                        Refund: {order.refundSummary.status} ·{' '}
                        {formatNaira(order.refundSummary.amount)}
                      </p>
                    )}
                  </div>
                )}
                <details className="disclosure mt-5">
                  <summary>
                    View order <ChevronDown size={15} className="inline ml-1" />
                  </summary>
                  <div className="order-details">
                    <section>
                      <h3>Items</h3>
                      {items.map((item, index) => (
                        <div className="list-row" key={item._id || index}>
                          {item.image && (
                            <img
                              src={item.image}
                              alt=""
                              className="product-thumb"
                            />
                          )}
                          <div className="row-info">
                            <span className="row-title">{item.name}</span>
                            <p className="row-meta">
                              {item.productType === 'fabric'
                                ? `${item.yards ?? item.halfYards / 2} yd · ${item.fabricColor || ''}`
                                : [
                                    `${item.quantity} pieces`,
                                    item.size,
                                    item.color,
                                  ]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </p>
                          </div>
                          <span className="amount">
                            {formatNaira(item.subtotal)}
                          </span>
                        </div>
                      ))}
                    </section>
                    <div className="form-grid">
                      <section>
                        <h3>Delivery</h3>
                        {paid &&
                          current === 'processing' &&
                          order.delivery?.method === 'courier' &&
                          order.delivery.courierStatus === 'confirmed' && (
                            <button
                              type="button"
                              className="btn btn-quiet"
                              disabled={
                                operation.blocked ||
                                order.support?.open ||
                                Boolean(order.refundSummary?.status)
                              }
                              onClick={() => setCourierOrder(order)}
                            >
                              Update courier agreement
                            </button>
                          )}
                        {order.delivery?.method === 'courier' && (
                          <p className="row-meta">
                            {order.delivery.courierStatus === 'confirmed'
                              ? `${order.delivery.courierName}: ${formatNaira(order.delivery.courierFee)} paid by recipient on delivery. Customer acceptance recorded.`
                              : 'Courier fee not included online; confirmation pending.'}
                          </p>
                        )}
                        <p className="row-meta">
                          {[
                            order.shippingAddress?.street,
                            order.shippingAddress?.city,
                            order.shippingAddress?.state,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                        <p className="row-meta">
                          {order.delivery?.label ||
                            (order.shippingAddress?.deliveryTier ===
                            'in_store_pickup'
                              ? 'In-store pickup'
                              : 'Delivery')}
                        </p>
                      </section>
                      <section>
                        <h3>Customer</h3>
                        <p className="row-meta">{order.customer?.email}</p>
                        <p className="row-meta">{order.customer?.phone}</p>
                      </section>
                    </div>
                    <dl>
                      <dt>Items</dt>
                      <dd>{formatNaira(order.pricing?.subtotal)}</dd>
                      <dt>Delivery collected online</dt>
                      <dd>{formatNaira(order.pricing?.deliveryFee)}</dd>
                      <dt>Website service charge</dt>
                      <dd>{formatNaira(order.pricing?.paymentFee)}</dd>
                      <dt>Total</dt>
                      <dd className="amount">
                        {formatNaira(order.pricing?.totalAmount)}
                      </dd>
                    </dl>
                    <div className="inline-actions">
                      {canDispatch && (
                        <button
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() => transition(order, 'shipped')}
                        >
                          <Truck size={18} />
                          Mark out for delivery
                        </button>
                      )}
                      {canDeliver && (
                        <button
                          className="btn btn-primary"
                          disabled={busy}
                          onClick={() => transition(order, 'delivered')}
                        >
                          <Check size={18} />
                          Mark delivered
                        </button>
                      )}
                      {phone && (
                        <a
                          className="btn"
                          href={`https://wa.me/${phone}?text=${encodeURIComponent(`Hello ${order.customer?.name}, this is McLily about your order ${order.orderNumber}.`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <MessageCircle size={18} />
                          WhatsApp
                        </a>
                      )}
                      {phone && (
                        <a
                          className="btn btn-icon"
                          aria-label={`Call ${order.customer?.name}`}
                          href={`tel:+${phone}`}
                        >
                          <Phone size={18} />
                        </a>
                      )}
                    </div>
                    <details className="disclosure">
                      <summary>Order history & options</summary>
                      <div className="form-stack">
                        {order.fulfillment?.timeline?.map((entry, index) => (
                          <div key={index}>
                            <p className="row-title text-sm">
                              {labels[entry.status] || entry.status}
                            </p>
                            <p className="row-meta">{entry.note}</p>
                            {entry.timestamp && (
                              <p className="row-meta">
                                {new Date(entry.timestamp).toLocaleString(
                                  'en-NG'
                                )}
                              </p>
                            )}
                          </div>
                        ))}
                        {['pending', 'processing'].includes(current) && (
                          <button
                            className="btn btn-danger w-fit"
                            disabled={busy}
                            onClick={() => {
                              setCancelOrder(order);
                              setError('');
                            }}
                          >
                            Cancel order
                          </button>
                        )}
                        {current !== 'needs_resolution' &&
                          !order.support?.open &&
                          !order.refundSummary?.status && (
                            <button
                              className="btn w-fit"
                              onClick={() => setResolutionId(order._id)}
                            >
                              Resolve issue
                            </button>
                          )}
                      </div>
                    </details>
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
      <Pagination
        page={page}
        pages={orders.pages}
        onChange={setPage}
        loading={orders.loading}
      />
      {cancelOrder && (
        <Modal
          title="Cancel this order?"
          busy={busy}
          onClose={() => setCancelOrder(null)}
        >
          <p>
            {cancelOrder.customer?.name} · {cancelOrder.orderNumber}
          </p>
          <p className="muted">
            {cancelOrder.payment?.status === 'paid'
              ? 'This records cancellation. It does not refund the customer or return sold items to stock. Arrange the refund and inspect any goods separately.'
              : 'Any active stock hold will be released. A payment received later will need review.'}
          </p>
          {error && <Notice>{error}</Notice>}
          <div className="dialog-footer">
            <button
              className="btn"
              disabled={busy}
              onClick={() => setCancelOrder(null)}
            >
              Keep order
            </button>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={() => transition(cancelOrder, 'cancelled')}
            >
              {busy ? 'Cancelling…' : 'Cancel order'}
            </button>
          </div>
        </Modal>
      )}
      {resolutionId && (
        <OrderResolution
          key={resolutionId + ':' + resolutionVersion}
          orderId={resolutionId}
          operation={operation}
          onClose={() => setResolutionId(null)}
        />
      )}
      {courierOrder && (
        <CourierConfirmation
          order={courierOrder}
          operation={operation}
          onClose={() => setCourierOrder(null)}
        />
      )}
    </div>
  );
}
