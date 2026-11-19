import mongoose from 'mongoose';
const { Schema } = mongoose;
const update = new Schema(
  {
    key: { type: String, required: true, unique: true },
    bot: { type: String, required: true },
    updateId: { type: Number, required: true },
    hash: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    chat: { type: String, required: true },
    payload: { type: String, required: true, select: false },
    prepared: { type: String, select: false },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'review', 'discarded'],
      default: 'pending',
    },
    lease: String,
    leaseUntil: Date,
    errorCode: String,
    reviewReason: String,
  },
  { timestamps: true }
);
update.index({ bot: 1, status: 1, createdAt: 1 });
const draft = new Schema(
  {
    bot: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    chat: { type: String, required: true },
    status: {
      type: String,
      enum: ['active', 'saved', 'cancelled'],
      default: 'active',
    },
    revision: { type: Number, default: 1 },
    expiresAt: { type: Date, required: true },
    facts: { type: Schema.Types.Mixed, default: {} },
    images: { type: [String], default: [] },
    needsConfirmation: { type: Boolean, default: false },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
  },
  { timestamps: true }
);
draft.index({ bot: 1, user: 1, status: 1 });
const reply = new Schema(
  {
    key: { type: String, required: true, unique: true },
    bot: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, required: true, ref: 'User' },
    chat: { type: String, required: true },
    payload: { type: String, required: true, select: false },
    status: {
      type: String,
      enum: ['pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled'],
      default: 'pending',
    },
    lease: String,
    leaseUntil: Date,
    errorCode: String,
  },
  { timestamps: true }
);
reply.index({ bot: 1, status: 1, createdAt: 1 });
const usage = new Schema(
  {
    month: { type: String, required: true, unique: true },
    requests: { type: Number, default: 0 },
    reservedKobo: { type: Number, default: 0 },
    warned: { type: Boolean, default: false },
    stopped: { type: Boolean, default: false },
  },
  { timestamps: true }
);
const invocation = new Schema(
  {
    key: { type: String, required: true, unique: true },
    month: String,
    reserveKobo: Number,
    status: {
      type: String,
      enum: ['reserved', 'completed', 'uncertain'],
      default: 'reserved',
    },
    result: { type: String, select: false },
    inputTokens: Number,
    outputTokens: Number,
  },
  { timestamps: true }
);
// Deliberately no TTL on deduplication records or unreviewed deliveries.
export const TelegramUpdate = mongoose.model('TelegramUpdate', update);
export const TelegramDraft = mongoose.model('TelegramDraft', draft);
export const TelegramReply = mongoose.model('TelegramReply', reply);
export const AIUsage = mongoose.model('AIUsage', usage);
export const AIInvocation = mongoose.model('AIInvocation', invocation);
export const TelegramCursor = mongoose.model(
  'TelegramCursor',
  new Schema(
    {
      bot: { type: String, required: true, unique: true },
      offset: { type: Number, default: 0 },
      lease: String,
      leaseUntil: { type: Date, default: () => new Date(0) },
    },
    { timestamps: true }
  )
);
export const telegramModels = [
  TelegramUpdate,
  TelegramDraft,
  TelegramReply,
  AIUsage,
  AIInvocation,
  TelegramCursor,
];
