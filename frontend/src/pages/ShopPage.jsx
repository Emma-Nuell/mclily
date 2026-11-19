import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Filter,
  SlidersHorizontal,
  X,
  Loader2,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/catalog';
import ProductCard from '../components/ProductCard';

const categories = [
  'All',
  'Clothing',
  'Shoes',
  'Bags',
  'Appliances',
  'Electronics',
  'Accessories',
  'Beauty',
];
const filterKeys = ['minPrice', 'maxPrice', 'inStock', 'onSale'];
const sorts = ['newest', 'price_low', 'price_high', 'rating'];
function filterDraft(params) {
  return {
    minPrice: params.get('minPrice') || '',
    maxPrice: params.get('maxPrice') || '',
    inStock: params.get('inStock') === 'true',
    onSale: params.get('onSale') === 'true',
  };
}

export default function ShopPage() {
  const [params, setParams] = useSearchParams();
  const selectedCategory = params.get('category') || 'All';
  const sortBy = sorts.includes(params.get('sort'))
    ? params.get('sort')
    : 'newest';
  const requestedPage = Number(params.get('page'));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const query = new URLSearchParams({
    productType: 'retail',
    sort: sortBy,
    page: String(page),
    limit: '24',
  });
  if (selectedCategory !== 'All') query.set('category', selectedCategory);
  for (const key of ['search', ...filterKeys])
    if (params.has(key)) query.set(key, params.get(key));
  const endpoint = '/products?' + query;
  const [response, setResponse] = useState(null);
  const current = response?.endpoint === endpoint;
  const loading = !current,
    error = current && response.error;
  const products = current ? response.products : [];
  const total = current ? response.total : 0,
    pages = current ? response.pages : 1;
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState(() => filterDraft(params)),
    [filterError, setFilterError] = useState('');
  const sheetRef = useRef(null),
    triggerRef = useRef(null);
  const activeCount = filterKeys.filter(
    (key) => params.has(key) && params.get(key) !== 'false'
  ).length;
  useEffect(() => {
    let active = true;
    api
      .get(endpoint)
      .then(({ data }) => {
        if (!data?.success)
          throw new Error('The collection could not be loaded.');
        if (active)
          setResponse({
            endpoint,
            products: data.data,
            total: data.total ?? data.data.length,
            pages: data.pages || 1,
            error: false,
          });
      })
      .catch(() => {
        if (active)
          setResponse({
            endpoint,
            products: [],
            total: 0,
            pages: 1,
            error: true,
          });
      });
    return () => {
      active = false;
    };
  }, [endpoint]);
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() =>
      sheetRef.current?.querySelector('input')?.focus()
    );
    const keydown = (event) => {
      if (event.key === 'Escape') setOpen(false);
      if (event.key !== 'Tab') return;
      const controls = [
        ...sheetRef.current.querySelectorAll('button, input'),
      ].filter((control) => !control.disabled);
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', keydown);
      trigger?.focus();
    };
  }, [open]);
  function change(values, resetPage = true) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values))
      value === '' || value === false
        ? next.delete(key)
        : next.set(key, String(value));
    if (resetPage) next.delete('page');
    setParams(next);
  }
  function apply(event) {
    event.preventDefault();
    const prices = [draft.minPrice, draft.maxPrice].map((value) =>
      value === '' ? null : Number(value)
    );
    if (
      prices.some(
        (value) =>
          value !== null &&
          (!Number.isFinite(value) ||
            value < 0 ||
            value > Number.MAX_SAFE_INTEGER / 100)
      ) ||
      (prices.every((value) => value !== null) && prices[0] > prices[1])
    ) {
      setFilterError(
        'Choose valid prices, with minimum no higher than maximum.'
      );
      return;
    }
    change({
      minPrice: prices[0] === null ? '' : String(prices[0]),
      maxPrice: prices[1] === null ? '' : String(prices[1]),
      inStock: draft.inStock,
      onSale: draft.onSale,
    });
    setOpen(false);
  }
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div>
          <h1 className="text-2xl sm:text-3xl font-editorial text-text-primary">
            {selectedCategory === 'All' ? 'The Shop' : selectedCategory}
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Discover fashion, footwear, electronics and home essentials.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <select
            aria-label="Sort products"
            value={sortBy}
            onChange={(event) => change({ sort: event.target.value })}
            className="text-xs bg-surface border border-border rounded-full px-3.5 min-h-11 text-text-primary max-w-[210px]"
          >
            <option value="newest">Sort: Newest</option>
            <option value="price_low">Sort: Price Low to High</option>
            <option value="price_high">Sort: Price High to Low</option>
            <option value="rating">Sort: Top Rated</option>
          </select>
          <button
            ref={triggerRef}
            onClick={() => {
              setDraft(filterDraft(params));
              setFilterError('');
              setOpen(true);
            }}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="px-4 min-h-11 rounded-full border border-border bg-surface text-text-primary flex items-center gap-1.5 text-xs font-semibold pressable"
          >
            <SlidersHorizontal size={15} />
            <span>Filter{activeCount ? ` (${activeCount})` : ''}</span>
          </button>
        </div>
      </div>
      <div
        className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1"
        role="group"
        aria-label="Product categories"
      >
        {categories.map((category) => (
          <button
            key={category}
            aria-pressed={selectedCategory === category}
            onClick={() =>
              change({ category: category === 'All' ? '' : category })
            }
            className={`px-4 min-h-11 rounded-full text-xs font-medium pressable whitespace-nowrap ${selectedCategory === category ? 'bg-control-primary text-control-primary-text' : 'bg-surface border border-border text-text-secondary'}`}
          >
            {category}
          </button>
        ))}
      </div>
      <div
        className="flex justify-between gap-4 text-xs text-text-secondary"
        aria-live="polite"
      >
        <p>
          {loading
            ? 'Loading products…'
            : error
              ? 'Products could not load.'
              : `${total} ${total === 1 ? 'product' : 'products'}`}
        </p>
        {activeCount > 0 && (
          <button
            className="underline underline-offset-4"
            onClick={() =>
              change(Object.fromEntries(filterKeys.map((key) => [key, ''])))
            }
          >
            Clear filters
          </button>
        )}
      </div>
      {loading ? (
        <div
          className="py-24 flex justify-center"
          role="status"
          aria-label="Loading products"
        >
          <Loader2 className="w-8 h-8 text-text-tertiary animate-spin" />
        </div>
      ) : products.length ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-6">
          {products.map((product) => (
            <ProductCard key={product._id} product={product} />
          ))}
        </div>
      ) : (
        <div className="py-20 text-center space-y-3">
          <Filter className="w-7 h-7 mx-auto text-text-tertiary" />
          <h2 className="font-semibold">
            {error ? 'The collection is unavailable' : 'No products found'}
          </h2>
          <p className="text-sm text-text-secondary">
            {error
              ? 'Please try again in a moment.'
              : 'Try a wider price range or change the selected filters.'}
          </p>
        </div>
      )}
      {!loading && pages > 1 && (
        <nav
          className="flex justify-center items-center gap-5 pb-4"
          aria-label="Catalog pages"
        >
          <button
            className="pressable min-h-11 p-2 disabled:opacity-40"
            aria-label="Previous catalog page"
            disabled={page <= 1}
            onClick={() => change({ page: page - 1 }, false)}
          >
            <ArrowLeft size={18} />
          </button>
          <span className="text-sm">
            Page {page} of {pages}
          </span>
          <button
            className="pressable min-h-11 p-2 disabled:opacity-40"
            aria-label="Next catalog page"
            disabled={page >= pages}
            onClick={() => change({ page: page + 1 }, false)}
          >
            <ArrowRight size={18} />
          </button>
        </nav>
      )}
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 flex items-end justify-center">
            <motion.div
              aria-hidden="true"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            />
            <motion.section
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="shop-filter-title"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="shop-filter-sheet relative w-full max-w-lg bg-surface rounded-t-3xl p-6 z-10 border-t border-border max-h-[85dvh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-4 border-b border-border mb-6">
                <h2 id="shop-filter-title" className="font-semibold">
                  Refine your search
                </h2>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close filters"
                  className="min-h-11 min-w-11 grid place-items-center text-text-secondary"
                >
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={apply} className="space-y-6">
                <fieldset>
                  <legend className="text-sm font-semibold mb-3">
                    Price range
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['minPrice', 'Minimum price (₦)', 'No minimum'],
                      ['maxPrice', 'Maximum price (₦)', 'No maximum'],
                    ].map(([key, label, placeholder]) => (
                      <label
                        className="text-xs text-text-secondary space-y-2"
                        key={key}
                      >
                        <span className="block">{label}</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={draft[key]}
                          placeholder={placeholder}
                          onChange={(event) =>
                            setDraft({ ...draft, [key]: event.target.value })
                          }
                          className="block w-full min-w-0 min-h-11 px-3 rounded-xl border border-border bg-surface-secondary text-text-primary"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="flex gap-3 items-start min-h-11">
                  <input
                    type="checkbox"
                    checked={draft.inStock}
                    onChange={(event) =>
                      setDraft({ ...draft, inStock: event.target.checked })
                    }
                    className="mt-1 accent-[var(--control-primary)] w-4 h-4"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      Available to order
                    </span>
                    <span className="block text-xs text-text-secondary mt-1">
                      Only show items with stock available.
                    </span>
                  </span>
                </label>
                <label className="flex gap-3 items-start min-h-11">
                  <input
                    type="checkbox"
                    checked={draft.onSale}
                    onChange={(event) =>
                      setDraft({ ...draft, onSale: event.target.checked })
                    }
                    className="mt-1 accent-[var(--control-primary)] w-4 h-4"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      Discounted items
                    </span>
                    <span className="block text-xs text-text-secondary mt-1">
                      Products with a lower current price.
                    </span>
                  </span>
                </label>
                {filterError && (
                  <p role="alert" className="text-sm text-danger">
                    {filterError}
                  </p>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="min-h-11 px-5 rounded-full border border-border text-sm"
                    onClick={() => {
                      setDraft({
                        minPrice: '',
                        maxPrice: '',
                        inStock: false,
                        onSale: false,
                      });
                      setFilterError('');
                    }}
                  >
                    Reset
                  </button>
                  <button
                    type="submit"
                    className="min-h-11 flex-1 rounded-full bg-control-primary text-control-primary-text text-sm font-semibold pressable"
                  >
                    Apply filters
                  </button>
                </div>
              </form>
            </motion.section>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
