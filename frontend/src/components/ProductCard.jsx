import { Link } from 'react-router-dom';
import { Heart, Plus, Star } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';

export default function ProductCard({ product }) {
  const { addRetailItem } = useCart();
  const { toggleWishlist, isInWishlist } = useWishlist();
  const saved = isInWishlist(product._id);
  const variants = product.sizes?.filter((variant) => (variant.availableStock ?? variant.stock) > 0) || [];
  const discount = product.originalPrice > product.price ? Math.round((1 - product.price / product.originalPrice) * 100) : 0;
  const href = `/product/${product.slug}`;
  return (
    <article className="product-card">
      <div className="product-card-image">
        <Link to={href} tabIndex={-1} aria-hidden="true"><img src={product.images?.[0]} alt="" loading="lazy" /></Link>
        <button className="product-save pressable" onClick={() => toggleWishlist(product)} aria-label={`${saved ? 'Remove' : 'Save'} ${product.name} ${saved ? 'from' : 'to'} wishlist`} aria-pressed={saved}>
          <Heart size={17} strokeWidth={1.6} className={saved ? 'fill-danger text-danger' : ''} />
        </button>
        {discount > 0 && <span className="product-discount">−{discount}%</span>}
      </div>
      <div className="product-card-info">
        <Link to={href} className="product-name">{product.name}</Link>
        <p className="product-category">{product.category}</p>
        <div className="flex items-center justify-between gap-1 mt-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-semibold">₦{product.price.toLocaleString()}</span>
            {discount > 0 && <del className="text-[11px] text-text-tertiary">₦{product.originalPrice.toLocaleString()}</del>}
          </div>
          {variants.length === 1 ? <button className="product-add pressable" aria-label={`Add ${product.name} to bag`} onClick={() => addRetailItem({ product, size: variants[0].size, color: variants[0].color, quantity: 1 })}><Plus size={17} strokeWidth={1.6} /></button>
            : <Link to={href} className="product-add pressable" aria-label={`Choose options for ${product.name}`}><Plus size={17} strokeWidth={1.6} /></Link>}
        </div>
        {product.reviewsCount > 0 && product.rating > 0 && <p className="flex items-center gap-1 text-[11px] text-text-secondary mt-1.5"><Star size={11} className="fill-amber-500 text-amber-500" /> {product.rating.toFixed(1)} <span>({product.reviewsCount})</span></p>}
      </div>
    </article>
  );
}
