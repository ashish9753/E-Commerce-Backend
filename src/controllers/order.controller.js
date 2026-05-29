import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import User from "../models/user.model.js";
import Coupon from "../models/coupon.model.js";
import DeliveryArea from "../models/deliveryArea.model.js";
import { computeCouponEligibility } from "../utils/couponEligibility.utils.js";
import Employee from "../models/employee.model.js";
import { notify, notifyEmployee, notifyAdmins } from "../utils/notify.js";
import { sendEmail, orderConfirmationEmail } from "../utils/email.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import { validateCouponAudience } from "../utils/couponAudience.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { upayaService } from "../services/upaya.service.js";
import { dispatchToUpaya } from "../queues/order.processor.js";

const ORDER_STATUS_MESSAGES = {
  CONFIRMED:        { title: "Order Confirmed ✅",          message: "Your order has been confirmed and is being prepared." },
  PACKED:           { title: "Order Packed 📦",             message: "Your order has been packed and is ready for dispatch." },
  SHIPPED:          { title: "Order Shipped 🚚",            message: "Your order is on its way!" },
  OUT_FOR_DELIVERY: { title: "Out for Delivery 🛵",         message: "Your order is out for delivery. Expect it today!" },
  DELIVERED:        { title: "Order Delivered 🎉",          message: "Your order has been delivered. Enjoy your purchase!" },
  CANCELLED:        { title: "Order Cancelled ❌",          message: "Your order has been cancelled." },
  RETURNED:         { title: "Return Initiated ↩️",         message: "Your return has been initiated." },
};

const SHIPPING_THRESHOLD = 500;
const SHIPPING_PRICE = 50;

const VALID_ORDER_STATUSES = [
  "PLACED", "CONFIRMED", "PACKED", "SHIPPED",
  "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED",
];
const VALID_PAYMENT_STATUSES = ["PENDING", "PAID", "FAILED", "REFUNDED"];

const ORDER_STATUS_RANK = {
  PLACED: 0,
  CONFIRMED: 1,
  PACKED: 2,
  SHIPPED: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
};

const UPAYA_STATUS_MAP = [
  { status: "DELIVERED",        patterns: ["DELIVERED", "COMPLETED", "SUCCESSFUL DELIVERY"] },
  { status: "OUT_FOR_DELIVERY", patterns: ["OUT FOR DELIVERY", "OUT_FOR_DELIVERY", "OFD"] },
  { status: "SHIPPED",          patterns: ["PICKED", "PICKED UP", "DISPATCHED", "IN TRANSIT", "IN_TRANSIT", "ON THE WAY", "SHIPPED"] },
  { status: "PACKED",           patterns: ["READY FOR PICKUP", "READY_TO_PICKUP", "READY FOR DISPATCH", "ASSIGNED"] },
  { status: "CONFIRMED",        patterns: ["ORDER CREATED", "CREATED", "BOOKED", "RECEIVED", "CONFIRMED"] },
  { status: "CANCELLED",        patterns: ["CANCELLED", "CANCELED"] },
];

const getNested = (obj, path) => path.split(".").reduce((cur, key) => cur?.[key], obj);

const extractUpayaStatus = (tracking) => {
  const candidates = [
    "status",
    "current_status",
    "currentStatus",
    "delivery_status",
    "deliveryStatus",
    "order_status",
    "orderStatus",
    "tracking.status",
    "tracking.current_status",
    "tracking.currentStatus",
    "data.status",
    "data.current_status",
    "data.currentStatus",
  ];

  for (const path of candidates) {
    const value = getNested(tracking, path);
    if (value) return String(value);
  }
  return "";
};

const mapUpayaStatusToOrderStatus = (tracking) => {
  const raw = extractUpayaStatus(tracking).trim();
  if (!raw) return null;

  const normalised = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").toUpperCase();
  return UPAYA_STATUS_MAP.find(({ patterns }) => patterns.some(pattern => normalised.includes(pattern)))?.status || null;
};

const shouldAdvanceOrderStatus = (currentStatus, nextStatus) => {
  if (!nextStatus || currentStatus === nextStatus) return false;
  if (["CANCELLED", "RETURNED"].includes(currentStatus)) return false;
  if (nextStatus === "CANCELLED") return currentStatus !== "DELIVERED";
  return (ORDER_STATUS_RANK[nextStatus] ?? -1) > (ORDER_STATUS_RANK[currentStatus] ?? -1);
};

const applyOrderStatusSideEffects = (order, status) => {
  if (status === "DELIVERED") {
    order.deliveredAt = order.deliveredAt || new Date();
    order.paymentStatus = "PAID";
    order.paidAt = order.paidAt || new Date();
  }
};

const notifyCustomerForOrderStatus = async (order, status, note = "") => {
  const msg = ORDER_STATUS_MESSAGES[status];
  if (!msg) return;

  await notify({
    userId:  order.user,
    title:   msg.title,
    message: msg.message + (note ? ` Note: ${note}` : ""),
    type:    "ORDER",
    link:    `/track?id=${order._id}`,
  });
};

const syncOrderStatusFromUpayaTracking = async (order, tracking) => {
  const nextStatus = mapUpayaStatusToOrderStatus(tracking);
  if (!shouldAdvanceOrderStatus(order.orderStatus, nextStatus)) {
    return { updated: false, status: order.orderStatus, upayaStatus: extractUpayaStatus(tracking) || null };
  }

  const note = `Auto-synced from Upaya tracking${extractUpayaStatus(tracking) ? `: ${extractUpayaStatus(tracking)}` : ""}`;
  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, note, timestamp: new Date() });
  applyOrderStatusSideEffects(order, nextStatus);
  await order.save();
  await notifyCustomerForOrderStatus(order, nextStatus, note);

  return { updated: true, status: nextStatus, upayaStatus: extractUpayaStatus(tracking) || null };
};

const dispatchToUpayaForFulfillment = async (order) => {
  if (!["CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY"].includes(order.orderStatus)) {
    return { dispatched: false, ref: null };
  }

  const alreadySynced = order.upayaSyncStatus === "SYNCED" && order.upayaOrderRef;
  const ref = alreadySynced ? order.upayaOrderRef : await dispatchToUpaya(order._id);
  const fresh = await Order.findById(order._id);
  if (!fresh) return { dispatched: false, ref };

  if (ref && shouldAdvanceOrderStatus(fresh.orderStatus, "SHIPPED")) {
    fresh.orderStatus = "SHIPPED";
    fresh.trackingId = fresh.trackingId || ref;
    fresh.statusHistory.push({
      status: "SHIPPED",
      note: `Shipment created on Upaya. Tracking ref: ${ref}`,
      timestamp: new Date(),
    });
    await fresh.save();
    await notifyCustomerForOrderStatus(fresh, "SHIPPED", `Tracking ref: ${ref}`);
  }

  return { dispatched: !!ref && !alreadySynced, ref };
};

/**
 * Place Order — Uses Bull queue to serialize concurrent purchase requests.
 * If 2 users click Buy at the same moment for the last item,
 * the queue ensures only one succeeds; the other gets an Out of Stock error.
 */
export const placeOrder = async (req, res, next) => {
  try {
    const { shippingAddressId, paymentMethod, useCart = true, directItem, codBookingUtr } = req.body;

    if (!shippingAddressId || !paymentMethod) {
      throw new ApiError(400, "shippingAddressId and paymentMethod are required");
    }
    if (!["COD", "ONLINE"].includes(paymentMethod)) {
      throw new ApiError(400, "paymentMethod must be COD or ONLINE");
    }

    // Resolve shipping address
    const user = req.user;
    const address = user.addresses.id(shippingAddressId);
    if (!address) throw new ApiError(404, "Shipping address not found");

    let rawItems = [];

    if (useCart) {
      const cart = await Cart.findOne({ user: user._id }).populate("coupon");
      if (!cart || cart.items.length === 0) throw new ApiError(400, "Cart is empty");
      rawItems = cart.items;
    } else {
      // Buy Now — single item without adding to cart
      if (!directItem?.productId || !directItem?.quantity) {
        throw new ApiError(400, "directItem.productId and directItem.quantity required for Buy Now");
      }
      if (!/^[0-9a-fA-F]{24}$/.test(String(directItem.productId))) {
        throw new ApiError(400, "Invalid productId");
      }
      const qty = parseInt(directItem.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
        throw new ApiError(400, "Quantity must be between 1 and 50");
      }
      rawItems = [{ product: directItem.productId, quantity: qty }];
    }

    // Build order items with current prices.
    // We also collect a parallel `itemsForCoupon` list that carries brand +
    // category — needed so coupon eligibility can be evaluated identically for
    // Cart and Buy Now paths.
    const orderItems = [];
    const itemsForCoupon = [];
    let itemsPrice = 0;

    for (const item of rawItems) {
      const productId = item.product._id || item.product;
      const product = await Product.findOne({ _id: productId, isDeleted: false, isPublished: true });
      if (!product) throw new ApiError(404, `Product ${productId} not found`);
      if (product.stock < item.quantity) {
        throw new ApiError(400, `"${product.title}" — only ${product.stock} units in stock`);
      }

      const price = product.discountPrice || product.price;
      const itemTotal = price * item.quantity;
      itemsPrice += itemTotal;
      orderItems.push({
        product: product._id,
        title: product.title,
        image: product.images[0] || "",
        quantity: item.quantity,
        price,
      });
      itemsForCoupon.push({
        product: { brand: product.brand, category: product.category },
        price,
        quantity: item.quantity,
      });
    }

    // Shipping calculation — in priority order:
    //   1. Custom DeliveryArea entry matching the address's city (admin's
    //      "Custom / Fallback Delivery Areas" panel) — exact, case-insensitive
    //   2. Upaya live rate when the address has an upayaLocationId
    //   3. Subtotal-threshold default (free over Rs. SHIPPING_THRESHOLD)
    let shippingPrice;
    const addrCity = address.city?.trim();
    if (addrCity) {
      const area = await DeliveryArea.findOne({
        city: { $regex: `^${addrCity}$`, $options: "i" },
        isActive: true,
      }).select("deliveryCharge");
      if (area) shippingPrice = Number(area.deliveryCharge) || 0;
    }
    if (shippingPrice === undefined && address.upayaLocationId) {
      try {
        const rateResp = await upayaService.rate({
          location_id: address.upayaLocationId,
          initial_weight: 1,
          service_type_id: 3,
          order_type: "delivery_order",
        });
        const r = rateResp?.data?.rate || rateResp?.rate || rateResp;
        const charge = Number(r?.total ?? r?.amount ?? r?.rate ?? r?.deliveryCharge);
        if (Number.isFinite(charge) && charge >= 0) shippingPrice = charge;
      } catch { /* fall through to default */ }
    }
    if (shippingPrice === undefined) {
      shippingPrice = itemsPrice >= SHIPPING_THRESHOLD ? 0 : SHIPPING_PRICE;
    }

    // Coupon discount — applies to BOTH Cart and Buy Now flows.
    // Resolution order:
    //   1. Explicit `couponCode` in the request body (Buy Now from PDP).
    //   2. The user's cart-level coupon (cart checkout, or Buy Now without an
    //      explicit code).
    // We always re-validate against the actual items being purchased
    // (`itemsForCoupon`) so the server math is correct regardless of what the
    // client sent.
    let discountAmount = 0;
    let couponId = null;

    let coupon = null;
    const rawCode = typeof req.body?.couponCode === "string" ? req.body.couponCode.trim().toUpperCase() : null;
    if (rawCode && /^[A-Z0-9_-]{2,32}$/.test(rawCode)) {
      coupon = await Coupon.findOne({ code: rawCode }).populate("freebieProduct", "title images stock price discountPrice isDeleted isPublished");
      if (!coupon) {
        throw new ApiError(400, `Coupon "${rawCode}" is not valid.`);
      }
    } else {
      const userCart = await Cart.findOne({ user: user._id });
      if (userCart?.coupon) {
        coupon = await Coupon.findById(userCart.coupon).populate("freebieProduct", "title images stock price discountPrice isDeleted isPublished");
        if (!coupon) {
          throw new ApiError(400, "The coupon on your cart no longer exists. Please remove it and try again.");
        }
      }
    }

    if (coupon) {
      const validity = coupon.isValid(itemsPrice, user._id);
      if (!validity.valid) {
        throw new ApiError(400, `Coupon "${coupon.code}" cannot be applied: ${validity.message}.`);
      }
      const audience = await validateCouponAudience(coupon, user._id);
      if (!audience.valid) {
        throw new ApiError(400, `Coupon "${coupon.code}" cannot be applied: ${audience.message}.`);
      }
      const { applicableAmount, hasRestrictions } = await computeCouponEligibility(coupon, itemsForCoupon);
      if (hasRestrictions && applicableAmount <= 0) {
        throw new ApiError(400, `Coupon "${coupon.code}" is not applicable to the item(s) you're buying.`);
      }
      discountAmount = coupon.calculateDiscount(applicableAmount);
      couponId = coupon._id;

      // FREEBIE: append the gift product as a Rs. 0 line item. The queue
      // processor will decrement its stock alongside the paid items, so we
      // verify stock here too — same shape as the customer-facing check.
      if (coupon.discountType === "FREEBIE") {
        const fp  = coupon.freebieProduct;
        const fQty = coupon.freebieQuantity || 1;
        if (!fp || fp.isDeleted || !fp.isPublished) {
          throw new ApiError(400, `Coupon "${coupon.code}": the free gift is no longer available.`);
        }
        if ((fp.stock ?? 0) < fQty) {
          throw new ApiError(400, `Coupon "${coupon.code}": the free gift is out of stock.`);
        }
        // Make sure customer isn't already buying the same item — avoid
        // double-decrementing stock on top of the paid copy.
        const existing = orderItems.find((it) => String(it.product) === String(fp._id));
        if (existing) {
          existing.quantity += fQty; // bundle it onto the paid line
          // price stays at paid rate; the "free" copies are absorbed via
          // discountAmount adjustment below
          discountAmount = parseFloat((discountAmount + existing.price * fQty).toFixed(2));
        } else {
          orderItems.push({
            product:  fp._id,
            title:    fp.title,
            image:    fp.images?.[0] || "",
            quantity: fQty,
            price:    0,
            isFreebie: true,
          });
        }
      }

      // FREE_SHIPPING: waive the shipping fee for this order.
      if (coupon.discountType === "FREE_SHIPPING") {
        shippingPrice = 0;
      }
    }

    const totalPrice = parseFloat((itemsPrice + shippingPrice - discountAmount).toFixed(2));

    // Order limits + COD eligibility + booking
    let codBookingAmount = 0;
    let codBookingStatus = "NOT_REQUIRED";
    {
      const Settings = (await import("../models/settings.model.js")).default;
      const settingsDoc = await Settings.findOne({ key: "codBooking" });
      const cfg = settingsDoc?.value ?? {};

      // COD-specific checks (min/max apply to COD only)
      if (paymentMethod === "COD") {
        const minAmt = cfg.minOrderAmount || 0;
        const maxAmt = cfg.maxOrderAmount || 0;
        if (minAmt > 0 && totalPrice < minAmt) {
          throw new ApiError(400, `COD requires a minimum order of Rs. ${minAmt}.`);
        }
        if (maxAmt > 0 && totalPrice > maxAmt) {
          throw new ApiError(400, `COD is not available for orders above Rs. ${maxAmt}.`);
        }
        // support both old `enabled` field and new `codEnabled` field
        const codEnabled = cfg.codEnabled ?? cfg.enabled ?? true;
        if (codEnabled === false) {
          throw new ApiError(400, "Cash on Delivery is currently unavailable.");
        }
        if (cfg.bookingEnabled) {
          codBookingAmount = cfg.bookingType === "percent"
            ? parseFloat(((totalPrice * cfg.bookingValue) / 100).toFixed(2))
            : cfg.bookingValue;
          codBookingStatus = codBookingUtr ? "PAID" : "PENDING";
        }
      }
    }

    const jobData = {
      userId: user._id.toString(),
      orderItems,
      shippingAddress: address.toObject(),
      paymentMethod,
      itemsPrice,
      shippingPrice,
      discountAmount,
      totalPrice,
      couponId: couponId?.toString() || null,
      codBookingAmount,
      codBookingUtr: codBookingUtr || "",
      codBookingStatus,
    };

    let result;
    if (process.env.SKIP_QUEUE === "true") {
      // Dev mode: process order directly without Redis/Bull
      const { processOrderJob } = await import("../queues/order.processor.js");
      result = await processOrderJob({ data: jobData });
    } else {
      const { default: orderQueue } = await import("../queues/order.queue.js");
      const job = await orderQueue.add(jobData);
      result = await job.finished();
    }

    // Fetch full order to return
    const order = await Order.findById(result.orderId)
      .populate("orderItems.product", "title images")
      .populate("coupon", "code discountType discountValue");

    // Send confirmation email asynchronously (non-blocking)
    sendEmail(orderConfirmationEmail(order, user)).catch(() => {});

    res.status(201).json(new ApiResponse(201, { order }, "Order placed successfully"));
  } catch (err) {
    // Provide clean error message from queue processor
    if (err.message?.includes("out of stock") || err.message?.includes("not available")) {
      return next(new ApiError(409, err.message));
    }
    if (err.message?.startsWith("Coupon")) {
      return next(new ApiError(400, err.message));
    }
    next(err);
  }
};

export const getMyOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { user: req.user._id };
    if (req.query.status && VALID_ORDER_STATUSES.includes(req.query.status)) {
      filter.orderStatus = req.query.status;
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("orderItems.product", "title images returnable returnWindow")
        .populate("coupon", "code")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Order.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(orders, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate("orderItems.product", "title images price")
      .populate("coupon", "code discountType discountValue")
      .populate("user", "name email phone");

    if (!order) throw new ApiError(404, "Order not found");

    const isOwner = order.user._id.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "admin") throw new ApiError(403, "Access denied");

    res.json(new ApiResponse(200, { order }));
  } catch (err) {
    next(err);
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const reasonRaw = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 500) : "";
    const refundMethodRaw = req.body?.refundMethod;
    const bankDetailsRaw  = req.body?.bankDetails;
    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");

    const isOwner    = order.user.toString() === req.user._id.toString();
    const isStaff    = req.user.role === "admin" || req.user.role === "employee";
    if (!isOwner && !isStaff) throw new ApiError(403, "Access denied");

    // Customers can only cancel while the order is still PLACED. Once the
    // order is CONFIRMED the shipment is booked on Upaya, so only staff
    // (admin/employee) can cancel from there. Staff can still cancel up to
    // CONFIRMED via this endpoint.
    const customerCancelable = ["PLACED"];
    const staffCancelable    = ["PLACED", "CONFIRMED"];
    const cancelableStatuses = isStaff ? staffCancelable : customerCancelable;
    if (!cancelableStatuses.includes(order.orderStatus)) {
      throw new ApiError(400, `Cannot cancel order in '${order.orderStatus}' status`);
    }

    const reason = reasonRaw || "Cancelled by user";
    order.orderStatus = "CANCELLED";
    order.cancellationReason = reason;
    order.statusHistory.push({ status: "CANCELLED", note: reason });

    // Non-refundable COD booking deposit (if any) — deducted from refund amount
    const nonRefundable = (order.codBookingStatus === "PAID" && order.codBookingAmount > 0)
      ? order.codBookingAmount : 0;
    const refundable = Math.max(0, (order.totalPrice || 0) - nonRefundable);

    if (order.paymentStatus === "PAID" || (order.paymentMethod === "COD" && nonRefundable > 0)) {
      order.refundStatus = "PENDING";
      order.refundAmount = refundable;
    }

    if (order.paymentStatus === "PAID" && order.paymentMethod === "ONLINE" && refundMethodRaw) {
      const validMethods = ["bank_transfer", "upi"];
      if (validMethods.includes(refundMethodRaw)) {
        order.cancellationRefundMethod = refundMethodRaw;
        let parsed = {};
        if (bankDetailsRaw) {
          try { parsed = typeof bankDetailsRaw === "string" ? JSON.parse(bankDetailsRaw) : bankDetailsRaw; } catch {}
        }
        order.cancellationBankDetails = parsed;
        // Auto-save to user's savedRefundDetails
        const saveUpdate = {};
        if (refundMethodRaw === "upi" && parsed.upiId) {
          saveUpdate["savedRefundDetails.upi"] = { upiId: parsed.upiId };
          saveUpdate["savedRefundDetails.lastRefundMethod"] = "upi";
        } else if (refundMethodRaw === "bank_transfer" && parsed.accountName) {
          saveUpdate["savedRefundDetails.bankTransfer"] = parsed;
          saveUpdate["savedRefundDetails.lastRefundMethod"] = "bank_transfer";
        }
        if (Object.keys(saveUpdate).length) {
          User.findByIdAndUpdate(order.user, { $set: saveUpdate }).catch(() => {});
        }
      }
    }

    await order.save();

    // Restore stock — bulk update instead of N individual queries
    const productIds = order.orderItems.map(i => i.product);
    const productDocs = await Product.find({ _id: { $in: productIds } }).select("employee").lean();
    const employeeIds = new Set(productDocs.filter(p => p.employee).map(p => p.employee.toString()));

    await Product.bulkWrite(
      order.orderItems.map(item => ({
        updateOne: {
          filter: { _id: item.product },
          update: { $inc: { stock: item.quantity, sold: -item.quantity } },
        },
      }))
    );

    // Build refund message for customer notification
    let refundMsg = "";
    if (order.paymentStatus === "PAID") {
      if (order.paymentMethod === "ONLINE") {
        refundMsg = ` Your refund will be processed manually by our team within 3–5 business days.`;
      } else {
        refundMsg = ` A refund will be processed to your bank account by our team shortly.`;
      }
    }

    // Notify customer
    await notify({
      userId:  order.user,
      title:   "Order Cancelled ❌",
      message: `Your order #${order.orderNumber} has been cancelled.${reason ? " Reason: " + reason : ""}${refundMsg}`,
      type:    "ORDER",
      link:    `/orders`,
    });

    // Notify employees
    for (const employeeId of employeeIds) {
      const employee = await Employee.findOne({ user: employeeId }).select("_id").catch(() => null)
                  || await Employee.findById(employeeId).select("user").catch(() => null);
      if (employee) {
        await notify({
          userId:  employee.user || employeeId,
          title:   "Order Cancelled ❌",
          message: `Order #${order.orderNumber} has been cancelled by the customer.`,
          type:    "ORDER",
          link:    "/employee",
        });
      }
    }

    // Notify admins
    await notifyAdmins({
      title:   "Order Cancelled ❌",
      message: `Order #${order.orderNumber} has been cancelled by the customer.${reason ? " Reason: " + reason : ""}`,
      type:    "ORDER",
      link:    "/admin",
    });

    res.json(new ApiResponse(200, { order }, "Order cancelled successfully"));
  } catch (err) {
    next(err);
  }
};

export const processCancellationRefund = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");
    if (order.orderStatus !== "CANCELLED") throw new ApiError(400, "Order is not cancelled");
    if (order.paymentMethod !== "ONLINE" || order.paymentStatus !== "PAID") {
      throw new ApiError(400, "No online payment to refund");
    }
    if (order.refundStatus === "COMPLETED") throw new ApiError(400, "Refund already completed");

    const proofFiles = req.files || [];
    for (const file of proofFiles) {
      const result = await uploadToCloudinary(file.buffer, "orders/refund-proof");
      order.cancellationRefundProof.push({
        url:        result.secure_url,
        publicId:   result.public_id,
        uploadedBy: req.user.role === "admin" ? "admin" : "employee",
        uploadedAt: new Date(),
      });
    }

    order.refundStatus  = "COMPLETED";
    order.paymentStatus = "REFUNDED";
    order.refundReason  = req.body?.note || "Manual refund processed";
    await order.save();

    await notify({
      userId:  order.user,
      title:   "Refund Processed ✅",
      message: `Your refund of ₹${order.refundAmount} for order #${order.orderNumber} has been processed successfully.`,
      type:    "REFUND",
      link:    `/orders`,
    });

    await notifyAdmins({
      title:   "Refund Completed ✅",
      message: `Refund of ₹${order.refundAmount} for order #${order.orderNumber} has been marked as processed.`,
      type:    "REFUND",
      link:    "/admin",
    });

    res.json(new ApiResponse(200, { order }, "Refund marked as completed"));
  } catch (err) {
    next(err);
  }
};

// Admin
export const getAllOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status && VALID_ORDER_STATUSES.includes(req.query.status)) {
      filter.orderStatus = req.query.status;
    }
    if (req.query.paymentStatus && VALID_PAYMENT_STATUSES.includes(req.query.paymentStatus)) {
      filter.paymentStatus = req.query.paymentStatus;
    }
    if (req.query.userId && /^[0-9a-fA-F]{24}$/.test(req.query.userId)) {
      filter.user = req.query.userId;
    }
    if (req.query.search) {
      const s = req.query.search.trim();
      const matchingUserIds = await User.find({
        $or: [
          { name:  { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
          { phone: { $regex: s, $options: "i" } },
        ],
      }).distinct("_id");
      filter.$or = [
        { orderNumber: { $regex: s, $options: "i" } },
        { user: { $in: matchingUserIds } },
      ];
    }

    // Breakdown is computed independent of orderStatus/paymentStatus filters so
    // the frontend's status tabs can show absolute counts regardless of which
    // tab is currently active. Other filters (search, userId) are respected.
    const breakdownFilter = { ...filter };
    delete breakdownFilter.orderStatus;
    delete breakdownFilter.paymentStatus;

    const [orders, total, statusAgg, pendingPaymentCount] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email phone")
        .populate("orderItems.product", "title")
        .populate("coupon", "code discountType discountValue freebieQuantity")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Order.countDocuments(filter),
      Order.aggregate([
        { $match: breakdownFilter },
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
      Order.countDocuments({
        ...breakdownFilter,
        orderStatus:   "PLACED",
        paymentMethod: "ONLINE",
        paymentStatus: "PENDING",
      }),
    ]);

    res.json(new ApiResponse(200, {
      ...buildPaginatedResponse(orders, total, page, limit),
      statusBreakdown:     statusAgg,
      pendingPaymentCount,
    }));
  } catch (err) {
    next(err);
  }
};

export const updateOrderStatus = async (req, res, next) => {
  try {
    const { status, trackingId, note } = req.body;
    const validStatuses = ["CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED", "RETURNED"];

    if (!validStatuses.includes(status)) throw new ApiError(400, "Invalid status");

    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");

    order.orderStatus = status;
    order.statusHistory.push({ status, note, timestamp: new Date() });
    if (trackingId) order.trackingId = trackingId;
    applyOrderStatusSideEffects(order, status);

    await order.save();

    // Notify customer
    await notifyCustomerForOrderStatus(order, status, note);

    const upayaDispatch = await dispatchToUpayaForFulfillment(order);
    const freshOrder = await Order.findById(order._id);

    // Notify relevant employees
    setImmediate(async () => {
      try {
        const productIds = order.orderItems.map(i => i.product);
        const products   = await Product.find({ _id: { $in: productIds } }).select("employee");
        const employeeIds  = [...new Set(products.map(p => p.employee?.toString()).filter(Boolean))];
        for (const eid of employeeIds) {
          await notifyEmployee(eid, {
            title:   `Order ${status.replace(/_/g, " ")}`,
            message: `Order #${order.orderNumber} has been updated to ${status.replace(/_/g, " ")} by admin.`,
            type:    "ORDER",
            link:    "/employee",
          });
        }
      } catch { /* non-critical */ }
    });

    res.json(new ApiResponse(200, { order: freshOrder || order, upayaDispatch }, "Order status updated"));
  } catch (err) {
    next(err);
  }
};

/* Employee: update order status (restricted — cannot cancel or set PLACED/RETURNED) */
export const employeeUpdateOrderStatus = async (req, res, next) => {
  try {
    const { status, trackingId, note } = req.body;

    // Employees can only move orders forward through fulfilment pipeline
    const employeeAllowedStatuses = ["CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];
    if (!employeeAllowedStatuses.includes(status)) {
      throw new ApiError(400, `Employees can only set status to: ${employeeAllowedStatuses.join(", ")}`);
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");

    order.orderStatus = status;
    order.statusHistory.push({ status, note: note || `Status updated by employee`, timestamp: new Date() });
    if (trackingId) order.trackingId = trackingId;
    applyOrderStatusSideEffects(order, status);

    await order.save();

    // Notify customer with rich message
    await notifyCustomerForOrderStatus(order, status, note);

    const upayaDispatch = await dispatchToUpayaForFulfillment(order);
    const freshOrder = await Order.findById(order._id);

    res.json(new ApiResponse(200, { order: freshOrder || order, upayaDispatch }, "Order status updated"));
  } catch (err) {
    next(err);
  }
};

export const getEmployeeOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status) filter.orderStatus = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;
    if (req.query.search) {
      const s = req.query.search.trim();
      const matchingUserIds = await User.find({
        $or: [
          { name:  { $regex: s, $options: "i" } },
          { email: { $regex: s, $options: "i" } },
          { phone: { $regex: s, $options: "i" } },
        ],
      }).distinct("_id");
      filter.$or = [
        { orderNumber: { $regex: s, $options: "i" } },
        { user: { $in: matchingUserIds } },
      ];
    }

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email phone")
        .populate("orderItems.product", "title images price discountPrice")
        .populate("coupon", "code discountType discountValue freebieQuantity")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const RETURNED_STATUSES = ["RETURNED", "CANCELLED"];

    // Breakdown ignores orderStatus/paymentStatus so the tab counts stay
    // absolute as the user clicks between status tabs.
    const breakdownFilter = { ...filter };
    delete breakdownFilter.orderStatus;
    delete breakdownFilter.paymentStatus;

    const [revenueAgg, refundedAgg, statusAgg, pendingPaymentCount] = await Promise.all([
      Order.aggregate([
        { $match: { paymentStatus: "PAID", orderStatus: { $nin: RETURNED_STATUSES } } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
      ]),
      Order.aggregate([
        { $match: { $or: [
          { paymentStatus: "REFUNDED" },
          { paymentStatus: "PAID", orderStatus: { $in: RETURNED_STATUSES } },
        ]}},
        { $group: { _id: null, total: { $sum: "$refundAmount" }, orderTotal: { $sum: "$totalPrice" } } },
      ]),
      Order.aggregate([
        { $match: breakdownFilter },
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
      Order.countDocuments({
        ...breakdownFilter,
        orderStatus:   "PLACED",
        paymentMethod: "ONLINE",
        paymentStatus: "PENDING",
      }),
    ]);

    const employeeRevenue = revenueAgg[0]?.total || 0;
    const refundedRaw = refundedAgg[0];
    const employeeRefunded = refundedRaw
      ? (refundedRaw.total > 0 ? refundedRaw.total : refundedRaw.orderTotal)
      : 0;

    res.json(new ApiResponse(200, {
      ...buildPaginatedResponse(orders, total, page, limit),
      employeeRevenue,
      employeeRefunded,
      statusBreakdown:     statusAgg,
      pendingPaymentCount,
    }));
  } catch (err) {
    next(err);
  }
};

/* Admin: force-refund any delivered order (bypasses returnability) */
export const adminForceRefund = async (req, res, next) => {
  try {
    const { reason = "Admin initiated refund", adminNote = "", refundAmount } = req.body;
    const order = await Order.findById(req.params.orderId).populate("user", "name email");
    if (!order) throw new ApiError(404, "Order not found");
    if (!["DELIVERED", "CANCELLED"].includes(order.orderStatus)) {
      throw new ApiError(400, "Force refund only allowed on delivered or cancelled orders");
    }

    const { default: ReturnRequest } = await import("../models/returnRequest.model.js");

    const existing = await ReturnRequest.findOne({ order: order._id });
    if (existing) throw new ApiError(409, "A return/refund request already exists for this order");

    // Non-refundable COD booking amount is excluded from the refund
    const nonRefundable = (order.codBookingStatus === "PAID" && order.codBookingAmount > 0)
      ? order.codBookingAmount : 0;
    const defaultRefundable = Math.max(0, order.totalPrice - nonRefundable);
    let finalRefundAmount = refundAmount !== undefined ? Number(refundAmount) : defaultRefundable;
    if (!Number.isFinite(finalRefundAmount) || finalRefundAmount < 0) {
      throw new ApiError(400, "Invalid refund amount");
    }
    // Cap to maximum refundable
    if (finalRefundAmount > defaultRefundable) finalRefundAmount = defaultRefundable;

    const ret = await ReturnRequest.create({
      order:       order._id,
      user:        order.user._id,
      product:     order.orderItems[0]?.product || null,
      reason,
      description: adminNote || "Admin override refund",
      resolution:  "refund",
      refundAmount: finalRefundAmount,
      adminNote,
      status:      "APPROVED",
      timeline: [
        { status: "REQUESTED",  note: "Admin force-initiated refund", by: "admin", at: new Date() },
        { status: "APPROVED",   note: adminNote || "Admin approved immediately", by: "admin", at: new Date() },
      ],
    });

    order.orderStatus = "RETURNED";
    order.paymentStatus = "REFUNDED";
    order.statusHistory.push({ status: "RETURNED", note: `Admin force-refund: ${adminNote || reason}`, timestamp: new Date() });
    await order.save();

    await notify({ userId: order.user._id, title: "Refund Initiated ↩️", message: `Your order ${order.orderNumber} has been approved for a refund of ₹${finalRefundAmount}.`, type: "ORDER", link: `/track?id=${order._id}` });

    res.json(new ApiResponse(200, { returnRequest: ret }, "Force refund initiated"));
  } catch (err) {
    next(err);
  }
};

export const getOrderStats = async (req, res, next) => {
  try {
    const RETURNED_STATUSES = ["RETURNED", "CANCELLED"];

    const [totalOrders, revenue, refunded, statusBreakdown, paymentBreakdown] = await Promise.all([
      Order.countDocuments(),
      // Net revenue: paid orders that have NOT been returned/cancelled
      Order.aggregate([
        { $match: { paymentStatus: "PAID", orderStatus: { $nin: RETURNED_STATUSES } } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
      ]),
      // Refunded: explicitly refunded OR paid-then-returned/cancelled
      Order.aggregate([
        { $match: { $or: [
          { paymentStatus: "REFUNDED" },
          { paymentStatus: "PAID", orderStatus: { $in: RETURNED_STATUSES } },
        ]}},
        { $group: { _id: null, total: { $sum: "$refundAmount" }, orderTotal: { $sum: "$totalPrice" } } },
      ]),
      Order.aggregate([
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $group: { _id: "$paymentMethod", count: { $sum: 1 } } },
      ]),
    ]);

    const netRevenue = revenue[0]?.total || 0;
    // Use refundAmount when set, otherwise fall back to orderTotal (for RETURNED orders with no explicit refundAmount yet)
    const refundedAmount = refunded[0]
      ? (refunded[0].total > 0 ? refunded[0].total : refunded[0].orderTotal)
      : 0;

    res.json(new ApiResponse(200, {
      totalOrders,
      netRevenue,
      refundedAmount,
      totalRevenue: netRevenue + refundedAmount,
      statusBreakdown,
      paymentBreakdown,
    }));
  } catch (err) {
    next(err);
  }
};

// Admin/employee — re-dispatch an order to Upaya. Used after a failed sync
// or if the customer's Upaya area is corrected manually.
export const retryUpayaDispatch = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId);
    if (!order) throw new ApiError(404, "Order not found");

    // Reset state so the helper re-attempts
    if (order.upayaSyncStatus === "SYNCED" && !req.body?.force) {
      return res.json(new ApiResponse(200, {
        upayaOrderRef: order.upayaOrderRef,
        upayaSyncStatus: order.upayaSyncStatus,
      }, "Already synced — pass { force: true } to resync"));
    }
    await Order.findByIdAndUpdate(orderId, { upayaSyncStatus: "NOT_SENT", upayaError: null, upayaOrderRef: null, upayaTrackingId: null });
    const ref = await dispatchToUpaya(orderId);
    const updated = await Order.findById(orderId).select("upayaOrderRef upayaTrackingId upayaSyncStatus upayaError upayaSyncedAt trackingId");
    res.json(new ApiResponse(200, { order: updated, ref }, ref ? "Order dispatched to Upaya" : "Dispatch failed — see upayaError"));
  } catch (err) { next(err); }
};

// Any signed-in user can fetch live tracking for their own order. Admin/
// employee can fetch any order's tracking.
export const getUpayaTracking = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const order = await Order.findById(orderId).select("user upayaOrderRef upayaTrackingId orderNumber orderStatus statusHistory deliveredAt paymentStatus paidAt");
    if (!order) throw new ApiError(404, "Order not found");

    const isOwner = order.user?.toString() === req.user._id.toString();
    const isStaff = req.user.role === "admin" || req.user.role === "employee";
    if (!isOwner && !isStaff) throw new ApiError(403, "Forbidden");

    const ref = order.upayaTrackingId || order.upayaOrderRef;
    if (!ref) {
      return res.json(new ApiResponse(200, { available: false, message: "This order has not been dispatched via Upaya yet" }));
    }

    try {
      const tracking = await upayaService.trackOrder(ref);
      const sync = await syncOrderStatusFromUpayaTracking(order, tracking);
      res.json(new ApiResponse(200, {
        available: true,
        ref,
        tracking,
        sync,
        order: {
          orderStatus: order.orderStatus,
          statusHistory: order.statusHistory,
          deliveredAt: order.deliveredAt,
          paymentStatus: order.paymentStatus,
          paidAt: order.paidAt,
        },
      }));
    } catch (err) {
      // Surface the upstream issue without exploding the order details page.
      res.json(new ApiResponse(200, { available: false, ref, error: err.message }));
    }
  } catch (err) { next(err); }
};
