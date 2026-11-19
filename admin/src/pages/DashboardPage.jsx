import { Link } from 'react-router-dom';
import { ArrowRight, Plus, ShoppingBag, RefreshCw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import useCollection from '../hooks/useCollection';
import {
  PageHeading,
  Loading,
  Empty,
  Notice,
  Status,
} from '../components/AdminUI';
import { formatNaira } from '../utils/conversions';
import useApiData from '../hooks/useApiData';
export default function DashboardPage() {
  const { user } = useAuth();
  const preparing = useCollection('/orders?status=processing&limit=4');
  const delivery = useCollection('/orders?status=shipped&limit=1');
  const attention = useCollection('/orders?status=needs_resolution&limit=3');
  const products = useCollection('/products?limit=1');
  const sales = useCollection('/pos/sales?limit=4');
  const report = useApiData('/reports/sales');
  const date = new Intl.DateTimeFormat('en-NG', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'Africa/Lagos',
  }).format(new Date());
  const refresh = () =>
    [preparing, delivery, attention, products, sales, report].forEach(
      (source) => source.refresh()
    );
  const errors = [preparing, delivery, attention, products, sales].some(
    (source) => source.error
  );
  return (
    <div className="page-stack">
      <div>
        <p className="eyebrow">{date}</p>
        <PageHeading
          title={`Hello, ${user?.fullName?.split(' ')[0] || 'there'}.`}
          description="What would you like to do today?"
        >
          <button
            className="btn btn-icon btn-quiet"
            onClick={refresh}
            aria-label="Refresh store overview"
          >
            <RefreshCw size={19} />
          </button>
        </PageHeading>
      </div>
      <div className="home-actions">
        <Link className="home-action primary" to="/pos">
          <ShoppingBag size={27} strokeWidth={1.5} />
          <div>
            <strong>Sell an item</strong>
            <small>Record an in-store sale</small>
          </div>
        </Link>
        <Link className="home-action" to="/quick-post">
          <Plus size={27} strokeWidth={1.5} />
          <div>
            <strong>Add product</strong>
            <small>Put something new in store</small>
          </div>
        </Link>
      </div>
      {errors && (
        <Notice>
          Some store information could not load.{' '}
          <button className="underline font-semibold" onClick={refresh}>
            Try again
          </button>
        </Notice>
      )}
      <div className="summary-strip">
        {[
          [preparing, 'To prepare'],
          [delivery, 'On delivery'],
          [products, 'Live products'],
        ].map(([source, label]) => (
          <div key={label}>
            <strong>
              {source.loading || source.error ? '—' : source.total}
            </strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="panel panel-pad">
        <div className="section-head">
          <h2>At a glance</h2>
          <Link to="/reports">Sales reports</Link>
        </div>
        {report.error ? (
          <p className="muted">
            Financial figures are temporarily unavailable.
          </p>
        ) : (
          <div className="home-money">
            <div>
              <p className="row-meta">Money received today</p>
              <strong>
                {report.loading
                  ? '—'
                  : formatNaira(report.data.totals.receivedKobo / 100)}
              </strong>
            </div>
            <div>
              <p className="row-meta">Customer credit now</p>
              <strong>
                {report.loading
                  ? '—'
                  : formatNaira(
                      report.data.current.outstandingCreditKobo / 100
                    )}
              </strong>
            </div>
          </div>
        )}
        <p className="row-meta mt-3">
          Recorded payments, not profit. Full figures and any data gaps are in
          Sales reports.
        </p>
      </section>
      {!attention.loading && attention.total > 0 && (
        <section className="notice notice-warning">
          <div>
            <h2>
              {attention.total}{' '}
              {attention.total === 1 ? 'order needs' : 'orders need'} a check
            </h2>
            <p className="mt-1 text-sm">
              Review payment or availability before preparing these orders.
            </p>
            <Link className="btn mt-3" to="/orders?status=needs_resolution">
              Review orders
              <ArrowRight size={17} />
            </Link>
          </div>
        </section>
      )}
      <div className="home-columns">
        <section>
          <div className="section-head">
            <h2>Orders to prepare</h2>
            <Link to="/orders?status=processing">View all</Link>
          </div>
          {preparing.loading ? (
            <Loading text="Checking orders…" />
          ) : preparing.error ? (
            <p className="muted">Orders are temporarily unavailable.</p>
          ) : preparing.rows.length === 0 ? (
            <Empty title="You're up to date.">
              Paid orders awaiting preparation will appear here.
            </Empty>
          ) : (
            preparing.rows.map((order) => (
              <div className="list-row" key={order._id}>
                <div className="row-info">
                  <span className="row-title">{order.customer?.name}</span>
                  <p className="row-meta">
                    {order.orderNumber} · {order.shippingAddress?.city}
                  </p>
                </div>
                <div className="text-right">
                  <span className="amount">
                    {formatNaira(order.pricing?.totalAmount)}
                  </span>
                  <div className="mt-1">
                    <Status tone="success">Paid</Status>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
        <section>
          <div className="section-head">
            <h2>Recent in-store sales</h2>
            <Link to="/pos?view=history">History</Link>
          </div>
          {sales.loading ? (
            <Loading text="Loading sales…" />
          ) : sales.error ? (
            <p className="muted">Sales are temporarily unavailable.</p>
          ) : sales.rows.length === 0 ? (
            <Empty title="Your first sale starts here.">
              Record a sale to keep your stock and receipts together.
            </Empty>
          ) : (
            sales.rows.map((sale) => (
              <div className="list-row" key={sale._id}>
                <div className="row-info">
                  <span className="row-title">
                    {sale.customerName || 'Walk-in customer'}
                  </span>
                  <p className="row-meta">{sale.receiptNumber}</p>
                </div>
                <div className="text-right">
                  <span className="amount">
                    {formatNaira(sale.totalAmount)}
                  </span>
                  <p className="row-meta">
                    {sale.balanceDue > 0
                      ? `${formatNaira(sale.balanceDue)} owed`
                      : 'Paid in full'}
                  </p>
                </div>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
