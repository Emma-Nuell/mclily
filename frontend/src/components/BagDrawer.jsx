import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, Plus, Minus, ArrowRight, ShoppingBag } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import DeliveryPicker from './DeliveryPicker';
import { deliveryFeeLabel } from '../utils/delivery';
import SavedCatalogNotice from './SavedCatalogNotice';

const BagDrawer = () => {
  const {
    isBagOpen,
    closeBag,
    items,
    removeItem,
    updateQuantity,
    subtotal,
    deliveryOption,
    deliveryReady,
    paymentFee,
    totalAmount,
  } = useCart();

  const navigate = useNavigate();
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!isBagOpen) return;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() =>
      dialogRef.current?.querySelector('button')?.focus()
    );
    const handleKey = (event) => {
      if (event.key === 'Escape') closeBag();
      if (event.key !== 'Tab') return;
      const nodes = dialogRef.current?.querySelectorAll(
        'button, a[href], select, input'
      );
      if (!nodes?.length) return;
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKey);
      previous?.focus();
    };
  }, [isBagOpen, closeBag]);

  const handleCheckout = () => {
    closeBag();
    navigate('/checkout');
  };

  return (
    <AnimatePresence>
      {isBagOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop Dim Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeBag}
            className="fixed inset-0 bg-black/45 backdrop-blur-xs"
          />

          {/* Slide-out Sheet */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Your shopping bag"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="relative w-full max-w-md bg-surface h-[100dvh]  flex flex-col z-10 border-l border-border"
          >
            {/* Header */}
            <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-surface">
              <div className="flex items-center gap-2.5">
                <ShoppingBag className="w-5 h-5 text-text-primary" />
                <h2 className="text-base sm:text-lg font-bold tracking-tight text-text-primary">
                  Your Cart ({items.length})
                </h2>
              </div>
              <button
                onClick={closeBag}
                className="p-2 rounded-full hover:bg-surface-secondary text-text-secondary hover:text-text-primary transition-colors pressable"
                aria-label="Close cart"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Items List */}
            <div className="flex-1 overflow-y-auto px-6 py-4 divide-y divide-border no-scrollbar">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                  <div className="w-16 h-16 rounded-full bg-surface-secondary flex items-center justify-center mb-4">
                    <ShoppingBag className="w-7 h-7 text-text-tertiary" />
                  </div>
                  <h3 className="text-base font-semibold text-text-primary mb-1">
                    Your cart is empty
                  </h3>
                  <p className="text-xs text-text-secondary mb-6 max-w-xs">
                    Explore our retail collection or authentic luxury fabrics
                    sold by the yard.
                  </p>
                  <button
                    onClick={closeBag}
                    className="px-6 py-2.5 rounded-full bg-control-primary text-control-primary-text text-xs font-semibold pressable shadow-xs"
                  >
                    Start Shopping
                  </button>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="py-4 flex gap-4 items-center">
                    <img
                      src={
                        item.image ||
                        'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=300&q=80'
                      }
                      alt={item.name}
                      className="w-18 h-22 sm:w-20 sm:h-24 object-cover rounded-2xl bg-surface-secondary flex-shrink-0"
                    />

                    <div className="flex-1 min-w-0 flex flex-col justify-between h-full py-0.5">
                      <div>
                        <div className="flex justify-between items-start gap-2">
                          <h4 className="text-sm font-semibold text-text-primary truncate">
                            {item.name}
                          </h4>
                          <button
                            onClick={() => removeItem(item.id)}
                            className="text-text-tertiary hover:text-danger transition-colors p-1"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <p className="text-xs text-text-secondary mt-0.5">
                          {item.productType === 'retail'
                            ? `Size: ${item.size || 'Standard'}${item.color ? ` · Color: ${item.color}` : ''}`
                            : `Color: ${item.fabricColor || 'Swatch'} · ${item.material || 'Fabric'}`}
                        </p>

                        <div className="text-xs font-bold text-text-primary mt-1">
                          ₦
                          {(item.productType === 'retail'
                            ? item.price * item.quantity
                            : item.pricePerYard * item.yards
                          ).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex items-center justify-between mt-2.5">
                        {/* Stepper pill */}
                        <div className="flex items-center border border-border bg-surface-secondary/70 rounded-full px-2 py-0.5 gap-2">
                          <button
                            onClick={() => updateQuantity(item.id, -1)}
                            className="p-1 text-text-secondary hover:text-text-primary"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="text-xs font-semibold px-1 min-w-[20px] text-center text-text-primary">
                            {item.productType === 'retail'
                              ? item.quantity
                              : `${item.yards} yd`}
                          </span>
                          <button
                            onClick={() => updateQuantity(item.id, 1)}
                            className="p-1 text-text-secondary hover:text-text-primary"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer Summary & Checkout */}
            {items.length > 0 && (
              <div className="border-t border-border p-5 sm:p-6 pb-[max(20px,env(safe-area-inset-bottom))] bg-surface space-y-4">
                <DeliveryPicker id="bag-delivery" />
                <SavedCatalogNotice />

                {/* Price Breakdown */}
                <div className="space-y-1.5 text-xs text-text-secondary">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span className="font-semibold text-text-primary">
                      ₦{subtotal.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Delivery Fee</span>
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
                  <div className="border-t border-border pt-2 flex justify-between text-base font-bold text-text-primary">
                    <span>
                      {deliveryOption?.method === 'courier'
                        ? 'Pay online'
                        : deliveryReady
                          ? 'Total'
                          : 'Estimated total'}
                    </span>
                    <span>₦{totalAmount.toLocaleString()}</span>
                  </div>
                </div>

                {/* Checkout CTA Button */}
                <button
                  onClick={handleCheckout}
                  className="w-full py-4 px-6 rounded-xl bg-control-primary text-control-primary-text font-bold text-sm flex items-center justify-center gap-2  hover:opacity-95 transition-opacity pressable"
                >
                  <span>Proceed to Checkout</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default BagDrawer;
