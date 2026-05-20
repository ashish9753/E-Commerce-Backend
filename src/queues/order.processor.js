import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import Cart from "../models/cart.model.js";
import Coupon from "../models/coupon.model.js";
import InventoryLog from "../models/inventoryLog.model.js";
import Notification from "../models/notification.model.js";
import Employee from "../models/employee.model.js";
import { notify, notifyEmployee, notifyAdmins } from "../utils/notify.js";
import { pushToUser } from "../utils/sseClients.js";

/**
 * Queue processor for order placement.
 * Runs with concurrency=1 so stock checks and decrements are serialized —
 * preventing the oversell race condition when multiple users buy the last item.
 *
 * Flow:
 * 1. Atomically verify and decrement stock for every item in one DB operation
 * 2. On any stock failure, roll back already-decremented items
 * 3. Create the order document
 * 4. Log inventory changes
 * 5. Apply coupon usage
 * 6. Clear user cart
 * 7. Send in-app notification
 */
export const processOrderJob = async (job) => {
  const {
    userId,
    orderItems,
    shippingAddress,
    paymentMethod,
    itemsPrice,
    shippingPrice,
    taxPrice,
    taxLabel = "GST",
    discountAmount,
    totalPrice,
    couponId,
    estimatedDeliveryDate,
    codBookingAmount = 0,
    codBookingUtr = "",
    codBookingStatus = "NOT_REQUIRED",
  } = job.data;

  // Standalone MongoDB (no replica set) cannot use transactions.
  // In dev (SKIP_QUEUE=true) we run without sessions; in prod the Bull queue
  // runs this inside a real replica set where transactions are available.
  const useTransaction = process.env.SKIP_QUEUE !== "true";

  let session = null;
  if (useTransaction) {
    session = await mongoose.startSession();
    session.startTransaction();
  }

  const so = (opts) => (session ? { ...opts, session } : opts ?? {});

  const decremented = [];

  try {
    // --- Step 1: Stock check + decrement ---
    for (const item of orderItems) {
      const product = await Product.findOneAndUpdate(
        { _id: item.product, stock: { $gte: item.quantity }, isDeleted: false, isPublished: true },
        { $inc: { stock: -item.quantity, sold: item.quantity } },
        so({ new: true })
      );

      if (!product) {
        const outOfStock = await Product.findById(item.product);
        const reason = !outOfStock || outOfStock.isDeleted
          ? `Product "${item.title}" is no longer available`
          : `"${item.title}" is out of stock. Available: ${outOfStock.stock}, Requested: ${item.quantity}`;
        throw new Error(reason);
      }

      decremented.push({ product, quantity: item.quantity, oldStock: product.stock + item.quantity });
    }

    // --- Step 2: Create Order ---
    const orderDoc = {
      user: userId,
      orderItems,
      shippingAddress,
      paymentMethod,
      paymentStatus: "PENDING",
      itemsPrice,
      shippingPrice,
      taxPrice,
      taxLabel,
      discountAmount,
      totalPrice,
      coupon: couponId || null,
      estimatedDeliveryDate: estimatedDeliveryDate
        ? new Date(estimatedDeliveryDate)
        : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      statusHistory: [{ status: "PLACED", timestamp: new Date() }],
      codBookingAmount,
      codBookingUtr,
      codBookingStatus,
    };

    let order;
    if (session) {
      [order] = await Order.create([orderDoc], { session });
    } else {
      order = await Order.create(orderDoc);
    }

    // --- Step 3: Log inventory changes ---
    const inventoryLogs = decremented.map(({ product, quantity, oldStock }) => ({
      product: product._id,
      order: order._id,
      changeType: "ORDER",
      quantityChanged: -quantity,
      oldStock,
      newStock: product.stock,
      note: `Order ${order.orderNumber} placed`,
      performedBy: userId,
    }));
    await InventoryLog.insertMany(inventoryLogs, so());

    // --- Step 4: Mark coupon as used ---
    if (couponId) {
      await Coupon.findByIdAndUpdate(
        couponId,
        { $inc: { usedCount: 1 }, $addToSet: { usedBy: userId } },
        so()
      );
    }

    // --- Step 5: Clear user cart ---
    await Cart.findOneAndUpdate(
      { user: userId },
      { items: [], coupon: null, totalItems: 0, totalPrice: 0, discountAmount: 0, finalPrice: 0 },
      so()
    );

    // --- Step 6: In-app notification for customer ---
    const notifDoc = {
      user: userId,
      title: "Order Placed Successfully! 🎉",
      message: `Your order ${order.orderNumber} has been placed. Total: ₹${totalPrice}. We'll notify you as it moves through fulfilment.`,
      type: "ORDER",
      link: `/track?id=${order._id}`,
    };
    if (session) {
      await Notification.create([notifDoc], { session });
    } else {
      await Notification.create(notifDoc);
    }
    // SSE push to customer
    pushToUser(userId.toString(), { type: "notification", notification: notifDoc });

    if (session) {
      await session.commitTransaction();
      session.endSession();
    }

    // --- Post-commit: notify employees + low-stock alerts (non-blocking) ---
    setImmediate(async () => {
      try {
        // Find unique employees for this order's products
        const productIds = orderItems.map(i => i.product);
        const products   = await Product.find({ _id: { $in: productIds } }).select("employee title stock");
        const employeeIds  = [...new Set(products.map(p => p.employee?.toString()).filter(Boolean))];

        for (const employeeId of employeeIds) {
          await notifyEmployee(employeeId, {
            title:   "New Order Received! 📦",
            message: `Order #${order.orderNumber} has been placed for your product(s). Please confirm and process it.`,
            type:    "ORDER",
            link:    "/employee",
          });
        }

        // Low-stock alerts (threshold: 5)
        for (const product of products) {
          if (product.stock <= 5 && product.employee) {
            await notifyEmployee(product.employee, {
              title:   `Low Stock Alert ⚠️`,
              message: `"${product.title}" has only ${product.stock} unit${product.stock !== 1 ? "s" : ""} left. Restock soon to avoid missing orders.`,
              type:    "SYSTEM",
              link:    "/employee",
            });
          }
        }
      } catch { /* non-critical */ }
    });

    return { orderId: order._id.toString(), orderNumber: order.orderNumber };
  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    throw err;
  }
};
