import ReturnRequest from "../models/returnRequest.model.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import InventoryLog from "../models/inventoryLog.model.js";
import Notification from "../models/notification.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createReturnRequest = async (req, res, next) => {
  try {
    const { orderId, reason, description } = req.body;
    if (!orderId || !reason) throw new ApiError(400, "orderId and reason are required");

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) throw new ApiError(404, "Order not found");
    if (order.orderStatus !== "DELIVERED") throw new ApiError(400, "Only delivered orders can be returned");

    const deliveredAt = new Date(order.deliveredAt);
    const daysSinceDelivery = (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceDelivery > 7) throw new ApiError(400, "Return window of 7 days has expired");

    const existing = await ReturnRequest.findOne({ order: orderId, user: req.user._id });
    if (existing) throw new ApiError(409, "Return request already submitted for this order");

    let images = [];
    if (req.files?.length) {
      const uploads = await Promise.all(req.files.map((f) => uploadToCloudinary(f.buffer, "ecommerce/returns")));
      images = uploads.map((r) => r.secure_url);
    }

    const returnReq = await ReturnRequest.create({
      order: orderId,
      user: req.user._id,
      reason,
      description,
      images,
      refundAmount: order.totalPrice,
    });

    await Order.findByIdAndUpdate(orderId, { orderStatus: "RETURNED" });

    res.status(201).json(new ApiResponse(201, { returnRequest: returnReq }, "Return request submitted"));
  } catch (err) {
    next(err);
  }
};

export const getMyReturnRequests = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const [requests, total] = await Promise.all([
      ReturnRequest.find({ user: req.user._id })
        .populate("order", "orderNumber totalPrice orderItems")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnRequest.countDocuments({ user: req.user._id }),
    ]);
    res.json(new ApiResponse(200, buildPaginatedResponse(requests, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

// Admin
export const getAllReturnRequests = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [requests, total] = await Promise.all([
      ReturnRequest.find(filter)
        .populate("user", "name email")
        .populate("order", "orderNumber totalPrice orderItems")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnRequest.countDocuments(filter),
    ]);
    res.json(new ApiResponse(200, buildPaginatedResponse(requests, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const processReturnRequest = async (req, res, next) => {
  try {
    const { status, adminNote, refundAmount } = req.body;
    const validStatuses = ["APPROVED", "REJECTED", "COMPLETED"];
    if (!validStatuses.includes(status)) throw new ApiError(400, "Invalid status");

    const returnReq = await ReturnRequest.findById(req.params.requestId).populate("order");
    if (!returnReq) throw new ApiError(404, "Return request not found");

    returnReq.status = status;
    returnReq.adminNote = adminNote;
    if (refundAmount) returnReq.refundAmount = parseFloat(refundAmount);
    if (status === "COMPLETED" || status === "REJECTED") returnReq.resolvedAt = new Date();
    await returnReq.save();

    if (status === "APPROVED") {
      await Order.findByIdAndUpdate(returnReq.order._id, {
        refundStatus: "PROCESSING",
        refundAmount: returnReq.refundAmount,
      });

      // Restore stock for each item
      for (const item of returnReq.order.orderItems) {
        const product = await Product.findByIdAndUpdate(
          item.product,
          { $inc: { stock: item.quantity, sold: -item.quantity } },
          { new: true }
        );
        if (product) {
          await InventoryLog.create({
            product: item.product,
            order: returnReq.order._id,
            changeType: "RETURN",
            quantityChanged: item.quantity,
            oldStock: product.stock - item.quantity,
            newStock: product.stock,
            note: `Return approved for order ${returnReq.order.orderNumber}`,
            performedBy: req.user._id,
          });
        }
      }
    }

    if (status === "COMPLETED") {
      await Order.findByIdAndUpdate(returnReq.order._id, { refundStatus: "COMPLETED" });
    }

    await Notification.create({
      user: returnReq.user,
      title: `Return Request ${status}`,
      message: `Your return request has been ${status.toLowerCase()}.${adminNote ? ` Note: ${adminNote}` : ""}`,
      type: "REFUND",
    });

    res.json(new ApiResponse(200, { returnRequest: returnReq }, `Return request ${status.toLowerCase()}`));
  } catch (err) {
    next(err);
  }
};
