import mongoose from 'mongoose';
const schema = new mongoose.Schema(
  { _id: String, nextRunAt: Date, leaseToken: String, leaseUntil: Date },
  { timestamps: true }
);
export default mongoose.model('NotificationState', schema);
