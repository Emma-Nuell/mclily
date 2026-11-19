import { createRequestId } from '../../vendor/requestId.mjs';
import { useState } from 'react';
import { Modal, Field } from './AdminUI';
import { OrderOperationNotice } from './OrderResolution';
export default function CourierConfirmation({ order, operation, onClose }) {
  const [name, setName] = useState(order.delivery.courierName || '');
  const [fee, setFee] = useState(
    order.delivery.courierFee === undefined
      ? ''
      : String(order.delivery.courierFee)
  );
  const [supported, setSupported] = useState(false),
    [accepted, setAccepted] = useState(false),
    [note, setNote] = useState('');
  return (
    <Modal
      title="Confirm courier delivery"
      busy={operation.busy}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={(event) => {
          event.preventDefault();
          if (operation.blocked || !supported || !accepted || fee === '')
            return;
          operation.perform({
            endpoint: `/orders/${order._id}/delivery/confirm`,
            payload: {
              idempotencyKey: createRequestId(),
              courierName: name.trim(),
              fee: Number(fee),
              recipientPaymentSupported: supported,
              customerAccepted: accepted,
              note: note.trim(),
              revision: order.delivery.revision || 0,
            },
          });
        }}
      >
        <p className="row-meta">
          Agree the actual fee with the courier and customer before preparing
          this order. This fee is paid to the courier and is not added to the
          customer’s online payment.
        </p>
        <Field label="Courier name">
          <input
            className="control"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="Agreed delivery fee (₦)">
          <input
            className="control"
            type="number"
            required
            min="0"
            max="1000000"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
        </Field>
        <label className="check-row">
          <input
            type="checkbox"
            required
            checked={supported}
            onChange={(e) => setSupported(e.target.checked)}
          />
          The courier accepts payment from the recipient on delivery.
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            required
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          The customer accepted this exact courier fee.
        </label>
        <Field
          label="Confirmation note"
          hint="For example: customer agreed by WhatsApp today."
        >
          <input
            className="control"
            required
            minLength={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <OrderOperationNotice operation={operation} />
        <div className="dialog-footer">
          <button
            className="btn"
            type="button"
            disabled={operation.busy}
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="btn btn-primary"
            disabled={operation.blocked || !supported || !accepted}
          >
            {operation.busy ? 'Saving…' : 'Save courier agreement'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
