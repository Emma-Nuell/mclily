import { useEffect, useState, useSyncExternalStore } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Search, ShoppingBag, Sun, Moon, UserRound } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useTheme } from '../context/ThemeContext';
import { IS_PREVIEW_CATALOG } from '../api/catalog';
import SearchModal from './SearchModal';
import { getPwaSnapshot, subscribePwa } from '../pwa/client';

export default function Navbar() {
  const { totalItemsCount, openBag } = useCart();
  const { activeTheme, toggleTheme } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const status = useSyncExternalStore(subscribePwa, getPwaSnapshot);
  const noticeVisible = !status.online || !status.apiReachable || status.catalogSavedAt || status.updateReady || status.storageFailed;
  const overlay = location.pathname === '/' && !scrolled && !noticeVisible;
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 40);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, [location.pathname]);
  return <>
    <div className="announcement">{IS_PREVIEW_CATALOG ? 'Preview collection · sample products' : 'Style. Quality. Convenience.'}</div>
    <header className={`site-header ${overlay ? 'site-header-overlay' : ''}`}>
      <div className="header-inner">
        <Link to="/" className="brand-wordmark pressable" aria-label="McLily home">McLily<span className="brand-dot">.</span></Link>
        <nav className="desktop-navigation" aria-label="Main navigation">
          {[['Home','/'],['Shop','/shop'],['Categories','/categories'],['Fabrics','/fabrics'],['Tailoring','/tailoring']].map(([label,path]) => <Link key={path} to={path} aria-current={location.pathname === path ? 'page' : undefined}>{label}</Link>)}
        </nav>
        <div className="header-actions">
          <button className="header-search pressable" onClick={() => setSearchOpen(true)} aria-label="Search products"><Search size={19} strokeWidth={1.6} /><span>Search McLily</span></button>
          <button className="header-icon pressable" onClick={toggleTheme} aria-label="Toggle theme">{activeTheme === 'dark' ? <Sun size={19} strokeWidth={1.6} /> : <Moon size={19} strokeWidth={1.6} />}</button>
          <Link className="header-icon header-account pressable" to="/account" aria-label="Account"><UserRound size={19} strokeWidth={1.6} /></Link>
          <button className="header-icon pressable" onClick={openBag} aria-label="Shopping Bag"><ShoppingBag size={19} strokeWidth={1.6} />{totalItemsCount > 0 && <span className="nav-count">{totalItemsCount}</span>}</button>
        </div>
      </div>
    </header>
    <SearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
  </>;
}
