import { Link, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { House, Store, Heart, ShoppingBag } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';

export default function BottomNav() {
  const { pathname } = useLocation();
  const { totalItemsCount, openBag, isBagOpen } = useCart();
  const { wishlistCount } = useWishlist();
  const tabs = [
    { label: 'Home', path: '/', icon: House },
    { label: 'Shop', path: '/shop', icon: Store },
    { label: 'Wishlist', path: '/wishlist', icon: Heart, badge: wishlistCount },
  ];
  return (
    <nav className="mobile-navigation" aria-label="Mobile navigation">
      <div className="mobile-tabs glass-pill">
        {tabs.map(({ label, path, icon: Icon, badge }) => {
          const active = pathname === path && !isBagOpen;
          return (
            <Link
              key={path}
              to={path}
              className={`mobile-tab pressable ${active ? 'is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              {active && (
                <motion.span
                  className="tab-indicator"
                  layoutId="activeTabIndicator"
                  transition={{ type: 'spring', damping: 28, stiffness: 350 }}
                />
              )}
              <span className="tab-icon">
                <Icon size={20} strokeWidth={active ? 1.9 : 1.4} />
                {badge > 0 && <span className="nav-count">{badge}</span>}
              </span>
              <span>{label}</span>
            </Link>
          );
        })}
        <button
          className={`mobile-tab pressable ${isBagOpen ? 'is-active' : ''}`}
          onClick={openBag}
          aria-label="Open Shopping Bag"
        >
          <span className="tab-icon">
            <ShoppingBag size={20} strokeWidth={1.4} />
            {totalItemsCount > 0 && (
              <span className="nav-count">{totalItemsCount}</span>
            )}
          </span>
          <span>Bag</span>
        </button>
      </div>
    </nav>
  );
}
