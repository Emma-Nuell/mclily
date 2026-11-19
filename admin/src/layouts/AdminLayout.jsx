import { NavLink, Link, Outlet, useLocation } from 'react-router-dom';
import {
  Home,
  ShoppingBag,
  Package,
  Plus,
  MoreHorizontal,
  ArrowUpRight,
  UserRound,
  UsersRound,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { storefrontUrl } from '../utils/products';
import MonogramLogo from '../assets/logos/Minimalist McLily Monogram Logo (1).svg';

const links = [
  { label: 'Home', to: '/', icon: Home },
  { label: 'Sell', to: '/pos', icon: ShoppingBag },
  { label: 'Add product', to: '/quick-post', icon: Plus },
  { label: 'Products', to: '/products', icon: Package },
  { label: 'Orders', to: '/orders', icon: ShoppingBag },
  { label: 'Customers & credit', to: '/customers', icon: UsersRound },
  { label: 'More', to: '/more', icon: MoreHorizontal },
];
export default function AdminLayout() {
  const { user } = useAuth();
  const location = useLocation();
  return (
    <div className="admin-shell">
      <a href="#main-content" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      <aside className="admin-sidebar">
        <Link className="brand" to="/">
          <img className="brand-mark" src={MonogramLogo} alt="" />
          <div>
            <span className="brand-name">McLily</span>
            <small>Store manager</small>
          </div>
        </Link>
        <nav aria-label="Main navigation">
          {links.map(({ label, to, icon: Icon }) => (
            <NavLink key={to} end={to === '/'} to={to} className="side-link">
              <Icon size={19} strokeWidth={1.7} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="row-title">{user?.fullName || 'Store manager'}</p>
          <p className="row-meta">{user?.email || user?.phone}</p>
          <Link className="side-link mt-3" to="/more">
            <UserRound size={18} />
            Account & appearance
          </Link>
        </div>
      </aside>
      <div className="admin-body">
        <header className="admin-header">
          <Link to="/" className="brand">
            <img className="brand-mark" src={MonogramLogo} alt="" />
            <span className="brand-name">McLily</span>
          </Link>
          <a
            className="btn btn-quiet"
            href={storefrontUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View store
            <ArrowUpRight size={17} />
          </a>
        </header>
        <main id="main-content" className="admin-main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      <nav className="mobile-tabs" aria-label="Mobile navigation">
        {[links[0], links[1], links[3]].map(({ label, to, icon: Icon }) => (
          <NavLink key={to} end={to === '/'} to={to}>
            <Icon size={22} strokeWidth={1.7} />
            {label}
          </NavLink>
        ))}
        <Link
          to="/more"
          aria-current={
            ['/more', '/orders', '/quick-post', '/email', '/reports'].includes(location.pathname) ||
            location.pathname.startsWith('/customers')
              ? 'page'
              : undefined
          }
        >
          <MoreHorizontal size={22} />
          More
        </Link>
      </nav>
    </div>
  );
}
