import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import Coupon from "../models/coupon.model.js";
import Seller from "../models/seller.model.js";
import Notification from "../models/notification.model.js";
import { notify, notifySeller, notifyAdmins } from "../utils/notify.js";
import { sendEmail, orderConfirmationEmail } from "../utils/email.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

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
    const { shippingAddressId, paymentMethod, useCart = true, directItem } = req.body;

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

    for (const item of rawItems) {
      const productId = item.product._id || item.product;
      const product = await Product.findOne({ _id: productId, isDeleted: false, isPublished: true });
      if (!product) throw new ApiError(404, `Product ${productId} not found`);
      if (product.stock < item.quantity) {
        throw new ApiError(400, `"${product.title}" — only ${product.stock} units in stock`);
      }

      const price = product.discountPrice || product.price;
      itemsPrice += price * item.quantity;
      orderItems.push({
        product: product._id,
        title: product.title,
        image: product.images[0] || "",
        quantity: item.quantity,
        price,
      });
    }

    // Price calculations
    const shippingPrice = itemsPrice >= SHIPPING_THRESHOLD ? 0 : SHIPPING_PRICE;
    const taxPrice = parseFloat((itemsPrice * TAX_RATE).toFixed(2));

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

    const jobData = {
      userId: user._id.toString(),
      orderItems,
      shippingAddress: address.toObject(),
      paymentMethod,
      itemsPrice,
      shippingPrice,
      taxPrice,
      discountAmount,
      totalPrice,
      couponId: couponId?.toString() || null,
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

    // Restore stock
    const sellerIds = new Set();
    for (const item of order.orderItems) {
      const product = await Product.findByIdAndUpdate(
        item.product,
        { $inc: { stock: item.quantity, sold: -item.quantity } },
        { new: true }
      );
      if (product?.seller) sellerIds.add(product.seller.toString());
    }

    // Notify customer
    await notify({
      userId:  order.user,
      title:   "Order Cancelled ❌",
      message: `Your order #${order.orderNumber} has been cancelled.${reason ? " Reason: " + reason : ""} ${order.paymentStatus === "PAID" ? "A refund will be processed shortly." : ""}`,
      type:    "ORDER",
      link:    `/orders`,
    });

    // Notify sellers
    for (const sellerId of sellerIds) {
      const seller = await Seller.findOne({ user: sellerId }).select("_id").catch(() => null)
                  || await Seller.findById(sellerId).select("user").catch(() => null);
      if (seller) {
        await notify({
          userId:  seller.user || sellerId,
          title:   "Order Cancelled ❌",
          message: `Order #${order.orderNumber} has been cancelled by the customer.`,
          type:    "ORDER",
          link:    "/seller",
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

    // Notify relevant sellers
    setImmediate(async () => {
      try {
        const productIds = order.orderItems.map(i => i.product);
        const products   = await Product.find({ _id: { $in: productIds } }).select("seller");
        const sellerIds  = [...new Set(products.map(p => p.seller?.toString()).filter(Boolean))];
        for (const sid of sellerIds) {
          await notifySeller(sid, {
            title:   `Order ${status.replace(/_/g, " ")}`,
            message: `Order #${order.orderNumber} has been updated to ${status.replace(/_/g, " ")} by admin.`,
            type:    "ORDER",
            link:    "/seller",
          });
        }
      } catch { /* non-critical */ }
    });

    res.json(new ApiResponse(200, { order }, "Order status updated"));
  } catch (err) {
    next(err);
  }
};

/* Seller: update order status (restricted — cannot cancel or set PLACED/RETURNED) */
export const sellerUpdateOrderStatus = async (req, res, next) => {
  try {
    const { status, trackingId, note } = req.body;

    // Sellers can only move orders forward through fulfilment pipeline
    const sellerAllowedStatuses = ["CONFIRMED", "PACKED", "SHIPPED", "OUT_FOR_DELIVERY", "DELIVERED"];
    if (!sellerAllowedStatuses.includes(status)) {
      throw new ApiError(400, `Sellers can only set status to: ${sellerAllowedStatuses.join(", ")}`);
    }

    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) throw new ApiError(403, "Seller profile not found");

    const order = await Order.findById(req.params.orderId);
    if (!order) throw new ApiError(404, "Order not found");

    // Ensure this order contains at least one of the seller's products
    const sellerProductIds = (await Product.find({ seller: seller._id }).select("_id")).map(p => p._id.toString());
    const hasSellerProduct = order.orderItems.some(item => sellerProductIds.includes(item.product?.toString()));
    if (!hasSellerProduct) throw new ApiError(403, "This order does not contain your products");

    order.orderStatus = status;
    order.statusHistory.push({ status, note: note || `Status updated by seller`, timestamp: new Date() });
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

export const getSellerOrders = async (req, res, next) => {
  try {
    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) throw new ApiError(404, "Seller profile not found");

    const products = await Product.find({ seller: seller._id }).select("_id");
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

    // Revenue for this seller = sum of orderItems that belong to seller's products
    const revenueAgg = await Order.aggregate([
      { $match: { "orderItems.product": { $in: productIds }, paymentStatus: "PAID" } },
      { $unwind: "$orderItems" },
      { $match: { "orderItems.product": { $in: productIds } } },
      { $group: { _id: null, total: { $sum: { $multiply: ["$orderItems.price", "$orderItems.quantity"] } } } },
    ]);

    const statusAgg = await Order.aggregate([
      { $match: { "orderItems.product": { $in: productIds } } },
      { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
    ]);

    res.json(new ApiResponse(200, {
      ...buildPaginatedResponse(orders, total, page, limit),
      sellerRevenue: revenueAgg[0]?.total || 0,
      statusBreakdown: statusAgg,
    }));
  } catch (err) {
    next(err);
  }
};

export const getOrderStats = async (req, res, next) => {
  try {
    const [totalOrders, revenue, statusBreakdown] = await Promise.all([
      Order.countDocuments(),
      Order.aggregate([
        { $match: { paymentStatus: "PAID" } },
        { $group: { _id: null, total: { $sum: "$totalPrice" } } },
      ]),
      Order.aggregate([
        { $group: { _id: "$orderStatus", count: { $sum: 1 } } },
      ]),
    ]);

    res.json(new ApiResponse(200, {
      totalOrders,
      totalRevenue: revenue[0]?.total || 0,
      statusBreakdown,
    }));
  } catch (err) {
    next(err);
  }
};
