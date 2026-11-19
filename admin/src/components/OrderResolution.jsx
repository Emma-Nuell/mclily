import { createRequestId } from '../../vendor/requestId.mjs';
import { useState } from 'react';
import useApiData from '../hooks/useApiData';
import { Modal, Field, Notice, Loading, Pagination } from './AdminUI';
import { formatNaira } from '../utils/conversions';

const actionLabels = {
  issue: 'Record an issue',
  note: 'Add a note',
  resolve: 'Resolve issue',
  restock: 'Restore inspected stock',
  'refund-request': 'Record refund request',
  'refund-start': 'Start refund',
  'refund-complete': 'Confirm money sent',
  'refund-fail': 'Record failed transfer',
  'recheck-payment': 'Recheck payment',
  'reconcile-provider-refund': 'Reconcile provider refund',
};
const auditLabels = {
  issue: 'Issue recorded',
  note: 'Note added',
  resolve: 'Issue resolved',
  restock: 'Stock restored',
  refund_request: 'Refund requested',
  refund_start: 'Refund started',
  refund_complete: 'Manual refund confirmed',
  refund_fail: 'Refund failed',
  refund_completed: 'Provider confirmed refund',
  refund_failed: 'Provider refund failed',
  recheck_payment: 'Payment rechecked',
  external_refund_review: 'Provider refund needs review',
};

export function OrderOperationNotice({ operation }) {
  return (
    <>
      {operation.error && <Notice>{operation.error}</Notice>}
      {operation.pending && (
        <Notice tone="warning">
          <p>
            A saved order update needs confirmation. Check it before starting
            another.
          </p>
          <button
            type="button"
            className="btn mt-3"
            disabled={operation.busy}
            onClick={() => operation.perform(operation.pending)}
          >
            {operation.busy ? 'Checking…' : 'Check saved order update'}
          </button>
        </Notice>
      )}
    </>
  );
}

function ResolutionForm({ action, data, operation, onBack }) {
  const { order, revision } = data;
  const refund = data.refunds.find(
    (entry) => entry._id === order.refundSummary?.active
  );
  const [reason, setReason] = useState(
    action === 'recheck-payment'
      ? 'Recheck payment with the payment provider'
      : ''
  );
  const [mode, setMode] = useState('manual'),
    [checked, setChecked] = useState(false),
    [reference, setReference] = useState(''),
    [evidence, setEvidence] = useState(''),
    [quantities, setQuantities] = useState({});
  return (
    <form
      className="form-stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (operation.blocked) return;
        const payload = {
          idempotencyKey: createRequestId(),
          expectedRevision: revision,
          reason: reason.trim(),
        };
        if (action === 'refund-request')
          Object.assign(payload, { mode, providerChecked: checked });
        if (action.startsWith('refund-') && action !== 'refund-request')
          payload.refundId = refund?._id;
        if (action === 'refund-complete')
          Object.assign(payload, {
            transferReference: reference.trim(),
            evidence: evidence.trim(),
            sentConfirmed: checked,
          });
        if (action === 'refund-fail') payload.noMoneyMoved = checked;
        if (action === 'restock')
          Object.assign(payload, {
            inspected: checked,
            items: order.orderItems
              .filter((item) => Number(quantities[item._id]) > 0)
              .map((item) => ({
                itemId: item._id,
                ...(item.productType === 'fabric'
                  ? { yards: Number(quantities[item._id]) }
                  : { quantity: Number(quantities[item._id]) }),
              })),
          });
        operation.perform({
          endpoint: `/orders/${order._id}/resolution/${action}`,
          payload,
        });
      }}
    >
      <h3>
        {action === 'resolve' && order.fulfillment.status === 'needs_resolution'
          ? 'Check stock & prepare'
          : actionLabels[action]}
      </h3>
      {action === 'resolve' && (
        <p className="row-meta">
          For a paid order needing stock, all exact items must be available
          together before preparation can resume.
        </p>
      )}
      {action === 'refund-request' && (
        <>
          <p className="amount">
            Full refund ·{' '}
            {formatNaira(
              order.payment.receivedAmount ?? order.pricing.totalAmount
            )}
          </p>
          <p className="row-meta">
            Includes the collected delivery and website service charges. This
            records a request; it does not send money. Initiate refunds for
            unfulfillable, undispatched orders within one business day. Bank
            arrival timing varies.
          </p>
          <Field label="Refund method">
            <select
              className="control"
              value={mode}
              disabled={operation.blocked}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="manual">Manual bank transfer</option>
              {data.gatewayRefundsEnabled &&
                order.payment.gateway === 'bachs' &&
                order.payment.channel === 'NGN_CARD' &&
                order.payment.chargeId && (
                  <option value="bachs">Bachs card refund</option>
                )}
            </select>
          </Field>
          <p className="row-meta">
            NGN bank-transfer payments need a manual refund. Card refunds depend
            on provider eligibility.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={checked}
              disabled={operation.blocked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked the payment provider and no refund has already been sent
            or started.
          </label>
        </>
      )}
      {action === 'refund-start' && (
        <p className="row-meta">
          {refund?.mode === 'manual'
            ? 'Mark the refund as in progress, then make the bank transfer outside this app. Confirm money sent only after checking the actual transfer.'
            : 'This queues a real Bachs refund. The server checks eligibility and waits for provider confirmation.'}{' '}
          Amount: {formatNaira(refund?.amount)}.
        </p>
      )}
      {action === 'refund-complete' && (
        <>
          <p className="amount">Confirm {formatNaira(refund?.amount)} sent</p>
          <Field label="Bank transfer reference">
            <input
              className="control"
              required
              maxLength={200}
              value={reference}
              disabled={operation.blocked}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field
            label="Transfer evidence"
            hint="Record the bank receipt details, transfer date and how you checked the successful transfer. Do not enter banking passwords."
          >
            <textarea
              className="control"
              required
              minLength={3}
              maxLength={1000}
              value={evidence}
              disabled={operation.blocked}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </Field>
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={checked}
              disabled={operation.blocked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I checked that the full refund was successfully sent.
          </label>
        </>
      )}
      {action === 'refund-fail' && (
        <>
          <p className="row-meta">
            An uncertain transfer must stay processing while you check with the
            bank.
          </p>
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={checked}
              disabled={operation.blocked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I confirmed the transfer failed and no money moved.
          </label>
        </>
      )}
      {action === 'restock' && (
        <>
          <p className="row-meta">
            Enter only goods physically received and inspected. Refunding alone
            never restores stock.
          </p>
          {order.orderItems.map((item) => {
            const fabric = item.productType === 'fabric',
              restored = order.inventory.restored?.[item._id] || 0;
            const remaining = fabric
              ? (item.halfYards - restored) / 2
              : item.quantity - restored;
            return (
              <Field
                key={item._id}
                label={`${item.name} · ${fabric ? item.fabricColor || 'Fabric' : [item.size, item.color].filter(Boolean).join(' / ') || 'Standard'} (${fabric ? 'yards' : 'pieces'})`}
                hint={`${remaining} still eligible`}
              >
                <input
                  className="control"
                  type="number"
                  inputMode={fabric ? 'decimal' : 'numeric'}
                  min="0"
                  max={remaining}
                  step={fabric ? '.5' : '1'}
                  disabled={operation.blocked || remaining <= 0}
                  value={quantities[item._id] ?? ''}
                  onChange={(e) =>
                    setQuantities((previous) => ({
                      ...previous,
                      [item._id]: e.target.value,
                    }))
                  }
                />
              </Field>
            );
          })}
          <label className="check-row">
            <input
              type="checkbox"
              required
              checked={checked}
              disabled={operation.blocked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I received and inspected these goods and they can be sold again.
          </label>
        </>
      )}
      <Field
        label={action === 'issue' || action === 'note' ? 'Details' : 'Reason'}
      >
        <textarea
          className="control"
          required
          minLength={3}
          maxLength={1000}
          value={reason}
          disabled={operation.blocked}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <OrderOperationNotice operation={operation} />
      <div className="dialog-footer">
        <button
          className="btn"
          type="button"
          disabled={operation.busy}
          onClick={onBack}
        >
          Back
        </button>
        {!operation.pending && (
          <button
            className="btn btn-primary"
            disabled={
              operation.blocked ||
              (action === 'restock' &&
                !Object.values(quantities).some((value) => Number(value) > 0))
            }
          >
            {operation.busy ? 'Saving…' : actionLabels[action]}
          </button>
        )}
      </div>
    </form>
  );
}

export default function OrderResolution({ orderId, operation, onClose }) {
  const [page, setPage] = useState(1),
    [action, setAction] = useState(null);
  const state = useApiData(`/orders/${orderId}/resolution?page=${page}`),
    data = state.data;
  const order = data?.order;
  const active = data?.refunds.find(
    (refund) => refund._id === order.refundSummary?.active
  );
  const blocked = operation.blocked;
  function choose(value) {
    operation.clearError();
    setAction(value);
  }
  return (
    <Modal title="Resolve issue" busy={operation.busy} onClose={onClose}>
      {state.loading ? (
        <Loading text="Loading order checks…" />
      ) : state.error ? (
        <Notice>{state.error}</Notice>
      ) : (
        data &&
        (action ? (
          <ResolutionForm
            key={action}
            action={action}
            data={data}
            operation={operation}
            onBack={() => setAction(null)}
          />
        ) : (
          <div className="form-stack">
            <div>
              <h3>{order.orderNumber}</h3>
              <p className="row-meta">
                {order.customer.name} · {formatNaira(order.pricing.totalAmount)}
              </p>
            </div>
            {order.payment.reviewReason && (
              <Notice tone="warning">{order.payment.reviewReason}</Notice>
            )}
            {order.support?.externalRefundReview && (
              <Notice tone="warning">
                A provider refund made outside McLily needs technical
                reconciliation. Do not send another refund.
              </Notice>
            )}
            <OrderOperationNotice operation={operation} />
            {order.fulfillment.status === 'needs_resolution' &&
              (!active || active.status === 'failed') && (
                <button
                  className="btn btn-primary btn-wide"
                  disabled={blocked || order.payment.status !== 'paid'}
                  onClick={() => choose('resolve')}
                >
                  Check stock & prepare
                </button>
              )}
            {active && (
              <section className="panel panel-pad form-stack">
                <h3>Refund · {active.status}</h3>
                <p className="amount">{formatNaira(active.amount)}</p>
                <p className="row-meta">
                  {active.mode === 'manual'
                    ? 'Manual bank transfer'
                    : 'Bachs card refund'}{' '}
                  · {active.reason}
                </p>
                {active.outcome && <p className="row-meta">{active.outcome}</p>}
                {active.status === 'requested' && (
                  <button
                    className="btn btn-primary"
                    disabled={blocked}
                    onClick={() => choose('refund-start')}
                  >
                    Start refund
                  </button>
                )}
                {active.mode === 'manual' && active.status === 'processing' && (
                  <button
                    className="btn btn-primary"
                    disabled={blocked}
                    onClick={() => choose('refund-complete')}
                  >
                    Confirm money sent
                  </button>
                )}
                {active.transferReference && (
                  <p className="row-meta">
                    Transfer: {active.transferReference}
                  </p>
                )}
              </section>
            )}
            <details className="disclosure">
              <summary>Issue & refund options</summary>
              <div className="form-stack">
                {order.support?.externalRefundReview && (
                  <button
                    className="btn"
                    disabled={blocked}
                    onClick={() => choose('reconcile-provider-refund')}
                  >
                    Reconcile provider refund
                  </button>
                )}
                <button
                  className="btn"
                  disabled={blocked}
                  onClick={() => choose(order.support?.open ? 'note' : 'issue')}
                >
                  {order.support?.open ? 'Add a note' : 'Record an issue'}
                </button>
                <button
                  className="btn"
                  disabled={blocked || order.payment.status === 'refunded'}
                  onClick={() => choose('recheck-payment')}
                >
                  Recheck payment
                </button>
                {(order.payment.status === 'paid' ||
                  (order.payment.status === 'review' &&
                    order.payment.collectionVerifiedAt)) &&
                  (!active || active.status === 'failed') && (
                    <button
                      className="btn"
                      disabled={blocked || order.support?.externalRefundReview}
                      onClick={() => choose('refund-request')}
                    >
                      Record refund request
                    </button>
                  )}
                {order.support?.open &&
                  order.fulfillment.status !== 'needs_resolution' && (
                    <button
                      className="btn"
                      disabled={blocked}
                      onClick={() => choose('resolve')}
                    >
                      Close issue
                    </button>
                  )}
                {order.inventory.status === 'consumed' &&
                  order.orderItems.some(
                    (item) =>
                      (item.productType === 'fabric'
                        ? item.halfYards
                        : item.quantity) >
                      (order.inventory.restored?.[item._id] || 0)
                  ) &&
                  ['cancelled', 'delivered'].includes(
                    order.fulfillment.status
                  ) && (
                    <button
                      className="btn"
                      disabled={blocked}
                      onClick={() => choose('restock')}
                    >
                      Restore inspected stock
                    </button>
                  )}
                {active?.mode === 'manual' &&
                  active.status === 'processing' && (
                    <button
                      className="btn"
                      disabled={blocked}
                      onClick={() => choose('refund-fail')}
                    >
                      Record failed transfer
                    </button>
                  )}
              </div>
            </details>
            <details className="disclosure">
              <summary>Issue & refund history</summary>
              <div className="form-stack">
                {data.actions.length ? (
                  data.actions.map((entry) => (
                    <div key={entry._id}>
                      <h3>{auditLabels[entry.type] || entry.type}</h3>
                      <p className="row-meta">{entry.reason}</p>
                      <p className="row-meta">
                        {entry.actorName} ·{' '}
                        {new Date(entry.createdAt).toLocaleString('en-NG')}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="row-meta">No issue actions recorded.</p>
                )}
                <Pagination
                  page={page}
                  pages={data.pages}
                  onChange={setPage}
                  loading={state.loading}
                />
              </div>
            </details>
            <button
              className="btn"
              onClick={state.refresh}
              disabled={operation.busy}
            >
              Refresh details
            </button>
          </div>
        ))
      )}
      {state.error && (
        <button className="btn" onClick={state.refresh}>
          Try again
        </button>
      )}
    </Modal>
  );
}
