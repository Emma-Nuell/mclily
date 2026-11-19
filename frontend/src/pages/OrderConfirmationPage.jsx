import WhatsAppLink from '../components/WhatsAppLink';
import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import {
  CheckCircle2,
  Clock3,
  AlertCircle,
  MessageCircle,
  Loader2,
} from 'lucide-react';
import api from '../api/client';
import { useCart } from '../context/CartContext';

export default function OrderConfirmationPage() {
  const [params] = useSearchParams();
  const reference = params.get('order') || params.get('reference');
  const access = params.get('access');
  return (
    <OrderStatus
      key={`${reference}:${access}`}
      reference={reference}
      access={access}
    />
  );
}
function OrderStatus({ reference, access }) {
  const { clearCart } = useCart();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(Boolean(reference));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!reference) return;
    let active = true,
      timer,
      attempts = 0;
    const load = async () => {
      try {
        const res = await api.get(`/orders/${encodeURIComponent(reference)}`, {
          headers: access ? { 'X-Order-Access': access } : {},
        });
        if (!active) return;
        const next = res.data?.data;
        setOrder(next);
        if (next?.payment?.status === 'paid') clearCart();
        else if (next?.payment?.status === 'pending' && ++attempts < 15)
          timer = setTimeout(load, 4000);
      } catch {
        if (active)
          setError(
            'We couldn’t check your order right now. Please keep your order reference and try again shortly.'
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [reference, access, clearCart]);
  if (loading)
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2
          className="animate-spin text-text-secondary"
          aria-label="Checking order"
        />
      </div>
    );
  const paid = order?.payment?.status === 'paid';
  const refunded = order?.payment?.status === 'refunded';
  const refundPending = ['requested', 'processing'].includes(
    order?.refundSummary?.status
  );
  const cancelled = order?.fulfillment?.status === 'cancelled';
  const failed = order?.payment?.status === 'failed';
  const needsReview =
    order?.payment?.status === 'review' ||
    order?.fulfillment?.status === 'needs_resolution';
  const Icon = refunded
    ? CheckCircle2
    : refundPending
      ? Clock3
      : needsReview
        ? AlertCircle
        : paid
          ? CheckCircle2
          : failed || error
            ? AlertCircle
            : Clock3;
  const followUp =
    refunded || refundPending
      ? 'Please help me with an update on my refund.'
      : needsReview || cancelled
        ? 'Please help me resolve the issue with this order.'
        : 'Please confirm receipt and let me know when it ships.';
  const message = order
    ? `Hi McLily! I placed order #${order.orderNumber}.\nName: ${order.customer.name}\nTotal: ₦${order.pricing.totalAmount.toLocaleString()}\n${followUp}`
    : '';
  return (
    <div
      className="max-w-lg mx-auto px-5 py-16 text-center space-y-6"
      aria-live="polite"
    >
      <Icon
        className={`w-12 h-12 mx-auto ${paid ? 'text-accent' : 'text-text-secondary'}`}
        strokeWidth={1.3}
      />
      <h1 className="text-3xl font-semibold tracking-tight">
        {refunded
          ? 'Your refund has been sent.'
          : refundPending
            ? order.refundSummary.status === 'requested'
              ? 'Your refund is requested.'
              : 'Your refund is processing.'
            : needsReview
              ? 'Your order needs a check.'
              : cancelled
                ? 'Your order was cancelled.'
                : paid
                  ? 'Payment confirmed.'
                  : failed
                    ? 'Payment wasn’t completed.'
                    : reference
                      ? 'Checking your payment.'
                      : 'No order selected.'}
      </h1>
      <p className="text-sm text-text-secondary leading-relaxed">
        {error ||
          (refunded
            ? 'The refund is recorded as sent. Your bank may take additional time to show it. Contact McLily if you need help tracking it.'
            : refundPending
              ? 'McLily is handling your refund. This does not yet confirm that money has reached your account.'
              : needsReview
                ? paid
                  ? 'Your payment is confirmed. We need to contact you about availability before preparing your order.'
                  : 'We’re checking the payment details. Please contact McLily with your order reference.'
                : cancelled
                  ? paid
                    ? 'Your payment was received. Please contact McLily about the next steps for your cancelled order.'
                    : 'Please contact McLily if you sent a payment for this order.'
                  : paid
                    ? order?.delivery?.method === 'courier' &&
                      order.delivery.courierStatus !== 'confirmed'
                      ? 'Payment is confirmed. McLily will confirm the courier fee with you before preparing or dispatching your order.'
                      : 'Thank you for shopping with McLily. Your order is being prepared.'
                    : failed
                      ? 'Your bag is saved. You can return to checkout to try again.'
                      : reference
                        ? 'We’re waiting for payment confirmation. Your bag stays saved until payment is verified.'
                        : 'Visit the shop to find your next favourite.')}
      </p>
      {order?.delivery?.method === 'courier' && (
        <p className="text-sm text-text-secondary">
          {order.delivery.courierStatus === 'confirmed'
            ? `Pay ${order.delivery.courierName} ?${Number(order.delivery.courierFee).toLocaleString('en-NG')} on delivery, separately from your online payment.`
            : 'Delivery is not included in the online total. Pay the courier on delivery after agreeing the fee with McLily.'}
        </p>
      )}
      {reference && (
        <p className="text-xs text-text-secondary">
          Order reference:{' '}
          <span className="font-mono text-text-primary">
            {order?.orderNumber || reference}
          </span>
        </p>
      )}
      {order && (paid || refunded || needsReview || cancelled) && (
        <WhatsAppLink
          message={message}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl bg-control-primary text-control-primary-text px-5 py-3 text-xs"
        >
          <MessageCircle size={16} />{' '}
          {refunded || refundPending || needsReview || cancelled
            ? 'Contact McLily on WhatsApp'
            : 'Share order on WhatsApp'}
        </WhatsAppLink>
      )}
      <div className="flex justify-center gap-5 text-sm">
        <Link className="underline underline-offset-4" to="/">
          Return home
        </Link>
        <Link
          className="underline underline-offset-4"
          to={failed ? '/checkout' : '/shop'}
        >
          {failed ? 'Return to checkout' : 'Continue shopping'}
        </Link>
      </div>
    </div>
  );
}
