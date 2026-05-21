import ReturnRequest from "../models/returnRequest.model.js";
import Order         from "../models/order.model.js";
import Product       from "../models/product.model.js";
import Employee      from "../models/employee.model.js";
import InventoryLog  from "../models/inventoryLog.model.js";
import { notify, notifyEmployee, notifyAdmins } from "../utils/notify.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError    from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { autoRefund } from "../utils/refund.utils.js";
import { uploadToCloudinary, uploadVideoToCloudinary } from "../utils/cloudinary.utils.js";

const pushTimeline = (doc, status, note, by = "system") => {
  doc.timeline.push({ status, note, by, at: new Date() });
};

/* ─── Customer: submit return ─── */
export const createReturnRequest = async (req, res, next) => {
  try {
    const { orderId, productId, reason, description, resolution } = req.body;
    if (!orderId || !reason) throw new ApiError(400, "orderId and reason are required");

    const photoFiles = req.files?.photos || [];
    const videoFiles = req.files?.video  || [];
    if (photoFiles.length === 0) throw new ApiError(400, "At least 1 photo is required for a return request");
    for (const f of photoFiles) {
      if (f.size > 10 * 1024 * 1024) throw new ApiError(400, "Each photo must be under 10 MB");
    }

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) throw new ApiError(404, "Order not found");
    if (order.orderStatus !== "DELIVERED") throw new ApiError(400, "Only delivered orders can be returned");

    const existing = await ReturnRequest.findOne({ order: orderId, user: req.user._id });
    if (existing) throw new ApiError(409, "Return request already submitted for this order");

    // Find which employee owns the product — fall back to first item in order if no productId given
    let employeeId = null;
    const lookupId = productId || order.orderItems?.[0]?.product;
    let returnableProduct = null;
    if (lookupId) {
      returnableProduct = await Product.findById(lookupId).select("employee returnable returnWindow");
      if (returnableProduct) employeeId = returnableProduct.employee;
    }

    // Validate return policy
    if (returnableProduct && returnableProduct.returnable === false) {
      throw new ApiError(400, "This product is non-returnable and cannot be returned.");
    }

    const returnWindowDays = returnableProduct?.returnWindow || 7;
    const deliveredAt = order.deliveredAt || order.updatedAt;
    const windowMs = returnWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(deliveredAt).getTime() > windowMs) {
      throw new ApiError(400, `Return window of ${returnWindowDays} days has expired. Returns are only accepted within ${returnWindowDays} days of delivery.`);
    }

    // For COD orders, force refund method to bank_transfer (no original payment to return to)
    const isCOD = order.paymentMethod === "COD";
    const defaultRefundMethod = isCOD ? "bank_transfer" : "original_payment";

    // Deduct non-refundable COD booking amount if it was paid
    const nonRefundable = (order.codBookingStatus === "PAID" && order.codBookingAmount > 0)
      ? order.codBookingAmount : 0;
    const refundableAmount = order.totalPrice - nonRefundable;

    // Upload evidence to Cloudinary
    const evidence = [];
    for (const file of photoFiles) {
      const result = await uploadToCloudinary(file.buffer, "returns/photos");
      evidence.push({ url: result.secure_url, publicId: result.public_id, type: "image" });
    }
    for (const file of videoFiles) {
      const result = await uploadVideoToCloudinary(file.buffer, "returns/videos");
      evidence.push({ url: result.secure_url, publicId: result.public_id, type: "video" });
    }

    const returnReq = await ReturnRequest.create({
      order:        orderId,
      user:         req.user._id,
      product:      productId || null,
      employee:     employeeId,
      reason,
      description,
      resolution:   resolution || "refund",
      refundAmount: refundableAmount,
      refundMethod: defaultRefundMethod,
      evidence,
      timeline: [{ status: "REQUESTED", note: "Return request submitted by customer", by: "system" }],
    });

    await Order.findByIdAndUpdate(orderId, { orderStatus: "RETURNED" });

    // Notify customer — confirmation
    await notify({
      userId:  req.user._id,
      title:   "Return Request Submitted ↩️",
      message: `Your return request for order #${order.orderNumber} has been submitted. The employee will review it within 48 hours.`,
      type:    "REFUND",
      link:    `/return-status/${returnReq._id}`,
    });

    // Notify employee — they must act first
    if (employeeId) {
      await notifyEmployee(employeeId, {
        title:   "New Return Request ⚠️",
        message: `Customer requested a return for order #${order.orderNumber}. Please approve or reject within 48 hours.`,
        type:    "REFUND",
        link:    "/employee",
      });
    }

    // Notify admins
    await notifyAdmins({
      title:   "New Return Request",
      message: `A new return request has been submitted for order #${order.orderNumber}.`,
      type:    "REFUND",
      link:    "/admin",
    });

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
    if (!["REQUESTED", "EMPLOYEE_APPROVED", "APPROVED"].includes(ret.status)) {
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

/* ─── Employee: get returns for their products ─── */
export const getEmployeeReturnRequests = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(403, "Employee profile not found");

    // Also pick up legacy returns where employee field wasn't set — match via order's product list
    const employeeProducts = await Product.find({ employee: employee._id }).select("_id");
    const employeeProductIds = employeeProducts.map(p => p._id);

    const { page, limit, skip } = getPaginationData(req.query);
    const baseFilter = {
      $or: [
        { employee: employee._id },
        { product: { $in: employeeProductIds } },
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

/* ─── Employee: approve or reject ─── */
export const employeeActionOnReturn = async (req, res, next) => {
  try {
    const { action, note } = req.body; // action: "approve" | "reject"
    if (!["approve", "reject"].includes(action)) throw new ApiError(400, "action must be approve or reject");

    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(403, "Employee profile not found");

    const employeeProducts = await Product.find({ employee: employee._id }).select("_id");
    const employeeProductIds = employeeProducts.map(p => p._id);

    const returnReq = await ReturnRequest.findOne({
      _id: req.params.requestId,
      $or: [{ employee: employee._id }, { product: { $in: employeeProductIds } }],
    });
    if (!returnReq) throw new ApiError(404, "Return request not found");
    // Employee can act on REQUESTED or re-act if admin sends back (REQUESTED only for now)
    if (!["REQUESTED"].includes(returnReq.status)) {
      throw new ApiError(400, "This return has already been actioned");
    }

    // On approve: skip admin — jump straight to PICKUP_SCHEDULED so employee can process refund
    const newStatus = action === "approve" ? "PICKUP_SCHEDULED" : "EMPLOYEE_REJECTED";
    returnReq.status          = newStatus;
    returnReq.employeeNote     = note;
    returnReq.employeeActionAt = new Date();
    if (action === "approve") {
      pushTimeline(returnReq, "EMPLOYEE_APPROVED", note || "Employee approved the return", "employee");
      pushTimeline(returnReq, "PICKUP_SCHEDULED", "Pickup scheduled — awaiting item collection", "system");
    } else {
      pushTimeline(returnReq, newStatus, note || "Employee rejected the return", "employee");
    }
    await returnReq.save();

    // Notify customer
    await notify({
      userId:  returnReq.user,
      title:   action === "approve" ? "Return Approved ✅" : "Return Rejected ❌",
      message: action === "approve"
        ? `Your return for order has been approved! The employee will arrange pickup shortly.${note ? " Note: " + note : ""}`
        : `Your return request has been rejected by the employee.${note ? " Reason: " + note : ""} Contact support to appeal.`,
      type:    "REFUND",
      link:    `/return-status/${returnReq._id}`,
    });

    if (action === "reject") {
      pushTimeline(returnReq, newStatus, "Admin review recommended — employee rejected this return", "system");
      await returnReq.save();
    }

    res.json(new ApiResponse(200, { returnRequest: returnReq }, `Return ${action}d by employee`));
  } catch (err) {
    next(err);
  }
};

/* ─── Employee: advance return through refund pipeline ─── */
export const employeeAdvanceReturn = async (req, res, next) => {
  try {
    const { note } = req.body;

    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(403, "Employee profile not found");

    const employeeProducts = await Product.find({ employee: employee._id }).select("_id");
    const employeeProductIds = employeeProducts.map(p => p._id);

    const returnReq = await ReturnRequest.findOne({
      _id: req.params.requestId,
      $or: [{ employee: employee._id }, { product: { $in: employeeProductIds } }],
    });
    if (!returnReq) throw new ApiError(404, "Return request not found");

    // Employee can advance from APPROVED (admin-approved) or their own pickup pipeline
    const pipeline = {
      APPROVED:         "PICKUP_SCHEDULED",
      PICKUP_SCHEDULED: "ITEM_RECEIVED",
      ITEM_RECEIVED:    "REFUND_INITIATED",
      REFUND_INITIATED: "REFUND_COMPLETED",
    };

    const nextStatus = pipeline[returnReq.status];
    if (!nextStatus) {
      throw new ApiError(400, `Cannot advance return from status '${returnReq.status}'`);
    }

    returnReq.status = nextStatus;

    // Restore stock when item is physically received back
    if (nextStatus === "ITEM_RECEIVED") {
      const populatedOrder = await Order.findById(returnReq.order);
      if (populatedOrder) {
        await Product.bulkWrite(
          populatedOrder.orderItems.map(item => ({
            updateOne: {
              filter: { _id: item.product },
              update: { $inc: { stock: item.quantity, sold: -item.quantity } },
            },
          }))
        );
        await Order.findByIdAndUpdate(returnReq.order, {
          refundStatus: "PROCESSING",
          refundAmount: returnReq.refundAmount,
        });
      }
    }

    if (nextStatus === "REFUND_COMPLETED") {
      returnReq.resolvedAt = new Date();
      await Order.findByIdAndUpdate(returnReq.order, {
        refundStatus: "COMPLETED",
        refundAmount: returnReq.refundAmount,
      });
    }

    pushTimeline(returnReq, nextStatus, note || `Employee marked: ${nextStatus.replace(/_/g, " ")}`, "employee");
    await returnReq.save();

    // Notify customer with rich status messages
    const customerMessages = {
      PICKUP_SCHEDULED: { title: "Pickup Scheduled 🚚",       message: "Your return pickup has been scheduled. Please keep the item ready for collection." },
      ITEM_RECEIVED:    { title: "Item Received 📬",           message: "Your returned item has been received by the employee. Refund processing has started." },
      REFUND_INITIATED: { title: "Refund Initiated 💸",        message: "Your refund has been initiated and is being processed. It may take 3-7 business days." },
      REFUND_COMPLETED: { title: "Refund Completed! 🎉",       message: "Your refund has been completed! The amount will reflect in your account shortly." },
    };
    const cm = customerMessages[nextStatus];
    await notify({
      userId:  returnReq.user,
      title:   cm?.title   || `Return Update: ${nextStatus.replace(/_/g, " ")}`,
      message: (cm?.message || `Your return status is now: ${nextStatus}.`) + (note ? ` ${note}` : ""),
      type:    "REFUND",
      link:    `/return-status/${returnReq._id}`,
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
        .populate("order",   "orderNumber totalPrice orderItems createdAt paymentMethod paymentStatus codBookingAmount codBookingStatus")
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

    // ── Restore stock on APPROVED or ITEM_RECEIVED ──
    if (status === "APPROVED" || status === "ITEM_RECEIVED") {
      await Order.findByIdAndUpdate(returnReq.order._id, {
        refundStatus: "PROCESSING",
        refundAmount: returnReq.refundAmount,
      });

      const itemProductIds = returnReq.order.orderItems.map(i => i.product);
      const stockBefore = await Product.find({ _id: { $in: itemProductIds } }).select("stock").lean();
      const stockMap = Object.fromEntries(stockBefore.map(p => [p._id.toString(), p.stock]));

      await Product.bulkWrite(
        returnReq.order.orderItems.map(item => ({
          updateOne: {
            filter: { _id: item.product },
            update: { $inc: { stock: item.quantity, sold: -item.quantity } },
          },
        }))
      );

      await InventoryLog.insertMany(
        returnReq.order.orderItems.map(item => {
          const old = stockMap[item.product?.toString()] ?? 0;
          return {
            product:         item.product,
            order:           returnReq.order._id,
            changeType:      "RETURN",
            quantityChanged: item.quantity,
            oldStock:        old,
            newStock:        old + item.quantity,
            note:            `Return approved for order ${returnReq.order.orderNumber}`,
            performedBy:     req.user._id,
          };
        })
      );
    }

    // ── AUTO RAZORPAY REFUND when admin sets REFUND_INITIATED (online orders only) ──
    let autoRefundResult = null;
    if (status === "REFUND_INITIATED" && returnReq.order?.paymentMethod === "ONLINE") {
      autoRefundResult = await autoRefund(
        returnReq.order._id,
        returnReq.refundAmount || returnReq.order.totalPrice,
        `Return #${returnReq._id} — ${returnReq.reason}`
      );

      if (autoRefundResult.success) {
        // Auto-advance to REFUND_COMPLETED since Razorpay accepted it
        returnReq.status      = "REFUND_COMPLETED";
        returnReq.resolvedAt  = new Date();
        pushTimeline(
          returnReq,
          "REFUND_COMPLETED",
          `Auto-refunded ₹${autoRefundResult.refundAmount} via Razorpay (ID: ${autoRefundResult.refundId})`,
          "system"
        );
        await Order.findByIdAndUpdate(returnReq.order._id, { refundStatus: "COMPLETED" });
      } else {
        // Razorpay failed — keep status as REFUND_INITIATED, admin must retry or do manual
        pushTimeline(
          returnReq,
          "REFUND_INITIATED",
          `Auto-refund failed: ${autoRefundResult.error}. Manual action required.`,
          "system"
        );
        await Order.findByIdAndUpdate(returnReq.order._id, {
          refundStatus: "PROCESSING",
          refundAmount: returnReq.refundAmount,
        });
      }
    }

    if (["REFUND_COMPLETED", "REPLACEMENT_SENT", "COMPLETED"].includes(returnReq.status)) {
      await Order.findByIdAndUpdate(returnReq.order._id, { refundStatus: "COMPLETED" });
    }

    await returnReq.save();

    // ── Customer notification messages ──
    const finalStatus = returnReq.status;
    const adminStatusMessages = {
      APPROVED:         { title: "Return Approved ✅",    message: "Your return request has been approved. The employee will arrange pickup." },
      REJECTED:         { title: "Return Rejected ❌",    message: "Your return request has been rejected by admin." },
      PICKUP_SCHEDULED: { title: "Pickup Scheduled 🚚",   message: "Your return pickup has been scheduled." },
      ITEM_RECEIVED:    { title: "Item Received 📬",       message: "Your returned item has been received. Refund is being processed." },
      REFUND_INITIATED: { title: "Refund Initiated 💸",    message: "Your refund has been initiated. It may take 3–7 business days to reach your account." },
      REFUND_COMPLETED: {
        title:   "Refund Completed! 🎉",
        message: autoRefundResult?.success
          ? `₹${autoRefundResult.refundAmount} has been refunded to your original payment method. It may take 5–7 business days to reflect.`
          : "Your refund has been marked complete. Please check your account or contact support.",
      },
      REPLACEMENT_SENT: { title: "Replacement Shipped 📦", message: "Your replacement item has been shipped." },
      COMPLETED:        { title: "Return Completed ✅",    message: "Your return/refund case has been fully resolved." },
    };
    const am = adminStatusMessages[finalStatus];

    await notify({
      userId:  returnReq.user,
      title:   am?.title   || "Return Update",
      message: (am?.message || `Your return is now: ${finalStatus.replace(/_/g, " ")}.`) + (adminNote ? ` ${adminNote}` : ""),
      type:    "REFUND",
      link:    `/return-status/${returnReq._id}`,
    });

    // ── Notify employee on approval/rejection ──
    if (returnReq.employee) {
      const employeeMsg = {
        APPROVED: "Admin has approved a return request for your product. Please arrange pickup.",
        REJECTED: "Admin has rejected a return request for your product.",
      }[status];
      if (employeeMsg) {
        await notifyEmployee(returnReq.employee, {
          title:   `Return ${status} by Admin`,
          message: employeeMsg + (adminNote ? ` Note: ${adminNote}` : ""),
          type:    "REFUND",
          link:    "/employee",
        });
      }
    }

    // Build response — include refund outcome so admin UI can show it
    const responseData = { returnRequest: returnReq };
    if (autoRefundResult) {
      responseData.autoRefund = autoRefundResult;
    }

    res.json(new ApiResponse(
      200,
      responseData,
      autoRefundResult?.success
        ? `Return updated — ₹${autoRefundResult.refundAmount} auto-refunded via Razorpay`
        : `Return updated to ${finalStatus}`
    ));
  } catch (err) {
    next(err);
  }
};
