import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, SlidersHorizontal, ArrowUpRight } from 'lucide-react';
import api from '../api/client';
import useCollection from '../hooks/useCollection';
import useDebouncedValue from '../hooks/useDebouncedValue';
import {
  PageHeading,
  Field,
  Notice,
  Loading,
  Empty,
  Modal,
  Pagination,
  SearchField,
  Status,
} from '../components/AdminUI';
import {
  productPrice,
  stockLabel,
  variantLabel,
  variantsOf,
  storefrontUrl,
} from '../utils/products';
import { formatNaira } from '../utils/conversions';
import StockHistory from '../components/StockHistory';

function EditProduct({ product, onClose, onSaved }) {
  const fabric = product.productType === 'fabric',
    field = fabric ? 'colorVariants' : 'sizes';
  const [price, setPrice] = useState(String(productPrice(product))),
    [active, setActive] = useState(product.isActive);
  const [stocks, setStocks] = useState(
    variantsOf(product).map((v) =>
      String(fabric ? v.rollStockHalfYards / 2 : v.stock)
    )
  );
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deliveryRequiresQuote, setDeliveryRequiresQuote] = useState(
    Boolean(product.deliveryRequiresQuote)
  );
  const variants = variantsOf(product),
    held = variants.some(
      (v) => (v.reservedStock || v.reservedHalfYards || 0) > 0
    );
  const stockChanged = variants.some(
    (v, index) =>
      Number(stocks[index]) !== (fabric ? v.rollStockHalfYards / 2 : v.stock)
  );
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    if (
      stocks.some(
        (value) =>
          value === '' ||
          Number(value) < 0 ||
          !Number.isSafeInteger(Number(value) * (fabric ? 2 : 1))
      )
    ) {
      setError('Enter valid stock for each size or colour.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = {
        price: Number(price),
        isActive: active,
        deliveryRequiresQuote,
        ...(fabric ? { pricePerYard: Number(price) } : {}),
        ...(stockChanged
          ? {
              expectedUpdatedAt: product.updatedAt,
              stockReason: reason,
              [field]: variants.map((variant, index) => ({
                ...variant,
                ...(fabric
                  ? { rollStockHalfYards: Number(stocks[index]) * 2 }
                  : { stock: Number(stocks[index]) }),
              })),
            }
          : {}),
      };
      const res = await api.put('/products/' + product._id, payload);
      if (!res.data?.success) throw new Error('The change was not saved.');
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Edit product" busy={busy} onClose={onClose}>
      <form className="form-stack" onSubmit={save}>
        <div>
          <h3>{product.name}</h3>
          <p className="row-meta">{product.category}</p>
        </div>
        <Field label={fabric ? 'Price per yard (₦)' : 'Price (₦)'}>
          <input
            className="control"
            type="number"
            min=".01"
            step=".01"
            required
            value={price}
            disabled={busy}
            onChange={(e) => setPrice(e.target.value)}
          />
        </Field>
        <div>
          <div className="section-head">
            <h3>Stock on hand</h3>
            <small className="muted">{fabric ? 'Yards' : 'Pieces'}</small>
          </div>
          {held && (
            <Notice tone="warning">
              A checkout is holding some stock. You can update the price now;
              stock editing is available after the hold ends.
            </Notice>
          )}
          <div className="form-stack mt-3">
            {variants.map((variant, index) => (
              <Field
                key={variant._id}
                label={variantLabel(variant, fabric)}
                hint={
                  (variant.reservedStock || variant.reservedHalfYards || 0) > 0
                    ? `${fabric ? variant.reservedHalfYards / 2 : variant.reservedStock} held for checkout`
                    : undefined
                }
              >
                <input
                  className="control"
                  type="number"
                  min="0"
                  step={fabric ? '.5' : '1'}
                  required
                  value={stocks[index]}
                  disabled={busy || held}
                  onChange={(e) =>
                    setStocks((previous) =>
                      previous.map((value, i) =>
                        i === index ? e.target.value : value
                      )
                    )
                  }
                />
              </Field>
            ))}
          </div>
        </div>
        {stockChanged && (
          <Field
            label="Reason for stock change"
            hint="This will be kept with the stock history."
          >
            <input
              className="control"
              required
              minLength={3}
              maxLength={500}
              placeholder="e.g. New stock received"
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <label className="check-row">
          <input
            type="checkbox"
            checked={deliveryRequiresQuote}
            onChange={(e) => setDeliveryRequiresQuote(e.target.checked)}
          />
          Delivery quote required for this item.
        </label>
        <details
          className="disclosure"
          onToggle={(event) => setHistoryOpen(event.currentTarget.open)}
        >
          <summary>Stock history</summary>
          {historyOpen && <StockHistory productId={product._id} />}
        </details>
        <details className="disclosure">
          <summary>Store visibility</summary>
          <label className="check-row">
            <input
              type="checkbox"
              checked={active}
              disabled={busy}
              onChange={(e) => setActive(e.target.checked)}
            />
            Visible in the store
          </label>
          <p className="row-meta">
            Hidden products stay in your records and can be shown again.
          </p>
        </details>
        {error && <Notice>{error}</Notice>}
        <button className="btn btn-primary btn-wide" disabled={busy}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
      </form>
    </Modal>
  );
}
export default function InventoryPage() {
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [visibility, setVisibility] = useState('all'),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState(null),
    [saved, setSaved] = useState(false);
  const term = useDebouncedValue(search);
  const query = new URLSearchParams({
    page: String(page),
    limit: '20',
    ...(term ? { search: term } : {}),
    ...(filter === 'low'
      ? { lowStock: 'true' }
      : filter !== 'all'
        ? { productType: filter }
        : {}),
    ...(visibility !== 'all' ? { visibility } : {}),
  });
  const products = useCollection('/products/manage?' + query);
  return (
    <div className="page-stack">
      <PageHeading
        title="Products"
        description={
          products.loading
            ? 'Your retail items and fabrics.'
            : products.error
              ? 'Your product catalog.'
              : `${products.total} products in your records.`
        }
      >
        <Link className="btn btn-primary" to="/quick-post">
          <Plus size={19} />
          <span className="hidden sm:inline">Add product</span>
          <span className="sm:hidden">Add</span>
        </Link>
      </PageHeading>
      <SearchField
        value={search}
        placeholder="Search products or fabrics…"
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <div className="flex justify-between items-center gap-3 flex-wrap">
        <div className="filters" aria-label="Product filters">
          {[
            ['all', 'All'],
            ['retail', 'Retail'],
            ['fabric', 'Fabrics'],
            ['low', 'Low stock'],
          ].map(([value, label]) => (
            <button
              className="filter"
              key={value}
              aria-pressed={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="inline-actions text-sm muted">
          <SlidersHorizontal size={16} />
          <span className="sr-only">Product visibility</span>
          <select
            className="control !min-h-11 !py-2 !w-auto"
            aria-label="Product visibility"
            value={visibility}
            onChange={(e) => {
              setVisibility(e.target.value);
              setPage(1);
            }}
          >
            <option value="all">All visibility</option>
            <option value="active">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      </div>
      {saved && (
        <p role="status" className="text-sm text-[var(--accent)]">
          Changes saved.
        </p>
      )}
      {products.error && (
        <Notice>
          {products.error}
          <button className="underline block mt-2" onClick={products.refresh}>
            Try again
          </button>
        </Notice>
      )}
      {products.loading ? (
        <Loading text="Loading products…" />
      ) : products.error ? null : products.rows.length === 0 ? (
        <Empty title="No products here yet.">
          Add a product or try a different search.
        </Empty>
      ) : (
        <section className="panel product-list" aria-label="Product list">
          {products.rows.map((product) => (
            <div
              className="list-row flex-wrap sm:flex-nowrap"
              key={product._id}
            >
              {product.images?.[0] && (
                <img className="product-thumb" src={product.images[0]} alt="" />
              )}
              <div className="row-info">
                <span className="row-title">{product.name}</span>
                <p className="row-meta hidden sm:block">
                  {product.category} · {stockLabel(product)}
                </p>
                <p className="row-meta sm:hidden">
                  <span className="font-medium text-[var(--text-primary)]">
                    {formatNaira(productPrice(product))}
                    {product.productType === 'fabric' ? ' / yd' : ''}
                  </span>
                  {' · '}
                  {stockLabel(product)}
                </p>
                {!product.isActive && (
                  <div className="mt-1">
                    <Status>Hidden</Status>
                  </div>
                )}
              </div>
              <div className="product-price hidden sm:block">
                <span className="amount">
                  {formatNaira(productPrice(product))}
                </span>
                {product.productType === 'fabric' && (
                  <p className="row-meta">per yard</p>
                )}
              </div>
              <button
                className="btn"
                aria-label={`Edit ${product.name}`}
                onClick={() => {
                  setEditing(product);
                  setSaved(false);
                }}
              >
                Edit
              </button>
            </div>
          ))}
        </section>
      )}
      <Pagination
        page={page}
        pages={products.pages}
        onChange={setPage}
        loading={products.loading}
      />
      {editing && (
        <EditProduct
          key={editing._id}
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setSaved(true);
            products.refresh();
          }}
        />
      )}
      <a
        className="btn btn-quiet w-fit"
        href={storefrontUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        View storefront
        <ArrowUpRight size={17} />
      </a>
    </div>
  );
}
