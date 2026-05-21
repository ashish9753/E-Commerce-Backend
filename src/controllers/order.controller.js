import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import Coupon from "../models/coupon.model.js";
import Employee from "../models/employee.model.js";
import { notify, notifyEmployee, notifyAdmins } from "../utils/notify.js";
import { sendEmail, orderConfirmationEmail } from "../utils/email.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { autoRefund } from "../utils/refund.utils.js";

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
const TAX_RATE = 0.18;

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
      rawItems = [{ product: directItem.productId, quantity: directItem.quantity }];
    }

    // Build order items with current prices
    const orderItems = [];
    let itemsPrice = 0;
    let taxPrice = 0;
    const taxLabelsSet = new Set();

    for (const item of rawItems) {
      const productId = item.product._id || item.product;
      const product = await Product.findOne({ _id: productId, isDeleted: false, isPublished: true });
      if (!product) throw new ApiError(404, `Product ${productId} not found`);
      if (product.stock < item.quantity) {
        throw new ApiError(400, `"${product.title}" — only ${product.stock} units in stock`);
      }

      const price = product.discountPrice || product.price;
      const itemTotal = price * item.quantity;
      const rate = (product.taxRate ?? TAX_RATE * 100) / 100; // convert % to decimal
      itemsPrice += itemTotal;
      taxPrice   += itemTotal * rate;
      if (product.taxLabel) taxLabelsSet.add(product.taxLabel);
      orderItems.push({
        product: product._id,
        title: product.title,
        image: product.images[0] || "",
        quantity: item.quantity,
        price,
      });
    }

    taxPrice = parseFloat(taxPrice.toFixed(2));
    // Derive a readable tax label (e.g. "GST" or "GST / IGST" for mixed)
    const taxLabel = taxLabelsSet.size > 0 ? [...taxLabelsSet].join(" / ") : "GST";

    // Price calculations
    const shippingPrice = itemsPrice >= SHIPPING_THRESHOLD ? 0 : SHIPPING_PRICE;

    // Coupon discount (from cart)
    let discountAmount = 0;
    let couponId = null;

    if (useCart) {
      const cart = await Cart.findOne({ user: user._id }).populate("coupon");
      if (cart?.coupon) {
        const coupon = await Coupon.findById(cart.coupon);
        if (coupon) {
          const validity = coupon.isValid(itemsPrice, user._id);
          if (validity.valid) {
            discountAmount = coupon.calculateDiscount(itemsPrice);
            couponId = coupon._id;
          }
        }
      }
    }

    const totalPrice = parseFloat((itemsPrice + shippingPrice + taxPrice - discountAmount).toFixed(2));

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
      taxPrice,
      taxLabel,
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
    next(err);
  }
};

export const getMyOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { user: req.user._id };
    if (req.query.status) filter.orderStatus = req.query.status;

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
    const { reason } = req.body;
    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");

    const isOwner = order.user.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "admin") throw new ApiError(403, "Access denied");

    const cancelableStatuses = ["PLACED", "CONFIRMED"];
    if (!cancelableStatuses.includes(order.orderStatus)) {
      throw new ApiError(400, `Cannot cancel order in '${order.orderStatus}' status`);
    }

    order.orderStatus = "CANCELLED";
    order.cancellationReason = reason || "Cancelled by user";
    order.statusHistory.push({ status: "CANCELLED", note: reason });

    if (order.paymentStatus === "PAID") {
      order.refundStatus = "PENDING";
      order.refundAmount = order.totalPrice;
    }

    await order.save();

    // Auto Razorpay refund for online-paid orders
    let refundResult = null;
    if (order.paymentStatus === "PAID" && order.paymentMethod === "ONLINE") {
      refundResult = await autoRefund(
        order._id,
        order.totalPrice,
        `Order #${order.orderNumber} cancelled`
      );
      if (refundResult.success) {
        await Order.findByIdAndUpdate(order._id, {
          refundStatus: "COMPLETED",
          refundAmount: refundResult.refundAmount,
        });
      }
    }

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
      if (refundResult?.success) {
        refundMsg = ` ₹${refundResult.refundAmount} has been refunded to your original payment method.`;
      } else if (order.paymentMethod === "ONLINE") {
        refundMsg = ` Refund could not be processed automatically — our team will reach out.`;
      } else {
        refundMsg = ` A refund will be processed to your bank account shortly.`;
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

    res.json(new ApiResponse(200, { order }, "Order cancelled successfully"));
  } catch (err) {
    next(err);
  }
};

// Admin
export const getAllOrders = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status) filter.orderStatus = req.query.status;
    if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email phone")
        .populate("orderItems.product", "title")
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
    if (status === "DELIVERED") {
      order.deliveredAt = new Date();
      order.paymentStatus = "PAID";
      order.paidAt = new Date();
    }

    await order.save();

    // Notify customer
    const msg = ORDER_STATUS_MESSAGES[status];
    if (msg) {
      await notify({
        userId:  order.user,
        title:   msg.title,
        message: msg.message + (note ? ` Note: ${note}` : ""),
        type:    "ORDER",
        link:    `/track?id=${order._id}`,
      });
    }

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

    res.json(new ApiResponse(200, { order }, "Order status updated"));
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

    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(403, "Employee profile not found");

    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");

    // Ensure this order contains at least one of the employee's products
    const employeeProductIds = (await Product.find({ employee: employee._id }).select("_id")).map(p => p._id.toString());
    const hasEmployeeProduct = order.orderItems.some(item => employeeProductIds.includes(item.product?.toString()));
    if (!hasEmployeeProduct) throw new ApiError(403, "This order does not contain your products");

    order.orderStatus = status;
    order.statusHistory.push({ status, note: note || `Status updated by employee`, timestamp: new Date() });
    if (trackingId) order.trackingId = trackingId;
    if (status === "DELIVERED") {
      order.deliveredAt  = new Date();
      order.paymentStatus = "PAID";
      order.paidAt       = new Date();
    }

    await order.save();

    // Notify customer with rich message
    const msg = ORDER_STATUS_MESSAGES[status];
    await notify({
      userId:  order.user,
      title:   msg?.title || `Order ${status.replace(/_/g, " ")}`,
      message: (msg?.message || `Your order #${order.orderNumber} is now: ${status.replace(/_/g, " ")}.`) + (note ? ` ${note}` : ""),
      type:    "ORDER",
      link:    `/track?id=${order._id}`,
    });

    res.json(new ApiResponse(200, { order }, "Order status updated"));
  } catch (err) {
    next(err);
  }
};

export const getEmployeeOrders = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(404, "Employee profile not found");

    const products = await Product.find({ employee: employee._id }).select("_id");
    const productIds = products.map((p) => p._id);

    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { "orderItems.product": { $in: productIds } };
    if (req.query.status) filter.orderStatus = req.query.status;

    const [orders, total] = await Promise.all([
      Order.find(filter)
        .populate("user", "name email phone")
        .populate("orderItems.product", "title images price discountPrice")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Order.countDocuments(filter),
    ]);

    const RETURNED_STATUSES = ["RETURNED", "CANCELLED"];

    // Revenue = paid orders that have NOT been returned/cancelled
    const [revenueAgg, refundedAgg, statusAgg] = await Promise.all([
      Order.aggregate([
        { $match: { "orderItems.product": { $in: productIds }, paymentStatus: "PAID", orderStatus: { $nin: RETURNED_STATUSES } } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
      ]),
      // Refunded: explicitly refunded OR paid-then-returned/cancelled
      Order.aggregate([
        { $match: { "orderItems.product": { $in: productIds }, $or: [
          { paymentStatus: "REFUNDED" },
          { paymentStatus: "PAID", orderStatus: { $in: RETURNED_STATUSES } },
        ]}},
        { $group: { _id: null, total: { $sum: "$refundAmount" }, orderTotal: { $sum: "$totalPrice" } } },
      ]),
      Order.aggregate([
        { $match: { "orderItems.product": { $in: productIds } } },
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
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
      statusBreakdown: statusAgg,
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
    const defaultRefundable = order.totalPrice - nonRefundable;
    const finalRefundAmount = refundAmount !== undefined ? Number(refundAmount) : defaultRefundable;

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
