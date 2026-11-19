import { IS_PREVIEW_CATALOG } from '../api/catalog';
import React, { createContext, useContext, useState, useEffect } from 'react';

const STORAGE_KEY = IS_PREVIEW_CATALOG ? 'mcl_preview_wishlist' : 'mcl_wishlist';

const WishlistContext = createContext();

export const WishlistProvider = ({ children }) => {
  const [wishlist, setWishlist] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wishlist));
    } catch (err) {
      console.warn('Failed to persist wishlist:', err);
    }
  }, [wishlist]);

  const toggleWishlist = (product) => {
    if (!product || !product._id) return;
    setWishlist((prev) => {
      const exists = prev.some((item) => item._id === product._id);
      if (exists) {
        return prev.filter((item) => item._id !== product._id);
      } else {
        return [
          ...prev,
          {
            _id: product._id,
            name: product.name,
            slug: product.slug,
            price: product.price || product.pricePerYard,
            originalPrice: product.originalPrice,
            category: product.category || 'Retail',
            images: product.images || [],
            productType: product.productType || 'retail',
            pricePerYard: product.pricePerYard,
            sizes: product.sizes,
            colorVariants: product.colorVariants,
            rating: product.rating || 0,
            reviewsCount: product.reviewsCount || 0,
          },
        ];
      }
    });
  };

  const isInWishlist = (productId) => {
    return wishlist.some((item) => item._id === productId);
  };

  const removeFromWishlist = (productId) => {
    setWishlist((prev) => prev.filter((item) => item._id !== productId));
  };

  const clearWishlist = () => {
    setWishlist([]);
  };

  return (
    <WishlistContext.Provider
      value={{
        wishlist,
        wishlistCount: wishlist.length,
        toggleWishlist,
        isInWishlist,
        removeFromWishlist,
        clearWishlist,
      }}
    >
      {children}
    </WishlistContext.Provider>
  );
};

export const useWishlist = () => useContext(WishlistContext);
export default WishlistContext;
