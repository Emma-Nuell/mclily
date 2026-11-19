import { useState } from 'react';
import useCollection from '../hooks/useCollection';
import { Empty, Loading, Notice, Pagination } from './AdminUI';

const labels = {
  correction: 'Stock correction',
  sell: 'In-store sale',
  capture: 'Online sale',
  reserve: 'Checkout hold',
  release: 'Hold released',
};

export default function StockHistory({ productId }) {
  const [page, setPage] = useState(1);
  const history = useCollection(
    `/products/${productId}/stock-history?limit=8&page=${page}`
  );
  return (
    <div className="form-stack" aria-label="Stock history entries">
      {history.error && (
        <Notice>
          {history.error}
          <button
            className="underline block mt-2"
            type="button"
            onClick={history.refresh}
          >
            Try again
          </button>
        </Notice>
      )}
      {history.loading ? (
        <Loading text="Loading stock history…" />
      ) : history.error ? null : history.rows.length === 0 ? (
        <Empty title="No stock changes yet.">
          Sales, checkout holds and saved corrections will appear here.
        </Empty>
      ) : (
        <ol className="m-0 p-0 list-none">
          {history.rows.map((entry) => (
            <li className="list-row" key={entry._id}>
              <div className="row-info">
                <span className="row-title text-sm">
                  {labels[entry.action] || 'Stock update'} ·{' '}
                  {entry.variantLabel}
                </span>
                <p className="row-meta">
                  {entry.stockBefore === entry.stockAfter
                    ? `${entry.stockAfter} ${entry.unit} on hand`
                    : `${entry.stockBefore} → ${entry.stockAfter} ${entry.unit} on hand`}
                  {entry.heldAfter > 0 ? ` · ${entry.heldAfter} held` : ''}
                </p>
                {entry.reason && <p className="row-meta">{entry.reason}</p>}
                <p className="row-meta">
                  {entry.actorName} ·{' '}
                  <time dateTime={entry.createdAt}>
                    {new Date(entry.createdAt).toLocaleString('en-NG', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <Pagination
        page={page}
        pages={history.pages}
        loading={history.loading}
        onChange={setPage}
      />
    </div>
  );
}
