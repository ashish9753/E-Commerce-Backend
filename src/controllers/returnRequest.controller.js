import ReturnRequest from "../models/returnRequest.model.js";
import Order         from "../models/order.model.js";
import Product       from "../models/product.model.js";
import Seller        from "../models/seller.model.js";
import InventoryLog  from "../models/inventoryLog.model.js";
import Notification  from "../models/notification.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError    from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

const pushTimeline = (doc, status, note, by = "system") => {
  doc.timeline.push({ status, note, by, at: new Date() });
};

/* ─── Customer: submit return ─── */
export const createReturnRequest = async (req, res, next) => {
  try {
    const { orderId, productId, reason, description, resolution } = req.body;
    if (!orderId || !reason) throw new ApiError(400, "orderId and reason are required");

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) throw new ApiError(404, "Order not found");
    if (order.orderStatus !== "DELIVERED") throw new ApiError(400, "Only delivered orders can be returned");

    const existing = await ReturnRequest.findOne({ order: orderId, user: req.user._id });
    if (existing) throw new ApiError(409, "Return request already submitted for this order");

    // Find which seller owns the product — fall back to first item in order if no productId given
    let sellerId = null;
    const lookupId = productId || order.orderItems?.[0]?.product;
    if (lookupId) {
      const product = await Product.findById(lookupId).select("seller");
      if (product) sellerId = product.seller;
    }

    // For COD orders, force refund method to bank_transfer (no original payment to return to)
    const isCOD = order.paymentMethod === "COD";
    const defaultRefundMethod = isCOD ? "bank_transfer" : "original_payment";

    const returnReq = await ReturnRequest.create({
      order:        orderId,
      user:         req.user._id,
      product:      productId || null,
      seller:       sellerId,
      reason,
      description,
      resolution:   resolution || "refund",
      refundAmount: order.totalPrice,
      refundMethod: defaultRefundMethod,
      timeline: [{ status: "REQUESTED", note: "Return request submitted by customer", by: "system" }],
    });

    await Order.findByIdAndUpdate(orderId, { orderStatus: "RETURNED" });

    // Notify seller — they must act first
    if (sellerId) {
      const sellerUser = await Seller.findById(sellerId).select("user");
      if (sellerUser?.user) {
        await Notification.create({
          user:    sellerUser.user,
          title:   "New Return Request",
          message: `A customer has requested a return for order #${order.orderNumber || orderId.toString().slice(-6).toUpperCase()}. Please review and approve or reject within 48 hours.`,
          type:    "REFUND",
        });
      }
    }

    res.status(201).json(new ApiResponse(201, { returnRequest: returnReq }, "Return request submitted"));
  } catch (err) {
    next(err);
  }
};

/* ─── Customer: single return by ID ─── */
export const getReturnById = async (req, res, next) => {
  try {
    const ret = await ReturnRequest.findOne({ _id: req.params.requestId, user: req.user._id })
      .populate("order",   "orderNumber totalPrice orderItems createdAt paymentMethod paymentStatus")
      .populate("product", "title images price");
    if (!ret) throw new ApiError(404, "Return request not found");
    res.json(new ApiResponse(200, { returnRequest: ret }));
  } catch (err) {
    next(err);
  }
};

/* ─── Customer: set refund payment method ─── */
export const updateRefundMethod = async (req, res, next) => {
  try {
    const { refundMethod, bankDetails } = req.body;
    const valid = ["original_payment", "bank_transfer", "upi"];
    if (!valid.includes(refundMethod)) throw new ApiError(400, "Invalid refundMethod");

    const ret = await ReturnRequest.findOne({ _id: req.params.requestId, user: req.user._id })
      .populate("order", "paymentMethod");
    if (!ret) throw new ApiError(404, "Return request not found");
    if (!["REQUESTED", "SELLER_APPROVED", "APPROVED"].includes(ret.status)) {
      throw new ApiError(400, "Refund method cannot be changed at this stage");
    }

    // COD orders cannot refund to original payment — enforce server-side
    if (refundMethod === "original_payment" && ret.order?.paymentMethod === "COD") {
      throw new ApiError(400, "COD orders must use bank transfer or UPI for refund. There is no original digital payment to return to.");
    }

    ret.refundMethod = refundMethod;
    if (refundMethod !== "original_payment") ret.bankDetails = bankDetails || {};
    ret.timeline.push({ status: ret.status, note: `Customer set refund method to ${refundMethod}`, by: "customer" });
    await ret.save();

    res.json(new ApiResponse(200, { returnRequest: ret }, "Refund method updated"));
  } catch (err) {
    next(err);
  }
};

/* ─── Customer: my returns ─── */
export const getMyReturnRequests = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const [requests, total] = await Promise.all([
      ReturnRequest.find({ user: req.user._id })
        .populate("order",   "orderNumber totalPrice orderItems createdAt")
        .populate("product", "title images")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnRequest.countDocuments({ user: req.user._id }),
    ]);
    res.json(new ApiResponse(200, buildPaginatedResponse(requests, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

/* ─── Seller: get returns for their products ─── */
export const getSellerReturnRequests = async (req, res, next) => {
  try {
    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) throw new ApiError(403, "Seller profile not found");

    // Also pick up legacy returns where seller field wasn't set — match via order's product list
    const sellerProducts = await Product.find({ seller: seller._id }).select("_id");
    const sellerProductIds = sellerProducts.map(p => p._id);

    const { page, limit, skip } = getPaginationData(req.query);
    const baseFilter = {
      $or: [
        { seller: seller._id },
        { product: { $in: sellerProductIds } },
      ],
    };
    if (req.query.status) baseFilter.status = req.query.status;

    const [requests, total] = await Promise.all([
      ReturnRequest.find(baseFilter)
        .populate("user",    "name email")
        .populate("order",   "orderNumber totalPrice orderItems createdAt")
        .populate("product", "title images")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnRequest.countDocuments(baseFilter),
    ]);
    res.json(new ApiResponse(200, buildPaginatedResponse(requests, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

/* ─── Seller: approve or reject ─── */
export const sellerActionOnReturn = async (req, res, next) => {
  try {
    const { action, note } = req.body; // action: "approve" | "reject"
    if (!["approve", "reject"].includes(action)) throw new ApiError(400, "action must be approve or reject");

    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) throw new ApiError(403, "Seller profile not found");

    const sellerProducts = await Product.find({ seller: seller._id }).select("_id");
    const sellerProductIds = sellerProducts.map(p => p._id);

    const returnReq = await ReturnRequest.findOne({
      _id: req.params.requestId,
      $or: [{ seller: seller._id }, { product: { $in: sellerProductIds } }],
    });
    if (!returnReq) throw new ApiError(404, "Return request not found");
    // Seller can act on REQUESTED or re-act if admin sends back (REQUESTED only for now)
    if (!["REQUESTED"].includes(returnReq.status)) {
      throw new ApiError(400, "This return has already been actioned");
    }

    // On approve: skip admin — jump straight to PICKUP_SCHEDULED so seller can process refund
    const newStatus = action === "approve" ? "PICKUP_SCHEDULED" : "SELLER_REJECTED";
    returnReq.status         = newStatus;
    returnReq.sellerNote     = note;
    returnReq.sellerActionAt = new Date();
    if (action === "approve") {
      pushTimeline(returnReq, "SELLER_APPROVED", note || "Seller approved the return", "seller");
      pushTimeline(returnReq, "PICKUP_SCHEDULED", "Pickup scheduled — awaiting item collection", "system");
    } else {
      pushTimeline(returnReq, newStatus, note || "Seller rejected the return", "seller");
    }
    await returnReq.save();

    // Notify customer
    await Notification.create({
      user:    returnReq.user,
      title:   `Return ${action === "approve" ? "Approved" : "Rejected"} by Seller`,
      message: action === "approve"
        ? `Great news! Your return has been approved. The seller will arrange pickup shortly.${note ? " Note: " + note : ""}`
        : `The seller has rejected your return request.${note ? " Reason: " + note : ""} You can contact admin support to appeal.`,
      type:    "REFUND",
    });

    if (action === "reject") {
      pushTimeline(returnReq, newStatus, "Admin review recommended — seller rejected this return", "system");
      await returnReq.save();
    }

    res.json(new ApiResponse(200, { returnRequest: returnReq }, `Return ${action}d by seller`));
  } catch (err) {
    next(err);
  }
};

/* ─── Seller: advance return through refund pipeline ─── */
export const sellerAdvanceReturn = async (req, res, next) => {
  try {
    const { note } = req.body;

    const seller = await Seller.findOne({ user: req.user._id });
    if (!seller) throw new ApiError(403, "Seller profile not found");

    const sellerProducts = await Product.find({ seller: seller._id }).select("_id");
    const sellerProductIds = sellerProducts.map(p => p._id);

    const returnReq = await ReturnRequest.findOne({
      _id: req.params.requestId,
      $or: [{ seller: seller._id }, { product: { $in: sellerProductIds } }],
    });
    if (!returnReq) throw new ApiError(404, "Return request not found");

    // Seller can only advance through the refund pipeline
    const pipeline = {
      PICKUP_SCHEDULED: "ITEM_RECEIVED",
      ITEM_RECEIVED:    "REFUND_INITIATED",
      REFUND_INITIATED: "REFUND_COMPLETED",
    };

    const nextStatus = pipeline[returnReq.status];
    if (!nextStatus) {
      throw new ApiError(400, `Cannot advance return from status '${returnReq.status}'`);
    }

    returnReq.status = nextStatus;
    if (nextStatus === "REFUND_COMPLETED") {
      returnReq.resolvedAt = new Date();
      // Mark order refund as completed
      await Order.findByIdAndUpdate(returnReq.order, {
        refundStatus: "COMPLETED",
        refundAmount: returnReq.refundAmount,
      });
    }
    pushTimeline(returnReq, nextStatus, note || `Seller marked: ${nextStatus.replace(/_/g, " ")}`, "seller");
    await returnReq.save();

    // Notify customer
    const statusMessages = {
      ITEM_RECEIVED:    "Your returned item has been received by the seller.",
      REFUND_INITIATED: "Your refund has been initiated and is being processed.",
      REFUND_COMPLETED: "Your refund has been completed!",
    };
    await Notification.create({
      user:    returnReq.user,
      title:   `Return Update: ${nextStatus.replace(/_/g, " ")}`,
      message: (statusMessages[nextStatus] || `Your return status is now: ${nextStatus}.`) + (note ? ` ${note}` : ""),
      type:    "REFUND",
    });

    res.json(new ApiResponse(200, { returnRequest: returnReq }, `Return advanced to ${nextStatus}`));
  } catch (err) {
    next(err);
  }
};

/* ─── Admin: all returns ─── */
export const getAllReturnRequests = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [requests, total] = await Promise.all([
      ReturnRequest.find(filter)
        .populate("user",    "name email")
        .populate("product", "title images")
        .populate("order",   "orderNumber totalPrice orderItems createdAt")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnRequest.countDocuments(filter),
    ]);
    res.json(new ApiResponse(200, buildPaginatedResponse(requests, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

/* ─── Admin: process / take action ─── */
export const processReturnRequest = async (req, res, next) => {
  try {
    const { status, adminNote, refundAmount } = req.body;
    const validStatuses = [
      "APPROVED", "REJECTED", "PICKUP_SCHEDULED",
      "ITEM_RECEIVED", "REFUND_INITIATED", "REFUND_COMPLETED",
      "REPLACEMENT_SENT", "COMPLETED",
    ];
    if (!validStatuses.includes(status)) throw new ApiError(400, "Invalid status");

    const returnReq = await ReturnRequest.findById(req.params.requestId).populate("order");
    if (!returnReq) throw new ApiError(404, "Return request not found");

    returnReq.status    = status;
    returnReq.adminNote = adminNote;
    if (refundAmount) returnReq.refundAmount = parseFloat(refundAmount);
    if (["REFUND_COMPLETED", "REPLACEMENT_SENT", "COMPLETED", "REJECTED"].includes(status)) {
      returnReq.resolvedAt = new Date();
    }
    pushTimeline(returnReq, status, adminNote || `Admin updated status to ${status}`, "admin");
    await returnReq.save();

    // Restore stock on APPROVED
    if (status === "APPROVED" || status === "ITEM_RECEIVED") {
      await Order.findByIdAndUpdate(returnReq.order._id, {
        refundStatus: "PROCESSING",
        refundAmount: returnReq.refundAmount,
      });

      for (const item of returnReq.order.orderItems) {
        const product = await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity, sold: -item.quantity } },
          { new: true }
        );
        if (product) {
          await InventoryLog.create({
            product:        item.product,
            order:          returnReq.order._id,
            changeType:     "RETURN",
            quantityChanged: item.quantity,
            oldStock:       product.stock - item.quantity,
            newStock:       product.stock,
            note:           `Return approved for order ${returnReq.order.orderNumber}`,
            performedBy:    req.user._id,
          });
        }
      }
    }

    if (["REFUND_COMPLETED", "REPLACEMENT_SENT", "COMPLETED"].includes(status)) {
      await Order.findByIdAndUpdate(returnReq.order._id, { refundStatus: "COMPLETED" });
    }

    await Notification.create({
      user:    returnReq.user,
      title:   `Return Request Update`,
      message: `Your return is now: ${status.replace(/_/g, " ")}.${adminNote ? " " + adminNote : ""}`,
      type:    "REFUND",
    });

    res.json(new ApiResponse(200, { returnRequest: returnReq }, `Return updated to ${status}`));
  } catch (err) {
    next(err);
  }
};
