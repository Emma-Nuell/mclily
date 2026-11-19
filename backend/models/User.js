import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      sparse: true,
      index: true,
      match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['customer', 'admin', 'superadmin', 'sales_staff'],
      default: 'customer',
      index: true,
    },
    addresses: [
      {
        label: { type: String, default: 'Home' },
        street: { type: String, required: true },
        city: { type: String, required: true },
        state: { type: String, required: true },
        isDefault: { type: Boolean, default: false },
      },
    ],
    wishlist: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
    ],
    authVersion: { type: Number, default: 0 },
    telegramId: { type: String, match: /^[1-9]\d{0,15}$/ },
    resetTokenHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    resetRequestedAt: { type: Date, select: false },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { name: 'unique_email_identity', unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ telegramId: 1 }, { name: 'unique_telegram_admin', unique: true, partialFilterExpression: { telegramId: { $type: 'string' } } });
// Hash password before saving
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare entered password with hashed password
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

export const User = mongoose.model('User', userSchema);
export default User;
