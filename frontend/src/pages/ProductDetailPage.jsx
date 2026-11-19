import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ShoppingBag,
  Star,
  ShieldCheck,
  Truck,
  RotateCcw,
  Plus,
  Minus,
  ArrowLeft,
  Loader2,
  Sparkles,
  Heart,
  Share2,
  Check
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import api from '../api/catalog';
import SavedCatalogNotice from '../components/SavedCatalogNotice';

const ProductDetailPage = () => {
  const { slug } = useParams();
  const { addRetailItem, addFabricItem } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();
  const navigate = useNavigate();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);
  const [shareMessage, setShareMessage] = useState('');

  // Retail State
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [quantity, setQuantity] = useState(1);

  // Fabric State
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [yards, setYards] = useState(1);

  useEffect(() => {
    const fetchProduct = async () => {
      setLoading(true);
      setError(false);
      setSelectedImage(0);
      setQuantity(1);
      setYards(1);
      setSelectedSize(null);
      setSelectedVariant(null);
      try {
        const res = await api.get(`/products/${slug}`);
        if (res.data?.success) {
          const item = res.data.data;
          setProduct(item);

          if (item.productType === 'retail' && item.sizes?.length) {
            setSelectedSize(item.sizes[0]);
            setSelectedColor(item.sizes[0]?.color || 'Standard');
          } else if (item.productType === 'fabric' && item.colorVariants?.length) {
            setSelectedVariant(item.colorVariants[0]);
          }
        }
      } catch (err) {
        console.warn(err.message);
        setError(true);
        setProduct(null);
      } finally {
        setLoading(false);
      }
    };

    fetchProduct();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-text-tertiary animate-spin" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-24 text-center space-y-4">
        <h2 className="text-2xl font-bold text-text-primary">{error ? 'We couldn’t load this product' : 'Product not found'}</h2>
        <Link to="/shop" className="text-xs font-semibold text-text-secondary underline">
          Return to Store
        </Link>
      </div>
    );
  }

  const isFabric = product.productType === 'fabric';
  const wishlisted = isInWishlist(product._id);

  const discountPercent =
    product.originalPrice && product.originalPrice > product.price
      ? Math.round(((product.originalPrice - product.price) / product.originalPrice) * 100)
      : null;

  const handleAddToBag = () => {
    if (isFabric) {
      if (!selectedVariant) return;
      addFabricItem({
        product,
        colorVariant: selectedVariant,
        yards,
      });
    } else {
      addRetailItem({
        product,
        size: selectedSize?.size,
        color: selectedSize?.color || selectedColor,
        quantity,
      });
    }
  };

  const handleBuyNow = () => {
    handleAddToBag();
    navigate('/checkout');
  };

  const availableStock = isFabric
    ? (selectedVariant?.availableHalfYards ?? selectedVariant?.rollStockHalfYards ?? 0) / 2
    : selectedSize?.availableStock ?? selectedSize?.stock ?? 0;

  const isLowStock = availableStock > 0 && (isFabric
    ? availableStock <= 3
    : availableStock <= (product.lowStockThreshold || 5));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-10 space-y-8">
      {/* Back and Action Navigation Bar */}
      <div className="flex items-center justify-between">
        <Link
          to={isFabric ? '/fabrics' : '/shop'}
          className="p-2.5 rounded-full bg-surface border border-border text-text-primary hover:bg-surface-secondary transition-colors pressable flex items-center justify-center shadow-xs"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary" role="status">{shareMessage}</span>
          <button
            onClick={() => toggleWishlist(product)}
            className="p-2.5 rounded-full bg-surface border border-border text-text-primary hover:bg-surface-secondary transition-colors pressable shadow-xs"
            aria-label="Wishlist"
          >
            <Heart
              className={`w-4 h-4 ${wishlisted ? 'fill-danger text-danger' : 'text-text-primary'}`}
            />
          </button>
          <button
            onClick={async () => {
              try {
                if (navigator.share) await navigator.share({ title: product.name, url: window.location.href });
                else { await navigator.clipboard.writeText(window.location.href); setShareMessage('Link copied'); }
              } catch (error) {
                if (error.name !== 'AbortError') setShareMessage('Copy the address from your browser to share this product.');
              }
            }}
            className="p-2.5 rounded-full bg-surface border border-border text-text-primary hover:bg-surface-secondary transition-colors pressable shadow-xs"
            aria-label="Share product"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-14 items-start">
        {/* Left: Product Gallery (Matching Screen 4 & 7) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative aspect-square sm:aspect-[4/5] rounded-2xl overflow-hidden bg-surface-secondary">
            <img
              src={(isFabric && selectedImage === 0 && selectedVariant?.image) || product.images?.[selectedImage] || product.images?.[0]}
              alt={product.name}
              className="w-full h-full object-cover"
            />

            {/* Pagination dots */}
            {product.images?.length > 1 && (
              <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2">
                {product.images.map((_, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedImage(idx)}
                    className={`h-2 rounded-full transition-all ${
                      selectedImage === idx ? 'w-6 bg-control-primary' : 'w-2 bg-neutral-400/60'
                    }`}
                    aria-label={`Go to slide ${idx + 1}`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Thumbnails */}
          {product.images?.length > 1 && (
            <div className="flex gap-3 overflow-x-auto no-scrollbar">
              {product.images.map((img, idx) => (
                <button
                  key={idx}
                  aria-label={`View product image ${idx + 1}`}
                  onClick={() => setSelectedImage(idx)}
                  className={`w-18 h-22 rounded-2xl overflow-hidden border-2 transition-all pressable flex-shrink-0 ${
                    selectedImage === idx
                      ? 'border-control-primary shadow-xs'
                      : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                >
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Product Details & Controls */}
        <div className="lg:col-span-5 space-y-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-editorial text-text-primary leading-snug">
              {product.name}
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">{product.category}</p>

            {/* Pricing & Discount Badge */}
            <div className="mt-3 flex items-center gap-3">
              <span className="text-2xl sm:text-3xl font-bold text-text-primary">
                ₦{product.price.toLocaleString()}
                {isFabric && <span className="text-xs font-normal text-text-tertiary"> /yd</span>}
              </span>

              {product.originalPrice && product.originalPrice > product.price && (
                <span className="text-sm text-text-tertiary line-through">
                  ₦{product.originalPrice.toLocaleString()}
                </span>
              )}

              {discountPercent && (
                <span className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold px-2.5 py-0.5 rounded-full">
                  +{discountPercent}% OFF
                </span>
              )}
            </div>

            {/* Rating Stars */}
            {product.reviewsCount > 0 && product.rating > 0 && <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500">
              <Star className="w-4 h-4 fill-current" />
              <span className="font-bold text-text-primary">{product.rating}</span>
              <span className="text-text-tertiary">({product.reviewsCount} reviews)</span>
            </div>}

            {/* Low Stock Warning */}
            {isLowStock && (
              <p className="mt-3 text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span>⚠️ Only {availableStock} {isFabric ? 'yards' : 'left in stock'} — order soon!</span>
              </p>
            )}
          </div>

          <hr className="border-border" />

          {/* Variants Selector */}
          {isFabric ? (
            <div className="space-y-4">
              {/* Fabric Swatches */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2">
                  Select Shade: <span className="text-text-primary font-semibold">{selectedVariant?.colorName}</span>
                </label>
                <div className="flex flex-wrap gap-2.5">
                  {product.colorVariants?.map((cv) => (
                    <button
                      key={cv._id}
                      onClick={() => setSelectedVariant(cv)}
                      className={`flex items-center gap-2 px-3.5 py-2 rounded-full border text-xs transition-all pressable ${
                        selectedVariant?._id === cv._id
                          ? 'border-control-primary bg-surface-secondary font-bold ring-1 ring-control-primary'
                          : 'border-border bg-surface hover:border-text-secondary'
                      }`}
                    >
                      <span
                        style={{ backgroundColor: cv.swatchColor || '#888' }}
                        className="w-3.5 h-3.5 rounded-full border border-black/10 inline-block shadow-2xs"
                      />
                      <span>{cv.colorName}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Length in Yards (Pills + Stepper) */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2">
                  Select Length:
                </label>
                <div className="flex items-center gap-2 mb-3">
                  {[1, 2, 3, 5].map((pill) => (
                    <button
                      key={pill}
                      onClick={() => setYards(pill)}
                      disabled={pill > availableStock}
                      className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-colors pressable disabled:opacity-40 ${
                        yards === pill
                          ? 'bg-control-primary text-control-primary-text border-transparent shadow-xs'
                          : 'bg-surface border-border hover:bg-surface-secondary text-text-primary'
                      }`}
                    >
                      {pill} yd
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center border border-border bg-surface rounded-full px-3 py-1.5 gap-3">
                    <button
                      onClick={() => setYards((y) => Math.max(1, y - 0.5))}
                      className="text-text-secondary hover:text-text-primary p-1"
                      aria-label="Decrease yards"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                    <span className="text-sm font-semibold min-w-[50px] text-center text-text-primary">
                      {yards} yd
                    </span>
                    <button
                      onClick={() => setYards((y) => y + 0.5)}
                      disabled={yards + 0.5 > availableStock}
                      className="text-text-secondary hover:text-text-primary p-1"
                      aria-label="Increase yards"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-xs text-text-tertiary font-medium">
                    Total: ₦{(product.pricePerYard * yards).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Retail Size Selector */}
              {product.sizes?.length > 0 && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2">
                    Size:
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {product.sizes.map((s, idx) => (
                      <button
                        key={idx}
                        onClick={() => setSelectedSize(s)}
                        disabled={(s.availableStock ?? s.stock) < 1}
                        className={`min-w-[44px] px-3.5 py-2.5 rounded-xl text-xs font-medium border transition-all pressable disabled:opacity-40 ${
                          selectedSize?.size === s.size
                            ? 'bg-control-primary text-control-primary-text border-transparent shadow-xs'
                            : 'bg-surface border-border text-text-primary hover:border-text-secondary'
                        }`}
                      >
                        {s.size}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Color swatches */}
              {product.colors && (
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2">
                    Color:
                  </label>
                  <div className="flex items-center gap-2">
                    {product.colors.map((c, i) => (
                      <button
                        key={i}
                        onClick={() => setSelectedColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full border border-border shadow-xs transition-transform ${
                          selectedColor === c ? 'scale-125 ring-2 ring-control-primary' : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Quantity Stepper */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2">
                  Quantity:
                </label>
                <div className="flex items-center border border-border bg-surface rounded-full px-3 py-1.5 gap-3 w-fit">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="text-text-secondary hover:text-text-primary p-1"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-sm font-semibold min-w-[32px] text-center text-text-primary">{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    disabled={quantity + 1 > availableStock}
                    className="text-text-secondary hover:text-text-primary p-1"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons: Add to Cart & Buy Now */}
          <div className="space-y-3 pt-2">
            <SavedCatalogNotice />
            <button
              onClick={handleAddToBag}
              disabled={availableStock <= 0 || (isFabric ? yards : quantity) > availableStock}
              className="w-full py-4 rounded-xl bg-control-primary text-control-primary-text font-semibold text-sm flex items-center justify-center gap-2 hover:opacity-95 transition-opacity pressable"
            >
              <ShoppingBag className="w-5 h-5" />
              <span>{availableStock <= 0 ? 'Out of stock' : 'Add to Cart'}</span>
            </button>

            <button
              onClick={handleBuyNow}
              disabled={availableStock <= 0 || (isFabric ? yards : quantity) > availableStock}
              className="w-full py-3.5 rounded-xl bg-surface border border-border text-text-primary hover:bg-surface-secondary font-semibold text-sm transition-colors pressable"
            >
              Buy Now
            </button>
          </div>

          {/* Value Props Strip */}
          <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border text-center">
            <div className="space-y-1">
              <Truck className="w-4 h-4 mx-auto text-text-secondary" />
              <p className="text-[11px] font-semibold text-text-primary">Delivery</p>
              <p className="text-[10px] text-text-tertiary">Across Nigeria</p>
            </div>
            <div className="space-y-1">
              <RotateCcw className="w-4 h-4 mx-auto text-text-secondary" />
              <p className="text-[11px] font-semibold text-text-primary">In-store pickup</p>
              <p className="text-[10px] text-text-tertiary">Available at checkout</p>
            </div>
            <div className="space-y-1">
              <ShieldCheck className="w-4 h-4 mx-auto text-text-secondary" />
              <p className="text-[11px] font-semibold text-text-primary">Secure Payment</p>
              <p className="text-[10px] text-text-tertiary">Paystack & Bachs</p>
            </div>
          </div>

          {/* Description */}
          <div className="pt-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-2">
              Product Details
            </h4>
            <p className="text-xs sm:text-sm text-text-secondary leading-relaxed font-light">
              {product.description}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductDetailPage;
