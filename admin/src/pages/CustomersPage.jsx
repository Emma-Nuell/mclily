import { createRequestId } from '../../vendor/requestId.mjs';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Plus } from 'lucide-react';
import {
  PageHeading,
  Field,
  Notice,
  Loading,
  Empty,
  Modal,
  Pagination,
  SearchField,
} from '../components/AdminUI';
import useApiData from '../hooks/useApiData';
import useDebouncedValue from '../hooks/useDebouncedValue';
import useCreditOperation from '../hooks/useCreditOperation';
import { formatNaira } from '../utils/conversions';

const labels = {
  opening_balance: 'Opening debt',
  credit_sale: 'Credit purchase',
  legacy_balance: 'Earlier receipt balance',
  payment: 'Payment received',
  balance_correction: 'Balance corrected',
  write_off: 'Debt forgiven',
};

function OperationNotice({ operation }) {
  return (
    <>
      {operation.error && <Notice>{operation.error}</Notice>}
      {operation.pending && (
        <Notice tone="warning">
          <p>
            A saved customer update is awaiting confirmation. Check it before
            starting another.
          </p>
          <button
            type="button"
            className="btn mt-3"
            disabled={operation.busy}
            onClick={() => operation.perform(operation.pending)}
          >
            {operation.busy ? 'Checking…' : 'Check saved update'}
          </button>
        </Notice>
      )}
    </>
  );
}

function CustomerForm({ account, kind, operation, onClose }) {
  const creating = kind === 'create',
    payment = kind === 'payment',
    correction = kind === 'correction';
  const [name, setName] = useState(''),
    [phone, setPhone] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [method, setMethod] = useState('cash');
  const title = creating
    ? 'Add customer'
    : payment
      ? 'Record payment'
      : correction
        ? 'Correct balance'
        : 'Forgive debt';
  return (
    <Modal title={title} busy={operation.busy} onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (operation.blocked) return;
          const payload = { idempotencyKey: createRequestId() };
          if (creating)
            Object.assign(payload, {
              fullName: name.trim(),
              phone: phone.trim(),
              openingBalance: Number(amount || 0),
            });
          else if (correction)
            Object.assign(payload, {
              newBalance: Number(amount),
              reason: reason.trim(),
              expectedRevision: account.revision,
            });
          else
            Object.assign(payload, {
              amount: Number(amount),
              ...(payment
                ? { paymentMethod: method }
                : {
                    reason: reason.trim(),
                    expectedRevision: account.revision,
                  }),
            });
          operation.perform({
            kind,
            endpoint: creating
              ? '/customers'
              : `/customers/${account._id}/${kind}`,
            payload,
          });
        }}
      >
        {creating ? (
          <>
            <Field label="Customer name">
              <input
                className="control"
                required
                maxLength={200}
                value={name}
                disabled={operation.blocked}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field
              label="Customer phone"
              hint="Use the same phone for future purchases and payments."
            >
              <input
                className="control"
                type="tel"
                required
                value={phone}
                disabled={operation.blocked}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
          </>
        ) : (
          <div>
            <h3>{account.fullName}</h3>
            <p className="row-meta">
              Currently owes {formatNaira(account.balance)}
            </p>
          </div>
        )}
        <Field
          label={
            creating
              ? 'Opening debt (₦, optional)'
              : payment
                ? 'Amount received (₦)'
                : correction
                  ? 'Correct amount owed (₦)'
                  : 'Amount to forgive (₦)'
          }
          hint={
            creating
              ? 'Existing debt only. This does not record a new sale.'
              : payment
                ? 'Confirm only after receiving this money.'
                : correction
                  ? 'This corrects the debt record and does not record money received.'
                  : 'Forgiven debt is not a payment.'
          }
        >
          <input
            className="control"
            type="number"
            inputMode="decimal"
            step=".01"
            min={creating || correction ? '0' : '.01'}
            max={!creating && !correction ? account.balance : undefined}
            required={!creating}
            value={amount}
            disabled={operation.blocked}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        {payment && (
          <>
            <button
              type="button"
              className="btn"
              disabled={operation.blocked}
              onClick={() => setAmount(String(account.balance))}
            >
              Use full balance · {formatNaira(account.balance)}
            </button>
            <Field label="Payment method">
              <select
                className="control"
                value={method}
                disabled={operation.blocked}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="cash">Cash</option>
                <option value="transfer">Bank transfer</option>
                <option value="pos_terminal">Card terminal</option>
              </select>
            </Field>
          </>
        )}
        {!creating && !payment && (
          <Field label="Reason">
            <textarea
              className="control"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              disabled={operation.blocked}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        )}
        <OperationNotice operation={operation} />
        {!operation.pending && (
          <button
            className="btn btn-primary btn-wide"
            disabled={operation.blocked}
          >
            {operation.busy ? 'Saving…' : title}
          </button>
        )}
      </form>
    </Modal>
  );
}

export default function CustomersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState(''),
    [status, setStatus] = useState('owing'),
    [page, setPage] = useState(1),
    [adding, setAdding] = useState(false);
  const term = useDebouncedValue(search);
  const customers = useApiData(
    '/customers?' +
      new URLSearchParams({ search: term, status, page, limit: '15' })
  );
  const operation = useCreditOperation(({ account }) => {
    setAdding(false);
    navigate('/customers/' + account._id);
  });
  return (
    <div className="page-stack form-narrow">
      <PageHeading
        title="Customers & credit"
        description="One balance for each customer."
      >
        <button
          className="btn btn-primary"
          disabled={operation.blocked}
          onClick={() => {
            operation.clearError();
            setAdding(true);
          }}
        >
          <Plus size={18} />
          Add customer
        </button>
      </PageHeading>
      <OperationNotice operation={operation} />
      <SearchField
        label="Search customers"
        placeholder="Name or phone…"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <div className="segmented" aria-label="Customer balance filter">
        {[
          ['owing', 'Owing'],
          ['', 'All'],
          ['cleared', 'Cleared'],
        ].map(([value, label]) => (
          <button
            key={label}
            aria-pressed={status === value}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {customers.error && (
        <Notice>
          {customers.error}
          <button className="btn mt-2" onClick={customers.refresh}>
            Try again
          </button>
        </Notice>
      )}
      {customers.response?.legacyOutstandingCount > 0 && (
        <Notice tone="warning">
          Earlier receipts need to be brought into customer accounts. Ask the
          technical administrator to run the credit migration before using these
          balances.
        </Notice>
      )}
      {customers.loading ? (
        <Loading text="Loading customers…" />
      ) : customers.data?.length ? (
        <section className="panel panel-pad">
          {customers.data.map((account) => (
            <Link
              className="menu-link"
              key={account._id}
              to={'/customers/' + account._id}
            >
              <span className="row-info">
                <strong className="row-title">{account.fullName}</strong>
                <span className="row-meta block">{account.phone}</span>
              </span>
              <span className="amount">{formatNaira(account.balance)}</span>
              <ChevronRight size={18} />
            </Link>
          ))}
        </section>
      ) : (
        !customers.error && (
          <Empty
            title={
              status === 'owing'
                ? 'No outstanding customer balances.'
                : 'No customers found.'
            }
          >
            Add a customer or record a credit purchase from Sell.
          </Empty>
        )
      )}
      <Pagination
        page={page}
        pages={customers.response?.pages || 1}
        onChange={setPage}
        loading={customers.loading}
      />
      {adding && (
        <CustomerForm
          kind="create"
          operation={operation}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0),
    [page, setPage] = useState(1),
    [form, setForm] = useState(null),
    [success, setSuccess] = useState('');
  const customer = useApiData('/customers/' + id, revision);
  const entries = useApiData(
    `/customers/${id}/entries?limit=15&page=${page}`,
    revision
  );
  const operation = useCreditOperation(({ account }, saved) => {
    setForm(null);
    setPage(1);
    setRevision((value) => value + 1);
    setSuccess(
      saved.kind === 'payment'
        ? 'Payment recorded.'
        : saved.kind === 'correction'
          ? 'Balance corrected. No payment recorded.'
          : saved.kind === 'create'
            ? 'Customer added.'
            : 'Debt forgiven. No payment recorded.'
    );
    if (account._id !== id) navigate('/customers/' + account._id);
  });
  const account = customer.data;
  function open(kind) {
    operation.clearError();
    setSuccess('');
    setForm(kind);
  }
  return (
    <div className="page-stack form-narrow">
      <Link className="btn w-fit" to="/customers">
        Back to customers
      </Link>
      <OperationNotice operation={operation} />
      {success && <Notice tone="success">{success}</Notice>}
      {customer.loading ? (
        <Loading text="Loading customer…" />
      ) : customer.error ? (
        <Notice>
          {customer.error}
          <button className="btn mt-2" onClick={customer.refresh}>
            Refresh balance
          </button>
        </Notice>
      ) : (
        account && (
          <>
            <PageHeading title={account.fullName} description={account.phone} />
            <section className="panel panel-pad form-stack">
              <div>
                <p className="muted">Amount owed</p>
                <p className="credit-balance">{formatNaira(account.balance)}</p>
                {account.balance === 0 && (
                  <p className="row-meta">No outstanding balance.</p>
                )}
              </div>
              <button
                className="btn btn-primary btn-wide"
                disabled={operation.blocked || account.balance <= 0}
                onClick={() => open('payment')}
              >
                Record payment
              </button>
              <Link className="btn btn-wide" to={'/pos?customer=' + id}>
                Add a credit purchase
              </Link>
            </section>
            <section className="page-stack">
              <h2>Account history</h2>
              {entries.loading ? (
                <Loading text="Loading account history…" />
              ) : entries.error ? (
                <Notice>
                  {entries.error}
                  <button className="btn mt-2" onClick={entries.refresh}>
                    Try again
                  </button>
                </Notice>
              ) : entries.data?.length ? (
                <div className="panel panel-pad">
                  {entries.data.map((entry) => (
                    <div className="list-row credit-entry" key={entry._id}>
                      <div className="row-info">
                        <h3>{labels[entry.type] || entry.type}</h3>
                        <p className="row-meta">
                          {entry.reason}
                          {entry.receiptNumber
                            ? ' · ' + entry.receiptNumber
                            : ''}
                        </p>
                        <p className="row-meta">
                          {new Date(entry.createdAt).toLocaleString('en-NG')} ·{' '}
                          {entry.recordedByName}
                          {entry.paymentMethod
                            ? ' · ' +
                              {
                                cash: 'Cash',
                                transfer: 'Bank transfer',
                                pos_terminal: 'Card terminal',
                              }[entry.paymentMethod]
                            : ''}
                        </p>
                      </div>
                      <div className="credit-entry-amount">
                        <strong>
                          {entry.delta > 0 ? '+' : '−'}
                          {formatNaira(entry.amount)}
                        </strong>
                        <p className="row-meta">
                          Owed {formatNaira(entry.balanceAfter)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No balance changes yet.">
                  Credit purchases and payments will appear here.
                </Empty>
              )}
              <Pagination
                page={page}
                pages={entries.response?.pages || 1}
                onChange={setPage}
                loading={entries.loading}
              />
            </section>
            <details className="disclosure">
              <summary>Account options</summary>
              <div className="form-stack">
                <p className="row-meta">
                  Use these for record corrections or debt you have agreed to
                  forgive. They do not record money received.
                </p>
                <button
                  className="btn"
                  disabled={operation.blocked}
                  onClick={() => open('correction')}
                >
                  Correct balance
                </button>
                <button
                  className="btn"
                  disabled={operation.blocked || account.balance <= 0}
                  onClick={() => open('write-off')}
                >
                  Forgive debt
                </button>
                <button
                  className="btn"
                  onClick={() => setRevision((value) => value + 1)}
                >
                  Refresh balance
                </button>
              </div>
            </details>
            {form && (
              <CustomerForm
                key={form}
                account={account}
                kind={form}
                operation={operation}
                onClose={() => setForm(null)}
              />
            )}
          </>
        )
      )}
    </div>
  );
}
