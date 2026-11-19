import { createRequestId } from '../../vendor/requestId.mjs';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  Minus,
  Plus,
  ReceiptText,
  Trash2,
  ArrowRight,
} from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import useCollection from '../hooks/useCollection';
import useDebouncedValue from '../hooks/useDebouncedValue';
import useApiData from '../hooks/useApiData';
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
  available,
  productPrice,
  variantLabel,
  variantsOf,
} from '../utils/products';
import { formatNaira } from '../utils/conversions';

function readPending(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}
const round = (value) => Math.round(value * 100) / 100;

function ChooseProduct({ product, onClose, onAdd }) {
  const fabric = product.productType === 'fabric',
    variants = variantsOf(product);
  const [variantId, setVariantId] = useState(
    variants.length === 1 ? variants[0]._id : ''
  );
  const [quantity, setQuantity] = useState(
    fabric && available(variants[0] || {}, true) < 1 ? 0.5 : 1
  );
  const variant = variants.find((v) => v._id === variantId);
  const max = variant ? available(variant, fabric) : 0;
  const price = fabric
    ? product.pricePerYard
    : (variant?.priceOverride ?? product.price);
  return (
    <Modal title="Choose your item" onClose={onClose}>
      <div>
        <h3>{product.name}</h3>
        <p className="row-meta">
          {formatNaira(price)}
          {fabric ? ' / yd' : ''}
        </p>
      </div>
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (variant && Number(quantity) > 0 && Number(quantity) <= max)
            onAdd(product, variant, Number(quantity));
        }}
      >
        <Field label={fabric ? 'Colour or pattern' : 'Size / colour'}>
          <select
            className="control"
            required
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
          >
            <option value="">Choose an option</option>
            {variants.map((v) => (
              <option
                key={v._id}
                value={v._id}
                disabled={available(v, fabric) <= 0}
              >
                {variantLabel(v, fabric)} — {available(v, fabric)}{' '}
                {fabric ? 'yd' : 'pieces'} available
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={fabric ? 'Yards' : 'Quantity'}
          hint={
            variant
              ? `${max} ${fabric ? 'yards' : 'pieces'} available`
              : 'Choose an option first'
          }
        >
          <input
            className="control"
            type="number"
            inputMode={fabric ? 'decimal' : 'numeric'}
            min={fabric ? '.5' : '1'}
            step={fabric ? '.5' : '1'}
            max={max || undefined}
            required
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </Field>
        <button
          className="btn btn-primary btn-wide"
          disabled={!variant || Number(quantity) <= 0 || Number(quantity) > max}
        >
          Add to sale · {formatNaira(price * (Number(quantity) || 0))}
        </button>
      </form>
    </Modal>
  );
}

export default function PosPage() {
  const { user } = useAuth();
  const storageKey = `mcl_pos_pending_${user._id}`;
  const [params, setParams] = useSearchParams();
  const history = params.get('view') === 'history';
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [historyPage, setHistoryPage] = useState(1);
  const term = useDebouncedValue(search);
  const catalog = useCollection(
    '/products?' +
      new URLSearchParams({
        limit: '12',
        page: String(page),
        ...(term ? { search: term } : {}),
      })
  );
  const sales = useCollection('/pos/sales?limit=15&page=' + historyPage);
  const [cart, setCart] = useState([]),
    [selection, setSelection] = useState(null),
    [review, setReview] = useState(false);
  const [paymentType, setPaymentType] = useState(
      params.get('customer') ? 'credit_installment' : 'full'
    ),
    [customerName, setCustomerName] = useState(''),
    [phone, setPhone] = useState(''),
    [deposit, setDeposit] = useState(''),
    [zeroApproved, setZeroApproved] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [method, setMethod] = useState('cash'),
    [paymentSale, setPaymentSale] = useState(null),
    [paymentAmount, setPaymentAmount] = useState('');
  const selectedCustomerId = params.get('customer');
  const selectedCustomer = useApiData(
    selectedCustomerId ? '/customers/' + selectedCustomerId : null
  );
  const phoneTerm = useDebouncedValue(phone);
  const phoneLookup = useApiData(
    review && paymentType === 'credit_installment' && phoneTerm.trim()
      ? '/customers/lookup?phone=' + encodeURIComponent(phoneTerm.trim())
      : null
  );
  const existingCustomer = phoneLookup.data?.account;
  const lookupPending = phone !== phoneTerm || phoneLookup.loading;
  const lookupBlocked =
    paymentType === 'credit_installment' &&
    (lookupPending || Boolean(phoneLookup.error));
  const [pending, setPending] = useState(() => readPending(storageKey)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState(null);
  const lock = useRef(false),
    receipt = useRef(null);
  const total = round(
    cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
  );
  const blocked = Boolean(pending) || busy;
  function add(product, variant, quantity = 1) {
    const fabric = product.productType === 'fabric',
      key = product._id + ':' + variant._id;
    const max = available(variant, fabric);
    const existing = cart.find((item) => item.key === key);
    if ((existing?.quantity || 0) + quantity > max) {
      setError('That is more than the available stock.');
      return;
    }
    setCart((previous) =>
      existing
        ? previous.map((item) =>
            item.key === key
              ? { ...item, quantity: item.quantity + quantity }
              : item
          )
        : [
            ...previous,
            {
              key,
              productId: product._id,
              name: product.name,
              productType: product.productType,
              variantId: variant._id,
              label: variantLabel(variant, fabric),
              unitPrice: fabric
                ? product.pricePerYard
                : (variant.priceOverride ?? product.price),
              quantity,
              max,
            },
          ]
    );
    setSelection(null);
    setSuccess(null);
    setError('');
  }
  function changeQuantity(key, delta) {
    setCart((previous) =>
      previous.map((item) =>
        item.key === key
          ? {
              ...item,
              quantity: Math.min(
                item.max,
                Math.max(
                  item.productType === 'fabric' ? 0.5 : 1,
                  round(item.quantity + delta)
                )
              ),
            }
          : item
      )
    );
  }
  async function perform(operation) {
    if (lock.current) return;
    if (!navigator.onLine) {
      setError(
        'You are offline. Connect to the internet to record this sale or payment.'
      );
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(operation));
    } catch {
      setError(
        'Your browser could not keep this sale for a safe retry. Please contact the administrator before continuing.'
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setPending(operation);
    setError('');
    try {
      const res = await api.post(operation.endpoint, operation.payload);
      if (!res.data?.success)
        throw new Error('The server did not confirm this transaction.');
      sessionStorage.removeItem(storageKey);
      setPending(null);
      setSuccess({ sale: res.data.data, kind: operation.kind });
      if (operation.kind === 'sale') {
        setCart([]);
        setReview(false);
        setCustomerName('');
        setPhone('');
        setDeposit('');
        setZeroApproved(false);
        setPaymentType('full');
      } else {
        setPaymentSale(null);
        setPaymentAmount('');
      }
      catalog.refresh();
      sales.refresh();
    } catch (err) {
      const definitive =
        err.response?.status >= 400 &&
        err.response?.status < 500 &&
        ![401, 408, 429].includes(err.response.status) &&
        err.response?.data?.code !== 'IDEMPOTENCY_CONFLICT';
      if (definitive) {
        sessionStorage.removeItem(storageKey);
        setPending(null);
      }
      setError(
        err.response?.data?.message ||
          'We could not confirm this transaction. Check the saved transaction before trying a new one.'
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function recordSale(event) {
    event.preventDefault();
    if (blocked || !cart.length) return;
    if (
      paymentType === 'credit_installment' &&
      (!(existingCustomer?.fullName || customerName).trim() ||
        lookupBlocked ||
        !phone.trim() ||
        deposit === '' ||
        Number(deposit) < 0 ||
        Number(deposit) > total ||
        (Number(deposit) === 0 && !zeroApproved))
    ) {
      setError(
        'Enter the customer, the amount received, and approve a zero deposit if needed.'
      );
      return;
    }
    perform({
      kind: 'sale',
      endpoint: '/pos/sale',
      payload: {
        customerName:
          (paymentType === 'credit_installment'
            ? existingCustomer?.fullName
            : null) ||
          customerName.trim() ||
          'Walk-in customer',
        customerPhone: phone.trim() || undefined,
        customerAccountId:
          paymentType === 'credit_installment'
            ? existingCustomer?._id
            : undefined,
        paymentType,
        paymentMethod: method,
        amountPaid: paymentType === 'full' ? total : Number(deposit),
        idempotencyKey: createRequestId(),
        items: cart.map((item) => ({
          productId: item.productId,
          ...(item.productType === 'fabric'
            ? { fabricVariantId: item.variantId, yards: item.quantity }
            : { retailVariantId: item.variantId, quantity: item.quantity }),
        })),
      },
    });
  }
  function recordPayment(event) {
    event.preventDefault();
    if (blocked) return;
    const amount = Number(paymentAmount);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > paymentSale.balanceDue
    ) {
      setError('Enter an amount within the remaining balance.');
      return;
    }
    perform({
      kind: 'payment',
      endpoint: `/pos/sales/${paymentSale._id}/installment`,
      payload: { amount, paymentMethod, idempotencyKey: createRequestId() },
    });
  }
  const errors = error || (history ? sales.error : catalog.error);
  return (
    <div className="page-stack sale-page">
      <PageHeading
        title={history ? 'Sales & payments' : 'Sell'}
        description={
          history
            ? 'Receipts and outstanding in-store balances.'
            : 'Choose your items, then confirm the payment.'
        }
      />
      <div className="segmented max-w-sm" aria-label="Sales view">
        <button aria-pressed={!history} onClick={() => setParams({})}>
          New sale
        </button>
        <button
          aria-pressed={history}
          onClick={() => setParams({ view: 'history' })}
        >
          Sales history
        </button>
      </div>
      {pending && (
        <Notice tone="warning">
          <p>
            A saved transaction is awaiting confirmation. Check it before
            starting another.
          </p>
          <button
            className="btn mt-3"
            disabled={busy}
            onClick={() => perform(pending)}
          >
            {busy ? 'Checking…' : 'Check saved transaction'}
          </button>
        </Notice>
      )}
      {errors && (
        <Notice>
          {errors}
          {!error && (
            <button
              className="underline block mt-2"
              onClick={history ? sales.refresh : catalog.refresh}
            >
              Try again
            </button>
          )}
        </Notice>
      )}
      {success && (
        <div className="notice" role="status">
          <Check size={22} />
          <div>
            <strong>
              {success.kind === 'sale' ? 'Sale recorded.' : 'Payment recorded.'}
            </strong>
            <p className="mt-1 text-sm">
              {success.sale.receiptNumber} ·{' '}
              {formatNaira(success.sale.totalAmount)}
              {success.sale.balanceDue > 0
                ? ` · ${formatNaira(success.sale.balanceDue)} still owed`
                : success.sale.amountPaid < success.sale.totalAmount
                  ? ' · Balance cleared'
                  : ' · Paid in full'}
            </p>
          </div>
        </div>
      )}
      {history ? (
        <>
          {sales.loading ? (
            <Loading text="Loading sales…" />
          ) : sales.error ? null : sales.rows.length === 0 ? (
            <Empty title="No sales recorded yet.">
              Your in-store receipts will appear here.
            </Empty>
          ) : (
            <section className="panel panel-pad">
              {sales.rows.map((sale) => (
                <div className="list-row flex-wrap" key={sale._id}>
                  <div className="row-info">
                    <span className="row-title">
                      {sale.customerName || 'Walk-in customer'}
                    </span>
                    <p className="row-meta">
                      {sale.receiptNumber} ·{' '}
                      {new Date(sale.createdAt).toLocaleDateString('en-NG')}
                    </p>
                    <p className="row-meta">
                      {sale.items
                        ?.map(
                          (item) =>
                            `${item.productType === 'fabric' ? item.halfYards / 2 + ' yd' : item.quantity + ' ×'} ${item.name}`
                        )
                        .join(', ')}
                    </p>
                    <div className="mt-2">
                      <Status
                        tone={sale.balanceDue > 0 ? 'warning' : 'success'}
                      >
                        {sale.balanceDue > 0
                          ? `${formatNaira(sale.balanceDue)} owed`
                          : sale.amountPaid < sale.totalAmount
                            ? 'Balance cleared'
                            : 'Paid in full'}
                      </Status>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="amount">
                      {formatNaira(sale.totalAmount)}
                    </span>
                    <p className="row-meta">
                      Received {formatNaira(sale.amountPaid)}
                    </p>
                    {sale.amountForgiven > 0 && (
                      <p className="row-meta">
                        Forgiven {formatNaira(sale.amountForgiven)}
                      </p>
                    )}
                    {sale.amountAdjusted > 0 && (
                      <p className="row-meta">
                        Corrected {formatNaira(sale.amountAdjusted)}
                      </p>
                    )}
                    {sale.balanceDue > 0 && (
                      <button
                        className="btn mt-3"
                        disabled={blocked}
                        onClick={() => {
                          setPaymentSale(sale);
                          setPaymentAmount('');
                          setPaymentMethod('cash');
                          setError('');
                        }}
                      >
                        Record payment
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </section>
          )}
          <Pagination
            page={historyPage}
            pages={sales.pages}
            onChange={setHistoryPage}
            loading={sales.loading}
          />
        </>
      ) : (
        <div className="sale-layout">
          <section className="sale-catalog page-stack">
            <SearchField
              value={search}
              placeholder="Find a product…"
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
            <div>
              {catalog.loading ? (
                <Loading text="Finding products…" />
              ) : catalog.error ? null : catalog.rows.length === 0 ? (
                <Empty title="No products found.">
                  Try a different name or add a product to your store.
                </Empty>
              ) : (
                catalog.rows.map((product) => {
                  const fabric = product.productType === 'fabric',
                    variants = variantsOf(product),
                    inStock = variants.some((v) => available(v, fabric) > 0);
                  return (
                    <div className="list-row" key={product._id}>
                      {product.images?.[0] && (
                        <img
                          src={product.images[0]}
                          alt=""
                          className="product-thumb"
                        />
                      )}
                      <div className="row-info">
                        <span className="row-title">{product.name}</span>
                        <p className="row-meta">
                          {formatNaira(productPrice(product))}
                          {fabric ? ' / yd' : ''}
                          {!inStock ? ' · Out of stock' : ''}
                        </p>
                      </div>
                      <button
                        className="btn btn-icon"
                        disabled={!inStock || blocked}
                        aria-label={`Add ${product.name} to sale`}
                        onClick={() => {
                          if (!fabric && variants.length === 1)
                            add(product, variants[0]);
                          else setSelection(product);
                        }}
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <Pagination
              page={page}
              pages={catalog.pages}
              onChange={setPage}
              loading={catalog.loading}
            />
          </section>
          <section
            className="panel receipt"
            ref={receipt}
            aria-label="Current sale"
          >
            <div className="section-head">
              <h2>Your sale</h2>
              <ReceiptText size={20} className="muted" />
            </div>
            {!cart.length ? (
              <p className="receipt-empty">
                Add items using the + button beside a product.
              </p>
            ) : (
              cart.map((item) => (
                <div className="receipt-line" key={item.key}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="row-info">
                      <span className="row-title">{item.name}</span>
                      <p className="row-meta">
                        {item.label}
                        {item.productType === 'fabric' ? ' · by the yard' : ''}
                      </p>
                    </div>
                    <button
                      className="btn btn-icon btn-quiet"
                      aria-label={`Remove ${item.name} ${item.label}`}
                      disabled={blocked}
                      onClick={() =>
                        setCart((previous) =>
                          previous.filter((row) => row.key !== item.key)
                        )
                      }
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                  <div className="flex justify-between items-center gap-2">
                    <div className="quantity">
                      <button
                        aria-label={`Decrease ${item.name} ${item.label}`}
                        disabled={
                          blocked ||
                          item.quantity <=
                            (item.productType === 'fabric' ? 0.5 : 1)
                        }
                        onClick={() =>
                          changeQuantity(
                            item.key,
                            item.productType === 'fabric' ? -0.5 : -1
                          )
                        }
                      >
                        <Minus size={16} />
                      </button>
                      <span>
                        {item.quantity}
                        {item.productType === 'fabric' ? ' yd' : ''}
                      </span>
                      <button
                        aria-label={`Increase ${item.name} ${item.label}`}
                        disabled={blocked || item.quantity >= item.max}
                        onClick={() =>
                          changeQuantity(
                            item.key,
                            item.productType === 'fabric' ? 0.5 : 1
                          )
                        }
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    <span className="amount">
                      {formatNaira(round(item.unitPrice * item.quantity))}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div className="receipt-total">
              <span>Total</span>
              <strong>{formatNaira(total)}</strong>
            </div>
            <button
              className="btn btn-primary btn-wide"
              disabled={!cart.length || blocked}
              onClick={() => {
                setReview(true);
                setError('');
              }}
            >
              Review sale
              <ArrowRight size={18} />
            </button>
          </section>
        </div>
      )}
      {!history && cart.length > 0 && (
        <div className="sale-dock">
          <div>
            <small>
              {cart.length} {cart.length === 1 ? 'item' : 'items'} in sale
            </small>
            <strong className="amount">{formatNaira(total)}</strong>
          </div>
          <button
            className="btn btn-primary"
            disabled={blocked}
            onClick={() => {
              receipt.current?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 'instant'
                  : 'smooth',
                block: 'start',
              });
              setReview(true);
              setError('');
            }}
          >
            Review sale
            <ArrowRight size={18} />
          </button>
        </div>
      )}
      {selection && (
        <ChooseProduct
          product={selection}
          onClose={() => setSelection(null)}
          onAdd={add}
        />
      )}
      {review && (
        <Modal
          title="Confirm sale"
          onClose={() => setReview(false)}
          busy={busy}
        >
          <form className="form-stack" onSubmit={recordSale}>
            <div className="receipt-total !p-0">
              <span>
                {cart.length} {cart.length === 1 ? 'item' : 'items'}
              </span>
              <strong>{formatNaira(total)}</strong>
            </div>
            <div className="segmented" aria-label="Payment type">
              {[
                ['full', 'Payment received'],
                ['credit_installment', 'Customer owes'],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={paymentType === value}
                  disabled={blocked}
                  onClick={() => setPaymentType(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {paymentType === 'credit_installment' ? (
              <>
                {selectedCustomerId && (
                  <div className="form-stack">
                    {selectedCustomer.loading ? (
                      <p className="row-meta">Loading selected customer…</p>
                    ) : selectedCustomer.error ? (
                      <Notice>{selectedCustomer.error}</Notice>
                    ) : (
                      selectedCustomer.data && (
                        <button
                          type="button"
                          className="btn"
                          disabled={blocked}
                          onClick={() => {
                            setPhone(selectedCustomer.data.phone);
                            setCustomerName(selectedCustomer.data.fullName);
                          }}
                        >
                          Use {selectedCustomer.data.fullName}
                        </button>
                      )
                    )}
                  </div>
                )}
                <Field label="Customer name">
                  <input
                    className="control"
                    required
                    value={existingCustomer?.fullName || customerName}
                    disabled={blocked || Boolean(existingCustomer)}
                    onChange={(e) => setCustomerName(e.target.value)}
                  />
                </Field>
                {lookupPending && phone.trim() && (
                  <p className="row-meta" role="status">
                    Checking customer…
                  </p>
                )}
                {phoneLookup.error && (
                  <Notice>
                    {phoneLookup.error}
                    <button
                      type="button"
                      className="btn mt-2"
                      onClick={phoneLookup.refresh}
                    >
                      Try again
                    </button>
                  </Notice>
                )}
                {existingCustomer && (
                  <p className="row-meta">
                    Existing account · Currently owes{' '}
                    {formatNaira(existingCustomer.balance)}
                  </p>
                )}
                <Field label="Customer phone">
                  <input
                    className="control"
                    type="tel"
                    required
                    value={phone}
                    disabled={blocked}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </Field>
                <Field
                  label="Amount received (₦)"
                  hint="Enter 0 if no deposit was paid."
                >
                  <input
                    className="control"
                    type="number"
                    min="0"
                    max={total}
                    step=".01"
                    required
                    value={deposit}
                    disabled={blocked}
                    onChange={(e) => {
                      setDeposit(e.target.value);
                      setZeroApproved(false);
                    }}
                  />
                </Field>
                {deposit !== '' && Number(deposit) === 0 && (
                  <label className="check-row">
                    <input
                      type="checkbox"
                      required
                      checked={zeroApproved}
                      disabled={blocked}
                      onChange={(e) => setZeroApproved(e.target.checked)}
                    />
                    I approve this sale without a deposit.
                  </label>
                )}
                <p className="amount">
                  Customer will owe{' '}
                  {formatNaira(Math.max(0, total - Number(deposit || 0)))}
                </p>
              </>
            ) : (
              <p className="muted">
                Confirm only after the full payment has been received.
              </p>
            )}
            <details className="disclosure">
              <summary>
                Payment details {paymentType === 'full' && '& customer'}{' '}
                <span className="muted font-normal">(optional)</span>
              </summary>
              <div className="form-stack">
                <Field label="Payment method">
                  <select
                    className="control"
                    value={method}
                    disabled={blocked}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="transfer">Bank transfer</option>
                    <option value="pos_terminal">Card terminal</option>
                  </select>
                </Field>
                {paymentType === 'full' && (
                  <>
                    <Field label="Customer name">
                      <input
                        className="control"
                        value={customerName}
                        disabled={blocked}
                        onChange={(e) => setCustomerName(e.target.value)}
                      />
                    </Field>
                    <Field label="Customer phone">
                      <input
                        className="control"
                        type="tel"
                        value={phone}
                        disabled={blocked}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </Field>
                  </>
                )}
              </div>
            </details>
            {error && <Notice>{error}</Notice>}
            {pending && (
              <button
                className="btn btn-primary btn-wide"
                type="button"
                disabled={busy}
                onClick={() => perform(pending)}
              >
                {busy ? 'Checking…' : 'Check saved transaction'}
              </button>
            )}
            {!pending && (
              <button
                className="btn btn-primary btn-wide"
                disabled={blocked || lookupBlocked}
              >
                {busy ? 'Recording…' : `Confirm sale · ${formatNaira(total)}`}
              </button>
            )}
          </form>
        </Modal>
      )}
      {paymentSale && (
        <Modal
          title="Record payment"
          onClose={() => setPaymentSale(null)}
          busy={busy}
        >
          <form className="form-stack" onSubmit={recordPayment}>
            <div>
              <h3>{paymentSale.customerName}</h3>
              <p className="row-meta">{paymentSale.receiptNumber}</p>
              <p className="amount mt-2">
                {formatNaira(paymentSale.balanceDue)} outstanding
              </p>
            </div>
            <Field label="Amount received (₦)">
              <input
                className="control"
                type="number"
                min=".01"
                max={paymentSale.balanceDue}
                step=".01"
                required
                disabled={blocked}
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
              />
            </Field>
            <button
              type="button"
              className="btn"
              disabled={blocked}
              onClick={() => setPaymentAmount(String(paymentSale.balanceDue))}
            >
              Full balance received
            </button>
            <details className="disclosure">
              <summary>
                Payment method{' '}
                <span className="muted font-normal">(optional)</span>
              </summary>
              <Field label="Payment received by">
                <select
                  className="control"
                  value={paymentMethod}
                  disabled={blocked}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="cash">Cash</option>
                  <option value="transfer">Bank transfer</option>
                  <option value="pos_terminal">Card terminal</option>
                </select>
              </Field>
            </details>
            <p className="muted text-sm">
              Record only money you have received from this customer.
            </p>
            {error && <Notice>{error}</Notice>}
            {pending ? (
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => perform(pending)}
              >
                {busy ? 'Checking…' : 'Check saved transaction'}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={blocked}>
                {busy ? 'Saving…' : 'Confirm payment'}
              </button>
            )}
          </form>
        </Modal>
      )}
    </div>
  );
}
