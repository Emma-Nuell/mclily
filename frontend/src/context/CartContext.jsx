import { IS_PREVIEW_CATALOG } from "../api/catalog";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import api from "../api/client";
import { cartPersistencePending, cartPersistenceFinished } from "../pwa/client";

const STORAGE_KEY = IS_PREVIEW_CATALOG
  ? "mcl_preview_cart_items"
  : "mcl_cart_items";

const CartContext = createContext();

export const CartProvider = ({ children }) => {
  const [loadedCart] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const items = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(items)) throw new Error("Invalid saved bag");
      return { items, readable: true };
    } catch {
      return { items: [], readable: false };
    }
  });
  const [items, setItems] = useState(loadedCart.items);

  const [isBagOpen, setIsBagOpen] = useState(false);
  const [deliveryTier, setDeliveryTier] = useState("");
  const [deliveryPolicy, setDeliveryPolicy] = useState(null);
  const [deliveryLoading, setDeliveryLoading] = useState(true);
  const [deliveryError, setDeliveryError] = useState("");
  const loadDelivery = useCallback((signal) => {
    return api
      .get("/delivery/options", { signal })
      .then((response) => {
        if (signal?.aborted) return;
        const policy = response.data?.data;
        if (
          !response.data?.success ||
          !policy?.version ||
          !Array.isArray(policy.options)
        )
          throw new Error(
            "Delivery options are unavailable. Please try again.",
          );
        setDeliveryPolicy(policy);
        setDeliveryTier((current) =>
          policy.options.some((option) => option.id === current)
            ? current
            : policy.options[0]?.id || "",
        );
      })
      .catch((error) => {
        if (!signal?.aborted) setDeliveryError(error.message);
      })
      .finally(() => {
        if (!signal?.aborted) setDeliveryLoading(false);
      });
  }, []);
  const refreshDelivery = useCallback(() => {
    setDeliveryLoading(true);
    setDeliveryError("");
    return loadDelivery();
  }, [loadDelivery]);
  useEffect(() => {
    const controller = new AbortController();
    void loadDelivery(controller.signal);
    window.addEventListener("online", refreshDelivery);
    return () => {
      controller.abort();
      window.removeEventListener("online", refreshDelivery);
    };
  }, [loadDelivery, refreshDelivery]);
  const deliveryOption = deliveryPolicy?.options.find(
    (v) => v.id === deliveryTier,
  );
  const deliveryReady = Boolean(
    deliveryOption && !deliveryLoading && !deliveryError,
  );

  useEffect(() => {
    const persist = () => {
      if (!loadedCart.readable) {
        cartPersistenceFinished(false);
        return;
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        cartPersistenceFinished(true);
      } catch {
        cartPersistenceFinished(false);
      }
    };
    persist();
    window.addEventListener("mcl:retry-bag-save", persist);
    return () => window.removeEventListener("mcl:retry-bag-save", persist);
  }, [items, loadedCart.readable]);

  const openBag = () => setIsBagOpen(true);
  const closeBag = () => setIsBagOpen(false);

  // Add Retail Product
  const addRetailItem = ({ product, size, color, quantity = 1 }) => {
    cartPersistencePending();
    const variant = product.sizes?.find(
      (v) => v.size === size && (color === undefined || v.color === color),
    );
    setItems((prev) => {
      const existingIndex = prev.findIndex(
        (i) =>
          i.productId === product._id && i.size === size && i.color === color,
      );

      if (existingIndex > -1) {
        const next = [...prev];
        next[existingIndex].quantity += quantity;
        return next;
      }

      return [
        ...prev,
        {
          id: `${product._id}_${size || "std"}_${color || "def"}`,
          productId: product._id,
          productType: "retail",
          name: product.name,
          deliveryRequiresQuote: Boolean(product.deliveryRequiresQuote),
          slug: product.slug,
          price: variant?.priceOverride ?? product.price,
          originalPrice: product.originalPrice,
          image: product.images?.[0] || "",
          size,
          retailVariantId: variant?._id,
          color,
          quantity,
        },
      ];
    });
    // openBag();
  };

  // Add Fabric Product (by the yard with 0.5 increments, Checklist 2.1.2)
  const addFabricItem = ({ product, colorVariant, yards }) => {
    cartPersistencePending();
    const validYards = Math.max(1, Math.round(Number(yards) * 2) / 2);

    setItems((prev) => {
      const existingIndex = prev.findIndex(
        (i) =>
          i.productId === product._id && i.fabricVariantId === colorVariant._id,
      );

      if (existingIndex > -1) {
        const next = [...prev];
        next[existingIndex].yards += validYards;
        next[existingIndex].halfYards = Math.round(
          next[existingIndex].yards * 2,
        );
        return next;
      }

      return [
        ...prev,
        {
          id: `${product._id}_fabric_${colorVariant._id}`,
          productId: product._id,
          productType: "fabric",
          deliveryRequiresQuote: Boolean(product.deliveryRequiresQuote),
          name: product.name,
          slug: product.slug,
          price: product.pricePerYard,
          pricePerYard: product.pricePerYard,
          image: colorVariant.image || product.images?.[0] || "",
          fabricVariantId: colorVariant._id,
          fabricColor: colorVariant.colorName,
          material: product.material,
          yards: validYards,
          halfYards: Math.round(validYards * 2),
        },
      ];
    });
    // openBag();
  };

  const removeItem = (id) => {
    cartPersistencePending();
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateQuantity = (id, delta) => {
    cartPersistencePending();
    setItems((prev) =>
      prev
        .map((item) => {
          if (item.id === id) {
            if (item.productType === "retail") {
              const newQty = item.quantity + delta;
              return newQty > 0 ? { ...item, quantity: newQty } : null;
            } else if (item.productType === "fabric") {
              const newYards = Math.max(1, item.yards + delta * 0.5);
              return {
                ...item,
                yards: newYards,
                halfYards: Math.round(newYards * 2),
              };
            }
          }
          return item;
        })
        .filter(Boolean),
    );
  };

  const clearCart = useCallback(() => {
    cartPersistencePending();
    setItems([]);
  }, []);

  // Pricing computations
  const subtotal = items.reduce((acc, item) => {
    if (item.productType === "retail") {
      return acc + item.price * item.quantity;
    } else {
      return acc + item.pricePerYard * item.yards;
    }
  }, 0);

  const deliveryFee = deliveryOption?.fee ?? 0;
  const baseAmount = subtotal + deliveryFee;

  // Formula: min((2% × baseAmount) + ₦100, ₦5000)
  const calculateFee = (base) => {
    if (base <= 0) return 0;
    const fee = 0.02 * base + 100;
    return Math.round(Math.min(fee, 5000) * 100) / 100;
  };

  const paymentFee = calculateFee(baseAmount);
  const totalAmount = Math.round((baseAmount + paymentFee) * 100) / 100;

  const totalItemsCount = items.reduce((acc, item) => {
    return acc + (item.productType === "retail" ? item.quantity : 1);
  }, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        isBagOpen,
        openBag,
        closeBag,
        addRetailItem,
        addFabricItem,
        removeItem,
        updateQuantity,
        clearCart,
        subtotal,
        deliveryFee,
        deliveryTier,
        setDeliveryTier,
        deliveryPolicy,
        deliveryOption,
        deliveryReady,
        deliveryLoading,
        deliveryError,
        refreshDelivery,
        paymentFee,
        totalAmount,
        totalItemsCount,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

// Keep the existing public hook; context edits may reload consumers during development.
// eslint-disable-next-line react-refresh/only-export-components
export const useCart = () => useContext(CartContext);
export default CartContext;
