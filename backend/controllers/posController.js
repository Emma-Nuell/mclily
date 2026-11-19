import PhysicalSale from '../models/PhysicalSale.js';
import { asyncHandler } from '../middlewares/errorMiddleware.js';
import { AppError } from '../utils/AppError.js';
import { priceItems, moveInventory } from '../services/inventoryService.js';
import {
  idempotentTransaction,
  requestKey,
} from '../services/idempotencyService.js';
import {
  attachCreditSale,
  adoptLegacyCreditSale,
  reduceCredit,
  creditRetryOptions,
} from '../services/creditLedgerService.js';
import { toKobo, naira } from '../utils/creditMoney.js';

function money(value) {
  return naira(toKobo(value));
}

function paymentMethod(value) {
  if (value === undefined) return undefined;
  if (!['cash', 'transfer', 'pos_terminal'].includes(value))
    throw new AppError(
      400,
      'INVALID_PAYMENT_METHOD',
      'Choose cash, bank transfer or card terminal.'
    );
  return value;
}

export const recordPosSale = asyncHandler(async (req, res) => {
  const key = requestKey(req);
  const payload = {
    ...req.body,
    idempotencyKey: undefined,
    actor: String(req.user._id),
  };
  const result = await idempotentTransaction(
    `POS_${key}`,
    'POS_SALE',
    payload,
    async (session) => {
      const {
        customerName,
        customerPhone,
        items,
        paymentType = 'full',
      } = req.body;
      const method = paymentMethod(req.body.paymentMethod);
      if (!['full', 'credit_installment'].includes(paymentType))
        throw new AppError(
          400,
          'INVALID_PAYMENT_TYPE',
          'Choose full payment or credit.'
        );
      if (
        paymentType !== 'full' &&
        (!customerName?.trim() || !customerPhone?.trim())
      ) {
        throw new AppError(
          400,
          'CUSTOMER_REQUIRED',
          'Credit sales require the customer name and phone number.'
        );
      }
      const priced = await priceItems(items, session, { minimumYards: 0.5 });
      const totalAmount =
        Math.round(priced.reduce((sum, item) => sum + item.subtotal, 0) * 100) /
        100;
      const amountPaid =
        req.body.amountPaid === undefined
          ? paymentType === 'full'
            ? totalAmount
            : 0
          : money(req.body.amountPaid);
      if (
        amountPaid > totalAmount ||
        (paymentType === 'full' && amountPaid !== totalAmount)
      ) {
        throw new AppError(
          400,
          'INVALID_AMOUNT',
          'The payment must match this sale or its agreed credit deposit.'
        );
      }
      const balanceDue = Math.round((totalAmount - amountPaid) * 100) / 100;
      await moveInventory(priced, 'sell', session, {
        source: `POS_${key}`,
        actor: String(req.user._id),
      });
      const [sale] = await PhysicalSale.create(
        [
          {
            customerName: customerName?.trim() || 'Walk-in Customer',
            customerPhone: customerPhone?.trim() || undefined,
            items: priced,
            totalAmount,
            amountPaid,
            initialAmountPaid: amountPaid,
            balanceDue,
            paymentMethod: method,
            paymentType: balanceDue > 0 ? 'credit_installment' : 'full',
            recordedBy: req.user._id,
            installmentHistory:
              amountPaid > 0
                ? [
                    {
                      amount: amountPaid,
                      date: new Date(),
                      paymentMethod: method,
                      note:
                        paymentType === 'full'
                          ? 'Full payment received'
                          : 'Initial installment',
                      receivedBy: req.user.fullName || 'Admin',
                    },
                  ]
                : [],
          },
        ],
        { session }
      );
      await attachCreditSale(
        sale,
        req.user,
        session,
        req.body.customerAccountId
      );
      return sale.toObject();
    },
    creditRetryOptions
  );
  res
    .status(result.replayed ? 200 : 201)
    .json({
      success: true,
      message: result.replayed
        ? 'Sale already recorded'
        : 'Sale recorded and stock updated',
      data: result.data,
    });
});

/**
 * @desc   Fetch POS sales history
 * @route  GET /api/pos/sales
 * @access Admin / Sales Staff only
 */
export const getPosSales = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const skip = (page - 1) * limit;

  const [total, sales] = await Promise.all([
    PhysicalSale.countDocuments(),
    PhysicalSale.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('recordedBy', 'fullName email'),
  ]);

  res.status(200).json({
    success: true,
    total,
    page,
    pages: Math.ceil(total / limit) || 1,
    data: sales,
  });
});

export const recordInstallment = asyncHandler(async (req, res) => {
  const key = requestKey(req);
  const payload = {
    sale: req.params.id,
    amount: req.body.amount,
    note: req.body.note || '',
    paymentMethod: req.body.paymentMethod,
    actor: String(req.user._id),
  };
  const result = await idempotentTransaction(
    `INSTALLMENT_${key}`,
    'POS_INSTALLMENT',
    payload,
    async (session) => {
      const amount = money(req.body.amount);
      const method = paymentMethod(req.body.paymentMethod);
      if (amount <= 0)
        throw new AppError(
          400,
          'INVALID_AMOUNT',
          'Enter a payment greater than zero.'
        );
      const sale = await PhysicalSale.findById(req.params.id).session(session);
      if (!sale) throw new AppError(404, 'SALE_NOT_FOUND', 'Sale not found.');
      if (amount > sale.balanceDue)
        throw new AppError(
          409,
          'PAYMENT_EXCEEDS_BALANCE',
          'This payment exceeds the remaining balance. Refresh the customer balance.'
        );
      const account = await adoptLegacyCreditSale(sale, req.user, session);
      await reduceCredit(
        account,
        toKobo(amount),
        'payment',
        {
          key: `INSTALLMENT_${key}`,
          paymentMethod: method,
          reason: req.body.note || 'Payment received on receipt',
          sale: sale._id,
          receiptNumber: sale.receiptNumber,
        },
        req.user,
        session,
        sale
      );
      return sale.toObject();
    },
    creditRetryOptions
  );
  res
    .status(200)
    .json({
      success: true,
      message: result.replayed
        ? 'Payment already recorded'
        : 'Payment recorded',
      data: result.data,
    });
});
