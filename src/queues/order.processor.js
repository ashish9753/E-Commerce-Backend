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
import { upayaService } from "../services/upaya.service.js";

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

    // --- Step 4: Atomically claim coupon usage ---
    // This is the only place coupon usage is committed. The guarded update
    // means concurrent orders from the same user (or against a globally
    // capped coupon) cannot both succeed — exactly one wins, the other
    // gets a clean "no longer valid" error and the order is rolled back.
    if (couponId) {
      const now = new Date();
      const claim = await Coupon.findOneAndUpdate(
        {
          _id: couponId,
          isActive: true,
          expiryDate: { $gt: now },
          usedBy: { $ne: userId },
          $or: [
            { usageLimit: null },
            { usageLimit: { $exists: false } },
            { $expr: { $lt: ["$usedCount", "$usageLimit"] } },
          ],
        },
        { $inc: { usedCount: 1 }, $addToSet: { usedBy: userId } },
        so({ new: true })
      );
      if (!claim) {
        throw new Error("Coupon is no longer valid or has already been used");
      }
    }

    // --- Step 5: Clear user cart ---
    await Cart.findOneAndUpdate(
      { user: userId },
      { items: [], coupon: null, totalItems: 0, totalPrice: 0, discountAmount: 0, finalPrice: 0 },
      so()
    );


    // --- Step 6: In-app notification for customer ---
    // For unpaid ONLINE orders we surface the deadline + cancel option so the
    // user understands the order is provisional until payment is verified.
    const pendingOnline = paymentMethod === "ONLINE";
    const pendingTimeoutMin = parseInt(process.env.PENDING_ORDER_TIMEOUT_MIN || "30", 10);
    const notifDoc = pendingOnline
      ? {
          user: userId,
          title: "Order Pending Payment ⏳",
          message: `Order ${order.orderNumber} (₹${totalPrice}) is awaiting payment. Please complete it within ${pendingTimeoutMin} minutes from My Orders, or cancel the order.`,
          type: "ORDER",
          link: `/orders`,
        }
      : {
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

    // --- Post-commit: notify employees + admins + low-stock alerts (non-blocking) ---
    setImmediate(async () => {
      try {
        // Notify employees + admins only for COD orders (ONLINE orders notify after payment is verified)
        if (job.data.paymentMethod === "COD") {
          const allEmployees = await Employee.find({}).select("user").lean();
          for (const emp of allEmployees) {
            if (emp.user) {
              await notify({
                userId:  emp.user,
                title:   "New Order Received! 📦",
                message: `Order #${order.orderNumber} has been placed. Please confirm and process it.`,
                type:    "ORDER",
                link:    "/employee",
              });
            }
          }
          await notifyAdmins({
            title:   "New Order Placed 🛒",
            message: `Order #${order.orderNumber} (₹${totalPrice}, COD) was just placed.`,
            type:    "ORDER",
            link:    "/admin",
          });
        }

        // Low-stock alerts (threshold: 5) — notify product owner AND admin
        const productIds = orderItems.map(i => i.product);
        const products   = await Product.find({ _id: { $in: productIds } }).select("employee title stock");
        for (const product of products) {
          if (product.stock <= 5) {
            if (product.employee) {
              await notifyEmployee(product.employee.toString(), {
                title:   `Low Stock Alert ⚠️`,
                message: `"${product.title}" has only ${product.stock} unit${product.stock !== 1 ? "s" : ""} left. Restock soon to avoid missing orders.`,
                type:    "SYSTEM",
                link:    "/employee",
              });
            }
            await notifyAdmins({
              title:   "Low Stock Alert ⚠️",
              message: `"${product.title}" has only ${product.stock} unit${product.stock !== 1 ? "s" : ""} left in stock.`,
              type:    "SYSTEM",
              link:    "/admin",
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
    } else if (decremented.length > 0) {
      // No-transaction mode (dev / standalone Mongo) — manually roll back stock changes.
      // If rollback fails the stock is now inconsistent — surface it loudly so it can
      // be reconciled rather than silently swallowing it.
      try {
        await Product.bulkWrite(
          decremented.map(({ product, quantity }) => ({
            updateOne: {
              filter: { _id: product._id },
              update: { $inc: { stock: quantity, sold: -quantity } },
            },
          }))
        );
      } catch (rollbackErr) {
        console.error(
          "[queue] CRITICAL: stock rollback failed after order error. " +
          "Manual reconciliation required for products:",
          decremented.map(({ product, quantity }) => ({
            productId: product._id.toString(),
            quantityToRestore: quantity,
          })),
          "Rollback error:", rollbackErr.message
        );
      }
    }
    throw err;
  }
};

// ─── Upaya dispatch ────────────────────────────────────────────────────────
// Push the order to Upaya for delivery. Idempotent: if the order has already
// been synced we exit early. Failures are persisted on the order so admin/
// employee can see them and retry. The customer flow is never blocked.
export const dispatchToUpaya = async (orderId) => {
  if (!upayaService.isConfigured()) {
    await Order.findByIdAndUpdate(orderId, {
      upayaSyncStatus: "SKIPPED",
      upayaError: "Upaya API key not configured on server",
    });
    return null;
  }

  const order = await Order.findById(orderId).populate("orderItems.product", "weight");
  if (!order) return null;
  if (order.upayaSyncStatus === "SYNCED" && order.upayaOrderRef) return order.upayaOrderRef;

  const addr = order.shippingAddress || {};
  const areaId = addr.upayaAreaId || addr.upayaLocationId;
  if (!areaId) {
    await Order.findByIdAndUpdate(orderId, {
      upayaSyncStatus: "FAILED",
      upayaError: "Shipping address has no Upaya area selected",
    });
    return null;
  }

  // Roll up cart weight (default 1 kg per item if product weight isn't set).
  const initial_weight = order.orderItems.reduce((sum, it) => {
    const w = Number(it.product?.weight) || 1;
    return sum + w * (it.quantity || 1);
  }, 0) || 1;

  const productDescription = order.orderItems
    .map(it => `${it.title} x${it.quantity}`)
    .join(", ")
    .slice(0, 240);

  const payload = {
    receiver_name:             addr.fullName || "Customer",
    receiver_contact:          addr.phone || "",
    receiver_alternate_number: "",
    area_id:                   Number(areaId),
    product_price:             Number(order.totalPrice) || 0,
    cod_amount:                order.paymentMethod === "COD" ? Number(order.totalPrice) || 0 : 0,
    remarks:                   "",
    receiver_address:          [addr.houseNo, addr.area, addr.city, addr.state].filter(Boolean).join(", "),
    receiver_landmark:         addr.landmark || "",
    order_reference_id:        order.orderNumber,
    initial_weight,
    service_type_id:           3, // Door To Door Delivery
    product_description:       productDescription || "General merchandise",
    length:                    null,
    breadth:                   null,
    height:                    null,
    product_category_id:       5, // Electronics — sensible default for this store
    order_type:                "delivery_order",
    client_note:               `Order from ${process.env.COMPANY_NAME || "TradeEngine"}`,
  };

  await Order.findByIdAndUpdate(orderId, { upayaSyncStatus: "PENDING", upayaError: null });

  try {
    const res = await upayaService.addOrder(payload);
    // Upaya returns { orders: [{ orderNumber, ... }] } or similar — pull the
    // first reference id we can recognise.
    const firstOrder = Array.isArray(res?.orders) ? res.orders[0]
                     : Array.isArray(res?.data?.orders) ? res.data.orders[0]
                     : Array.isArray(res?.data) ? res.data[0]
                     : res?.order || res;
    const upayaRef = firstOrder?.orderNumber || firstOrder?.order_number
                  || firstOrder?.tracking_id || firstOrder?.trackingId
                  || firstOrder?.reference   || null;

    await Order.findByIdAndUpdate(orderId, {
      upayaOrderRef:   upayaRef,
      upayaTrackingId: upayaRef,
      upayaSyncStatus: upayaRef ? "SYNCED" : "FAILED",
      upayaError:      upayaRef ? null : "Upaya response missing order reference",
      upayaSyncedAt:   new Date(),
      ...(upayaRef && !order.trackingId ? { trackingId: upayaRef } : {}),
    });
    return upayaRef;
  } catch (err) {
    await Order.findByIdAndUpdate(orderId, {
      upayaSyncStatus: "FAILED",
      upayaError: err.message || "Upaya dispatch failed",
    });
    return null;
  }
};
