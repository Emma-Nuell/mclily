import { useState, useSyncExternalStore } from 'react';
import { subscribePwa, getPwaSnapshot } from '../pwa/client';
import { useNavigate, Link } from 'react-router-dom';
import { ShieldCheck, Loader2, Lock, ArrowLeft } from 'lucide-react';
import { useCart } from '../context/CartContext';
import DeliveryPicker from '../components/DeliveryPicker';
import { deliveryFeeLabel } from '../utils/delivery';
import WhatsAppLink from '../components/WhatsAppLink';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import { IS_PREVIEW_CATALOG } from '../api/catalog';

const CheckoutPage = () => {
  const { online, apiReachable } = useSyncExternalStore(
    subscribePwa,
    getPwaSnapshot
  );
  const {
    items,
    subtotal,
    deliveryTier,
    deliveryOption,
    deliveryPolicy,
    deliveryReady,
    refreshDelivery,
    paymentFee,
    totalAmount,
  } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  const hasPreviewItems = items.some((item) =>
    item.productId?.startsWith('preview-')
  );
  const previewCheckout = IS_PREVIEW_CATALOG || hasPreviewItems;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [courierAgreement, setCourierAgreement] = useState('');
  const [serverQuoteBag, setServerQuoteBag] = useState('');
  const bagKey = items.map((item) => item.id).join(',');
  const courier = deliveryOption?.method === 'courier';
  const pickup = deliveryOption?.method === 'pickup';
  const quoteRequired =
    !pickup &&
    (items.some((item) => item.deliveryRequiresQuote) ||
      serverQuoteBag === bagKey);
  const agreementKey = `${deliveryPolicy?.version || ''}:${deliveryTier}`;
  const deliveryAccepted = !courier || courierAgreement === agreementKey;

  // Form State
  const [formData, setFormData] = useState({
    name: user?.fullName || '',
    email: user?.email || '',
    phone: user?.phone || '',
    street: user?.addresses?.[0]?.street || '',
    city: user?.addresses?.[0]?.city || '',
    state: user?.addresses?.[0]?.state || 'Lagos',
  });

  const handleChange = (e) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handlePlaceOrder = async (e) => {
    e.preventDefault();
    setError('');
    if (!online || !apiReachable) {
      setError(
        'Connect to the store before paying. Your bag and entered details stay here.'
      );
      return;
    }
    if (previewCheckout) {
      setError(
        'These are sample products. Checkout will be available when the live catalog is connected.'
      );
      return;
    }

    if (!items.length) {
      setError('Your shopping bag is empty.');
      return;
    }

    if (!deliveryReady || !deliveryAccepted || quoteRequired) {
      setError('Review the delivery details before paying.');
      return;
    }
    if (
      !formData.name ||
      !formData.email ||
      !formData.phone ||
      (!pickup && (!formData.street || !formData.city || !formData.state))
    ) {
      setError('Please fill in all required shipping details.');
      return;
    }

    setLoading(true);

    try {
      const payload = {
        deliveryPolicyVersion: deliveryPolicy.version,
        courierDeliveryAccepted: courier && deliveryAccepted,
        customer: {
          name: formData.name,
          email: formData.email,
          phone: formData.phone,
        },
        shippingAddress: {
          street: formData.street,
          city: formData.city,
          state: formData.state,
          deliveryTier,
        },
        items: items.map((i) => ({
          productId: i.productId,
          productType: i.productType,
          name: i.name,
          unitPrice: i.price,
          size: i.size,
          retailVariantId: i.retailVariantId,
          color: i.color,
          quantity: i.quantity,
          fabricVariantId: i.fabricVariantId,
          fabricColor: i.fabricColor,
          yards: i.yards,
        })),
      };

      const res = await api.post('/orders', payload);

      if (res.data?.success) {
        const { authorizationUrl, orderNumber } = res.data.data;
        if (authorizationUrl) {
          // Dynamic payment gateway redirect (Paystack or Bachs.io)
          window.location.href = authorizationUrl;
        } else {
          navigate(`/checkout/confirmation?order=${orderNumber}`);
        }
      }
    } catch (err) {
      setError(err.message || 'Failed to place order. Please try again.');
      if (err.response?.data?.code === 'DELIVERY_QUOTE_REQUIRED')
        setServerQuoteBag(bagKey);
      void refreshDelivery();
    } finally {
      setLoading(false);
    }
  };

  if (!items.length) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center space-y-4">
        <h2 className="text-2xl font-bold text-text-primary">
          Your cart is empty
        </h2>
        <p className="text-xs text-text-secondary">
          Add retail items or fabrics to proceed to checkout.
        </p>
        <Link
          to="/shop"
          className="inline-block px-6 py-2.5 rounded-full bg-control-primary text-control-primary-text text-xs font-semibold shadow-xs"
        >
          Explore Products
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-6">
      <Link
        to="/shop"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span>Continue Shopping</span>
      </Link>

      {previewCheckout && (
        <p className="preview-checkout-note" role="status">
          You’re exploring sample products. Try variants, quantities and
          delivery totals below; payments are unavailable in preview mode.
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
        {/* Left: Customer & Delivery Details */}
        <form onSubmit={handlePlaceOrder} className="lg:col-span-7 space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-editorial text-text-primary">
              Checkout
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {user
                ? `Logged in as ${user.fullName}`
                : 'Frictionless Guest Checkout — no password required'}
            </p>
          </div>

          {error && (
            <div className="p-4 rounded-2xl bg-danger/10 text-danger text-xs font-semibold border border-danger/20">
              {error}
            </div>
          )}

          {/* Contact Details */}
          <div className="space-y-4 bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
              1. Contact Information
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  id="checkout-name"
                  aria-label="Full Name"
                  name="name"
                  required
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="e.g. Chioma Adebayo"
                  className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Email Address *
                </label>
                <input
                  type="email"
                  id="checkout-email"
                  aria-label="Email Address"
                  name="email"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  placeholder="chioma@example.com"
                  className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Phone Number (WhatsApp preferred) *
                </label>
                <input
                  type="tel"
                  id="checkout-phone"
                  aria-label="Phone Number"
                  name="phone"
                  required
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="08012345678"
                  className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Delivery Region & Address */}
          <div className="space-y-4 bg-surface p-5 sm:p-6 rounded-2xl border border-border shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
              2. Delivery Address
            </h3>

            <DeliveryPicker />
            {courier && (
              <label className="flex items-start gap-3 text-xs leading-relaxed text-text-secondary">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={deliveryAccepted}
                  onChange={(e) =>
                    setCourierAgreement(e.target.checked ? agreementKey : '')
                  }
                />{' '}
                <span>
                  I understand the delivery fee is separate and payable to the
                  courier on delivery. McLily will confirm the cost with me
                  before preparing or dispatching my order.
                </span>
              </label>
            )}
            {quoteRequired && (
              <div
                className="space-y-2 text-xs leading-relaxed text-text-secondary"
                role="status"
              >
                <p>
                  This bag includes an item that needs a delivery quote before
                  payment. Store collection is available only if listed above.
                </p>
                <WhatsAppLink
                  className="underline underline-offset-4"
                  message={`Hello McLily, please quote delivery for: ${items.map((item) => item.name).join(', ')}. My location is ${[formData.city, formData.state].filter(Boolean).join(', ') || 'to be confirmed'}.`}
                >
                  Ask for a delivery quote on WhatsApp
                </WhatsAppLink>
              </div>
            )}
            <fieldset hidden={pickup} disabled={pickup} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1">
                  Street Address *
                </label>
                <input
                  type="text"
                  id="checkout-street"
                  aria-label="Street Address"
                  name="street"
                  required
                  value={formData.street}
                  onChange={handleChange}
                  placeholder="Apartment, building, and street name"
                  className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-hidden"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    City / Town *
                  </label>
                  <input
                    type="text"
                    id="checkout-city"
                    aria-label="City / Town"
                    name="city"
                    required
                    value={formData.city}
                    onChange={handleChange}
                    placeholder="e.g. Ikeja, Lekki, or Abuja"
                    className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-secondary mb-1">
                    State *
                  </label>
                  <input
                    type="text"
                    id="checkout-state"
                    aria-label="State"
                    name="state"
                    required
                    value={formData.state}
                    onChange={handleChange}
                    placeholder="e.g. Lagos, FCT, Rivers"
                    className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-2.5 text-xs text-text-primary focus:outline-hidden"
                  />
                </div>
              </div>
            </fieldset>
          </div>

          {/* Place Order CTA */}
          <button
            type="submit"
            disabled={
              loading ||
              previewCheckout ||
              !deliveryReady ||
              !deliveryAccepted ||
              quoteRequired ||
              !online ||
              !apiReachable
            }
            className="w-full py-4 rounded-full bg-control-primary text-control-primary-text font-bold text-sm flex items-center justify-center gap-2  hover:opacity-95 transition-opacity disabled:opacity-50 pressable"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Lock className="w-4 h-4" />
                <span>
                  {previewCheckout
                    ? 'Preview only — payments unavailable'
                    : `Pay Securely · ₦${totalAmount.toLocaleString()}`}
                </span>
              </>
            )}
          </button>
        </form>

        {/* Right: Order Summary Sidebar */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border space-y-4 shadow-xs">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-tertiary">
              Order Summary ({items.length})
            </h3>

            {/* Items */}
            <div className="divide-y divide-border max-h-72 overflow-y-auto no-scrollbar">
              {items.map((item) => (
                <div
                  key={item.id}
                  className="py-3 flex justify-between items-center text-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <img
                      src={item.image}
                      alt=""
                      className="w-11 h-13 object-cover rounded-xl bg-surface-secondary flex-shrink-0"
                    />
                    <div>
                      <span className="font-semibold text-text-primary line-clamp-1">
                        {item.name}
                      </span>
                      <span className="text-text-tertiary text-[11px]">
                        {item.productType === 'retail'
                          ? `Qty: ${item.quantity} · Size: ${item.size || 'Std'}`
                          : `${item.yards} yds · ${item.fabricColor}`}
                      </span>
                    </div>
                  </div>

                  <span className="font-bold text-text-primary">
                    ₦
                    {(item.productType === 'retail'
                      ? item.price * item.quantity
                      : item.pricePerYard * item.yards
                    ).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <hr className="border-border" />

            {/* Fees Breakdown */}
            <div className="space-y-2 text-xs text-text-secondary">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="font-semibold text-text-primary">
                  ₦{subtotal.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>
                  {courier ? 'Courier delivery' : 'Delivery / collection'}
                </span>
                <span className="font-semibold text-text-primary">
                  {deliveryFeeLabel(deliveryOption)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Service Charge (2% + ₦100, max ₦5,000)</span>
                <span className="font-semibold text-text-primary">
                  ₦{paymentFee.toLocaleString()}
                </span>
              </div>
              <div className="border-t border-border pt-2.5 flex justify-between text-base font-bold text-text-primary">
                <span>
                  {courier
                    ? 'Pay online'
                    : deliveryReady
                      ? 'Total Amount'
                      : 'Estimated total'}
                </span>
                <span>₦{totalAmount.toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
              <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span>Encrypted payment rails · Paystack & Bachs.io</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CheckoutPage;
