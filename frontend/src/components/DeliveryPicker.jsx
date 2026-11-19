import { useCart } from '../context/CartContext';
import { deliveryFeeLabel } from '../utils/delivery';
export default function DeliveryPicker({ id = 'checkout-delivery' }) {
  const {
    deliveryTier,
    setDeliveryTier,
    deliveryPolicy,
    deliveryOption,
    deliveryLoading,
    deliveryError,
    refreshDelivery,
  } = useCart();
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-medium text-text-secondary"
      >
        Delivery or collection
      </label>
      <select
        id={id}
        value={deliveryTier}
        onChange={(e) => setDeliveryTier(e.target.value)}
        disabled={deliveryLoading || !deliveryPolicy?.options.length}
        className="w-full bg-surface-secondary border border-border rounded-xl px-3.5 py-3 text-xs text-text-primary"
      >
        {!deliveryTier && (
          <option value="">
            {deliveryLoading
              ? 'Loading delivery options…'
              : 'Delivery options unavailable'}
          </option>
        )}
        {deliveryPolicy?.options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name} · {deliveryFeeLabel(option)}
          </option>
        ))}
      </select>
      {deliveryOption && (
        <p className="text-xs leading-relaxed text-text-secondary">
          {deliveryOption.description}
        </p>
      )}
      {deliveryError && (
        <p role="alert" className="text-xs text-text-secondary">
          {deliveryError}{' '}
          <button
            type="button"
            className="underline underline-offset-4"
            onClick={refreshDelivery}
          >
            Try again
          </button>
        </p>
      )}
      {!deliveryLoading &&
        !deliveryError &&
        !deliveryPolicy?.options.length && (
          <p className="text-xs text-text-secondary">
            Please contact McLily to arrange delivery before paying.
          </p>
        )}
    </div>
  );
}
