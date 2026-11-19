import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import useApiData from '../hooks/useApiData';
import { PageHeading, Field, Notice, Loading } from '../components/AdminUI';
import SalesTrend from '../components/SalesTrend';
import { formatNaira } from '../utils/conversions';
import { reportDates, localDate } from '../utils/reportDates';

const amount = (value) => formatNaira(value / 100);
function Figures({ rows }) {
  return (
    <dl className="report-figures">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{amount(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
export default function ReportsPage() {
  const [preset, setPreset] = useState('month30');
  const [period, setPeriod] = useState(() => reportDates('month30'));
  const [draft, setDraft] = useState(period),
    [filterError, setFilterError] = useState(''),
    [tableOpen, setTableOpen] = useState(false);
  const state = useApiData('/reports/sales?' + new URLSearchParams(period)),
    data = state.data;
  return (
    <div className="page-stack">
      <PageHeading
        title="Sales reports"
        description="Sales, money received and customer credit, kept separate."
      >
        <button
          className="btn btn-icon btn-quiet"
          onClick={state.refresh}
          aria-label="Refresh sales report"
        >
          <RefreshCw size={19} />
        </button>
      </PageHeading>
      <form
        className="report-filters"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !draft.from ||
            !draft.to ||
            draft.from > draft.to ||
            draft.to > localDate()
          ) {
            setFilterError('Choose valid dates ending today or earlier.');
            return;
          }
          setFilterError('');
          setPeriod({ ...draft });
        }}
      >
        <Field label="Period">
          <select
            className="control"
            value={preset}
            onChange={(event) => {
              const next = event.target.value;
              setPreset(next);
              setFilterError('');
              if (next !== 'custom') {
                const dates = reportDates(next);
                setPeriod(dates);
                setDraft(dates);
              }
            }}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month30">Last 30 days</option>
            <option value="month">This month</option>
            <option value="custom">Choose dates</option>
          </select>
        </Field>
        {preset === 'custom' && (
          <>
            <Field label="From">
              <input
                className="control"
                type="date"
                required
                max={localDate()}
                value={draft.from}
                onChange={(event) =>
                  setDraft({ ...draft, from: event.target.value })
                }
              />
            </Field>
            <Field label="To">
              <input
                className="control"
                type="date"
                required
                min={draft.from}
                max={localDate()}
                value={draft.to}
                onChange={(event) =>
                  setDraft({ ...draft, to: event.target.value })
                }
              />
            </Field>
            <button className="btn" type="submit">
              Apply dates
            </button>
          </>
        )}
      </form>
      {filterError && <Notice>{filterError}</Notice>}
      {state.loading ? (
        <Loading text="Preparing sales report…" />
      ) : state.error ? (
        <Notice>
          {state.error}
          <button className="btn mt-3" onClick={state.refresh}>
            Try again
          </button>
        </Notice>
      ) : (
        data && (
          <>
            <p className="row-meta">
              {data.period.from} to {data.period.to} · Nigerian time
              (Africa/Lagos)
            </p>
            <div className="report-metrics">
              {[
                [
                  'Sales value',
                  data.totals.salesKobo,
                  'Goods sold, including in-store credit',
                ],
                [
                  'Money received',
                  data.totals.receivedKobo,
                  'Recorded payments, including debt repayments',
                ],
                [
                  'Completed refunds',
                  data.totals.refundsKobo,
                  'Recorded as sent in this period',
                ],
                [
                  'Cash after refunds',
                  data.totals.cashAfterRefundsKobo,
                  'Money received less refunds; not profit',
                ],
              ].map(([label, value, hint]) => (
                <section className="panel panel-pad" key={label}>
                  <h2 className="row-meta">{label}</h2>
                  <p className="report-amount">{amount(value)}</p>
                  <p className="row-meta">{hint}</p>
                </section>
              ))}
            </div>
            {Object.values(data.quality).some(Boolean) && (
              <Notice tone="warning">
                Some older records need review. Cash or ledger totals may be
                incomplete; see Report notes below.
              </Notice>
            )}
            <section className="panel panel-pad">
              <SalesTrend daily={data.daily} />
            </section>
            <div className="report-columns">
              <section className="panel panel-pad form-stack">
                <h2>Where the money came from</h2>
                <Figures
                  rows={[
                    [`Online collections`, data.totals.onlineCollectionsKobo],
                    [
                      'Initial in-store payments',
                      data.totals.initialPosPaymentsKobo,
                    ],
                    [
                      'Customer debt repayments',
                      data.totals.debtRepaymentsKobo,
                    ],
                  ]}
                />
                <p className="row-meta">
                  Includes website fees and delivery collected online.
                  Recipient-paid courier fees are separate.
                </p>
              </section>
              <section className="panel panel-pad form-stack">
                <h2>Sales and credit in this period</h2>
                <Figures
                  rows={[
                    [
                      `Online goods · ${data.totals.onlineOrders} ${data.totals.onlineOrders === 1 ? 'order' : 'orders'}`,
                      data.totals.onlineSalesKobo,
                    ],
                    [
                      `In-store goods · ${data.totals.posReceipts} ${data.totals.posReceipts === 1 ? 'receipt' : 'receipts'}`,
                      data.totals.posSalesKobo,
                    ],
                    ['New credit added', data.totals.creditAddedKobo],
                    [
                      'Opening debt added (not sales)',
                      data.totals.openingDebtKobo,
                    ],
                    ['Debt forgiven (not cash)', data.totals.forgivenKobo],
                    [
                      'Net debt corrections (not cash)',
                      data.totals.correctionsKobo,
                    ],
                  ]}
                />
              </section>
            </div>
            <section className="panel panel-pad form-stack">
              <h2>Customer credit now</h2>
              <p className="report-amount">
                {amount(data.current.outstandingCreditKobo)}
              </p>
              <p className="row-meta">
                {data.current.owingCustomers}{' '}
                {data.current.owingCustomers === 1
                  ? 'customer owes'
                  : 'customers owe'}{' '}
                money · {data.current.ordersNeedingReview}{' '}
                {data.current.ordersNeedingReview === 1
                  ? 'order needs'
                  : 'orders need'}{' '}
                a check.
              </p>
              <p className="row-meta">
                Current recorded ledger balance as at{' '}
                {new Date(data.generatedAt).toLocaleString('en-NG', {
                  timeZone: 'Africa/Lagos',
                })}
                . This is not a balance at the end of the selected dates.
              </p>
            </section>
            <details
              className="panel panel-pad disclosure"
              onToggle={(event) => setTableOpen(event.currentTarget.open)}
            >
              <summary>Daily breakdown</summary>
              {tableOpen && (
                <div
                  className="report-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label="Daily figures, scroll horizontally for more columns"
                >
                  <table className="report-table">
                    <caption className="sr-only">
                      Daily recorded financial figures in naira
                    </caption>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Online goods</th>
                        <th>In-store goods</th>
                        <th>Received</th>
                        <th>Refunds</th>
                        <th>After refunds</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.daily.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{day.date}</th>
                          {[
                            'onlineSalesKobo',
                            'posSalesKobo',
                            'receivedKobo',
                            'refundsKobo',
                            'cashAfterRefundsKobo',
                          ].map((field) => (
                            <td key={field}>{amount(day[field])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </details>
            <details className="panel panel-pad disclosure">
              <summary>Report notes</summary>
              <div className="form-stack mt-4">
                {data.notes.map((note) => (
                  <p className="row-meta" key={note}>
                    {note}
                  </p>
                ))}
                {Object.values(data.quality).some(Boolean) && (
                  <p className="row-meta">
                    Missing initial POS figures:{' '}
                    {data.quality.missingPosInitial}; missing online collection
                    markers: {data.quality.missingOnlineCollections}; undated
                    paid orders (all dates): {data.quality.undatedPaidOrders};
                    unlinked older credit receipts (current):{' '}
                    {data.quality.legacyCreditReceipts}.
                  </p>
                )}
              </div>
            </details>
          </>
        )
      )}
    </div>
  );
}
