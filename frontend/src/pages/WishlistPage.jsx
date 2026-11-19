import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Heart, ShoppingBag, Trash2, ArrowRight } from 'lucide-react';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';

const WishlistPage = () => {
  const { wishlist, removeFromWishlist, clearWishlist } = useWishlist();
  const { addRetailItem, addFabricItem } = useCart();

  const navigate = useNavigate();
  const handleAddToCart = (item) => {
    const variants = item.sizes?.filter(s => s.stock > 0) || [];
    if (item.productType === 'fabric' || variants.length !== 1) {
      navigate(`${item.productType === 'fabric' ? '/fabrics' : '/product'}/${item.slug}`);
    } else {
      addRetailItem({ product: item, size: variants[0].size, color: variants[0].color, quantity: 1 });
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl sm:text-3xl font-editorial text-text-primary">
            Saved Wishlist
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
            {wishlist.length} {wishlist.length === 1 ? 'item' : 'items'} saved for later
          </p>
        </div>

        {wishlist.length > 0 && (
          <button
            onClick={clearWishlist}
            className="text-xs text-text-tertiary hover:text-danger font-medium transition-colors"
          >
            Clear All
          </button>
        )}
      </div>

      {wishlist.length === 0 ? (
        <div className="py-20 text-center space-y-3">
          <div className="w-16 h-16 rounded-full bg-surface-secondary flex items-center justify-center mx-auto text-text-tertiary">
            <Heart className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-text-primary">Your wishlist is empty</h3>
          <p className="text-xs text-text-secondary max-w-sm mx-auto">
            Tap the heart icon on any product or fabric to save it here for later.
          </p>
          <div className="pt-2">
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-control-primary text-control-primary-text text-xs font-semibold pressable shadow-xs"
            >
              <span>Explore Products</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
          {wishlist.map((item) => (
            <div
              key={item._id}
              className="group bg-surface rounded-2xl border border-border p-3 sm:p-4 flex flex-col justify-between hover:shadow-lg transition-all"
            >
              <div>
                <div className="relative aspect-[4/5] rounded-xl overflow-hidden bg-surface-secondary mb-3">
                  <Link to={item.productType === 'fabric' ? `/fabrics/${item.slug}` : `/product/${item.slug}`}>
                    <img
                      src={item.images?.[0] || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=80'}
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  </Link>

                  <button
                    onClick={() => removeFromWishlist(item._id)}
                    className="absolute top-2 right-2 p-2 rounded-full bg-surface/85 backdrop-blur-md text-danger hover:bg-surface transition-colors shadow-xs"
                    aria-label="Remove from wishlist"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <Link to={item.productType === 'fabric' ? `/fabrics/${item.slug}` : `/product/${item.slug}`}>
                  <h3 className="text-xs sm:text-sm font-semibold text-text-primary line-clamp-1 group-hover:underline">
                    {item.name}
                  </h3>
                </Link>
                <p className="text-[11px] text-text-secondary mt-0.5 truncate">{item.category}</p>
              </div>

              <div className="mt-3 pt-2.5 border-t border-border flex items-center justify-between">
                <span className="text-xs sm:text-sm font-bold text-text-primary">
                  ₦{item.price.toLocaleString()}
                  {item.productType === 'fabric' && <span className="text-[11px] font-normal text-text-tertiary"> /yd</span>}
                </span>

                <button
                  onClick={() => handleAddToCart(item)}
                  className="px-3 py-1.5 rounded-full bg-control-primary text-control-primary-text text-[11px] font-semibold flex items-center gap-1.5 pressable shadow-xs"
                >
                  <ShoppingBag className="w-3 h-3" />
                  <span>Add</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default WishlistPage;
