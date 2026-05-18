import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import Cart from "../models/cart.model.js";
import Coupon from "../models/coupon.model.js";
import InventoryLog from "../models/inventoryLog.model.js";
import Notification from "../models/notification.model.js";

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
    discountAmount,
    totalPrice,
    couponId,
    estimatedDeliveryDate,
  } = job.data;

  const session = await mongoose.startSession();
  session.startTransaction();

  const decremented = [];

  try {
    // --- Step 1: Atomic stock check + decrement (one at a time, serialized by queue) ---
    for (const item of orderItems) {
      const product = await Product.findOneAndUpdate(
        {
          _id: item.product,
          stock: { $gte: item.quantity },
          isDeleted: false,
          isPublished: true,
        },
        { $inc: { stock: -item.quantity, sold: item.quantity } },
        { new: true, session }
      );

      if (!product) {
        // Could not decrement — either out of stock or product unavailable
        const outOfStock = await Product.findById(item.product).session(session);
        const reason = !outOfStock || outOfStock.isDeleted
          ? `Product "${item.title}" is no longer available`
          : `"${item.title}" is out of stock. Available: ${outOfStock.stock}, Requested: ${item.quantity}`;

        throw new Error(reason);
      }

      decremented.push({ product, quantity: item.quantity, oldStock: product.stock + item.quantity });
    }

    // --- Step 2: Create Order ---
    const [order] = await Order.create(
      [
        {
          user: userId,
          orderItems,
          shippingAddress,
          paymentMethod,
          paymentStatus: paymentMethod === "COD" ? "PENDING" : "PENDING",
          itemsPrice,
          shippingPrice,
          taxPrice,
          discountAmount,
          totalPrice,
          coupon: couponId || null,
          estimatedDeliveryDate: estimatedDeliveryDate
            ? new Date(estimatedDeliveryDate)
            : new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
          statusHistory: [{ status: "PLACED", timestamp: new Date() }],
        },
      ],
      { session }
    );

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
    await InventoryLog.insertMany(inventoryLogs, { session });

    // --- Step 4: Mark coupon as used ---
    if (couponId) {
      await Coupon.findByIdAndUpdate(
        couponId,
        { $inc: { usedCount: 1 }, $addToSet: { usedBy: userId } },
        { session }
      );
    }

    // --- Step 5: Clear user cart ---
    await Cart.findOneAndUpdate(
      { user: userId },
      {
        items: [],
        coupon: null,
        totalItems: 0,
        totalPrice: 0,
        discountAmount: 0,
        finalPrice: 0,
      },
      { session }
    );

    // --- Step 6: In-app notification ---
    await Notification.create(
      [
        {
          user: userId,
          title: "Order Placed Successfully!",
          message: `Your order ${order.orderNumber} has been placed. Total: ₹${totalPrice}`,
          type: "ORDER",
          link: `/orders/${order._id}`,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return { orderId: order._id.toString(), orderNumber: order.orderNumber };
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
};
