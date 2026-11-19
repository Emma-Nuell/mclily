import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, X, ArrowRight, Loader2, Clock } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api/catalog';

const SearchModal = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => {
    try {
      const saved = localStorage.getItem('mcl_recent_searches');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const popularSearches = ['Sneakers', 'T-shirts', 'Laptops', 'Bags', 'Watches', 'Perfume', 'Linen', 'Air Fryer'];
  const inputRef = useRef(null);
  const dialogRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!isOpen) { setQuery(''); setResults([]); return; }
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const controls = dialogRef.current?.querySelectorAll('input, button, a[href]');
      if (!controls?.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); document.body.style.overflow = overflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(false);
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get(`/products?search=${encodeURIComponent(query)}&limit=8`);
        if (active && res.data?.success) {
          setResults(res.data.data);
        }
      } catch (err) {
        if (active) { setResults([]); setError(true); }
      } finally {
        if (active) setLoading(false);
      }
    }, 200);

    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  const saveRecentSearch = (term) => {
    if (!term || !term.trim()) return;
    const clean = term.trim();
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s.toLowerCase() !== clean.toLowerCase());
      const updated = [clean, ...filtered].slice(0, 8);
      try {
        localStorage.setItem('mcl_recent_searches', JSON.stringify(updated));
      } catch (e) {
        console.warn(e);
      }
      return updated;
    });
  };

  const removeRecentSearch = (e, term) => {
    e.stopPropagation();
    setRecentSearches((prev) => {
      const updated = prev.filter((s) => s !== term);
      try {
        localStorage.setItem('mcl_recent_searches', JSON.stringify(updated));
      } catch (err) {
        console.warn(err);
      }
      return updated;
    });
  };

  const handleSelectProduct = (product) => {
    saveRecentSearch(product.name);
    onClose();
    if (product.productType === 'fabric') {
      navigate(`/fabrics/${product.slug}`);
    } else {
      navigate(`/product/${product.slug}`);
    }
  };

  const handleQuickSearch = (term) => {
    setQuery(term);
    saveRecentSearch(term);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 sm:pt-16 px-4">
          {/* Backdrop Dim Scrim */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
          />

          {/* Modal Card */}
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Search McLily"
            initial={{ opacity: 0, scale: 0.97, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 340 }}
            className="relative w-full max-w-xl bg-surface border border-border rounded-3xl shadow-2xl overflow-hidden z-10 max-h-[85vh] flex flex-col"
          >
            {/* Input Bar */}
            <div className="p-4 sm:p-5 border-b border-border flex items-center gap-3">
              <Search className="w-5 h-5 text-text-tertiary flex-shrink-0" />
              <input
                ref={inputRef}
                aria-label="Search products, brands and more"
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search products, brands and more..."
                className="w-full bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-hidden text-sm sm:text-base"
              />
              {loading && <Loader2 className="w-4 h-4 text-text-tertiary animate-spin flex-shrink-0" />}
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="p-1 rounded-full hover:bg-surface-secondary text-text-tertiary hover:text-text-primary"
                  aria-label="Clear query"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={onClose}
                className="text-xs font-semibold text-text-secondary hover:text-text-primary px-2 py-1 rounded-lg hover:bg-surface-secondary transition-colors"
              >
                Cancel
              </button>
            </div>

            {/* Content Area */}
            <div className="overflow-y-auto p-4 sm:p-6 no-scrollbar flex-1 divide-y divide-border">
              {results.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-3">
                    Matching Products
                  </p>
                  {results.map((product) => (
                    <button
                      type="button"
                      key={product._id}
                      onClick={() => handleSelectProduct(product)}
                      className="w-full text-left py-2.5 px-3 flex items-center justify-between rounded-2xl hover:bg-surface-secondary cursor-pointer transition-colors pressable"
                    >
                      <div className="flex items-center gap-3">
                        <img
                          src={product.images?.[0] || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=200&q=80'}
                          alt={product.name}
                          className="w-12 h-14 object-cover rounded-xl bg-surface-secondary flex-shrink-0"
                        />
                        <div>
                          <h4 className="text-sm font-semibold text-text-primary line-clamp-1">
                            {product.name}
                          </h4>
                          <div className="flex items-center gap-2 mt-0.5 text-xs text-text-secondary">
                            <span>{product.category}</span>
                            {product.productType === 'fabric' && (
                              <span className="text-[11px] text-accent font-medium">by the yard</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-right">
                        <span className="text-sm font-bold text-text-primary">
                          ₦{(product.price || product.pricePerYard).toLocaleString()}
                        </span>
                        <ArrowRight className="w-4 h-4 text-text-tertiary" />
                      </div>
                    </button>
                  ))}
                </div>
              ) : query.trim() && !loading ? (
                <div className="py-12 text-center text-text-tertiary">
                  <p className="text-sm">{error ? 'Search is unavailable right now.' : `No products found for “${query}”`}</p>
                  <p className="text-xs mt-1">Try another keyword like "shoes", "hoodie", or "linen"</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Recent Searches */}
                  {recentSearches.length > 0 && (
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-3">
                        Recent Searches
                      </h4>
                      <div className="space-y-1">
                        {recentSearches.map((term) => (
                          <div
                            key={term}
                            className="flex items-center justify-between py-2 px-3 rounded-xl hover:bg-surface-secondary cursor-pointer text-xs sm:text-sm text-text-secondary hover:text-text-primary transition-colors"
                          >
                            <button onClick={() => handleQuickSearch(term)} className="flex-1 flex items-center gap-2.5 text-left py-1">
                              <Clock className="w-3.5 h-3.5 text-text-tertiary" />
                              <span>{term}</span>
                            </button>
                            <button
                              aria-label={`Remove ${term} from recent searches`}
                              onClick={(e) => removeRecentSearch(e, term)}
                              className="p-1 text-text-tertiary hover:text-text-primary rounded-full hover:bg-surface"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Search ideas */}
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-text-tertiary mb-3">
                      Search ideas
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {popularSearches.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => handleQuickSearch(tag)}
                          className="px-3.5 py-1.5 rounded-full bg-surface-secondary hover:bg-surface-elevated border border-border text-xs font-medium text-text-secondary hover:text-text-primary transition-colors pressable"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export default SearchModal;
