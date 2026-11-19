import mongoose from "mongoose";
import env from "./env.js";
import EmailOutbox from "../models/EmailOutbox.js";
import NotificationState from "../models/NotificationState.js";
import PaymentCollection from "../models/PaymentCollection.js";
import User from "../models/User.js";
import { telegramModels } from "../models/Telegram.js";
import Product from "../models/Product.js";
import InventoryMovement from "../models/InventoryMovement.js";
import OrderAction from "../models/OrderAction.js";
import IdempotencyLog from "../models/IdempotencyLog.js";
import Order from "../models/Order.js";
import PhysicalSale from "../models/PhysicalSale.js";
import CreditEntry from "../models/CreditEntry.js";
import CreditAccount from "../models/CreditAccount.js";
import OrderRefund from "../models/OrderRefund.js";

let isReplicaSet = false;

export const connectDatabase = async ({ initializeIndexes = true } = {}) => {
  try {
    if (
      env.NODE_ENV === "test" &&
      !/\/(mcl_test_[a-z0-9_]+)(\?|$)/i.test(env.MONGODB_URI)
    ) {
      throw new Error(
        "Integration tests require an explicit isolated mcl_test_* database URI.",
      );
    }
    const conn = await mongoose.connect(env.MONGODB_URI, {
      maxPoolSize: 20,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      autoIndex: initializeIndexes,
      autoCreate: initializeIndexes,
    });

    console.log(
      `✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`,
    );
    if (initializeIndexes)
      for (const model of [
        EmailOutbox,
        NotificationState,
        PaymentCollection,
        User,
        Product,
        InventoryMovement,
        OrderAction,
        IdempotencyLog,
        Order,
        PhysicalSale,
        CreditEntry,
        CreditAccount,
        OrderRefund,
        ...telegramModels,
      ])
        await model.init();

    // Check transaction / replica set availability (Checklist 1.1.6)
    try {
      const adminDb = conn.connection.db.admin();
      const hello = await adminDb.command({ hello: 1 });
      isReplicaSet = Boolean(hello.setName || hello.msg === "isdbgrid");
      if (isReplicaSet) {
        console.log(
          "🔄 MongoDB Replica Set active: Multi-document transactions enabled.",
        );
      } else {
        console.warn(
          "Standalone MongoDB: financial transactions are disabled; use a replica set.",
        );
      }
    } catch {
      // In restricted Atlas or container environments, fallback gracefully
      isReplicaSet = false;
    }
    if (!isReplicaSet && env.NODE_ENV === "production")
      throw new Error(
        "Production requires a MongoDB replica set for financial transactions.",
      );

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB Connection Error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️ MongoDB disconnected. Attempting reconnect...");
    });

    return conn;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error.message);
    throw error;
  }
};

export const canUseTransactions = () => isReplicaSet;

export const closeDatabase = async () => {
  await mongoose.connection.close();
};

export default connectDatabase;
