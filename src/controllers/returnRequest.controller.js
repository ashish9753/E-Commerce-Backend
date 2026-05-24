import ReturnRequest from "../models/returnRequest.model.js";
import Order         from "../models/order.model.js";
import Product       from "../models/product.model.js";
import Employee      from "../models/employee.model.js";
import InventoryLog  from "../models/inventoryLog.model.js";
import User          from "../models/user.model.js";
import { notify, notifyEmployee, notifyAdmins } from "../utils/notify.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError    from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { uploadToCloudinary, uploadVideoToCloudinary } from "../utils/cloudinary.utils.js";

const pushTimeline = (doc, status, note, by = "system") => {
  doc.timeline.push({ status, note, by, at: new Date() });
};

const parseBankDetails = (details) => {
  if (!details) return {};
  if (typeof details !== "string") return details;
  try {
    return JSON.parse(details);
  } catch {
    return {};
  }
};

const sanitizeBankDetails = (refundMethod, details = {}) => {
  if (refundMethod === "upi") {
    const upiId = String(details.upiId || "").trim();
    if (!upiId) throw new ApiError(400, "UPI ID is required");
    return { upiId };
  }

  const bank = {
    accountName: String(details.accountName || "").trim(),
    accountNumber: String(details.accountNumber || "").trim(),
    ifscCode: String(details.ifscCode || "").trim().toUpperCase(),
    bankName: String(details.bankName || "").trim(),
  };
  if (!bank.accountName || !bank.accountNumber || !bank.ifscCode || !bank.bankName) {
    throw new ApiError(400, "Bank account name, number, IFSC code, and bank name are required");
  }
  return bank;
};

const saveUserRefundDetails = async (userId, refundMethod, bankDetails) => {
  if (refundMethod === "upi") {
    await User.findByIdAndUpdate(userId, {
      $set: {
        "savedRefundDetails.upi": { upiId: bankDetails.upiId },
        "savedRefundDetails.lastRefundMethod": "upi",
      },
    });
    return;
  }

  await User.findByIdAndUpdate(userId, {
    $set: {
      "savedRefundDetails.bankTransfer": {
        accountName: bankDetails.accountName,
        accountNumber: bankDetails.accountNumber,
        ifscCode: bankDetails.ifscCode,
        bankName: bankDetails.bankName,
      },
      "savedRefundDetails.lastRefundMethod": "bank_transfer",
    },
  });
};

/* ─── Customer: submit return ─── */
export const createReturnRequest = async (req, res, next) => {
  try {
    const { orderId, productId, reason, description, resolution, refundMethod: bodyRefundMethod, bankDetails: bodyBankDetails } = req.body;
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

    // If productId provided, ensure it actually belongs to this order
    if (productId) {
      const orderProductIds = order.orderItems.map(i => i.product?.toString());
      if (!orderProductIds.includes(productId.toString())) {
        throw new ApiError(400, "Product is not part of this order");
      }
    }

    // Find which employee owns the product — fall back to first item in order if no productId given
    let employeeId = null;
    const lookupId = productId || order.orderItems?.[0]?.product;
    let returnableProduct = null;
    
    if (!lookupId) {
      throw new ApiError(400, "No product found in order for return request");
    }
    
    returnableProduct = await Product.findById(lookupId).select("employee returnable returnWindow");
    if (!returnableProduct) {
      throw new ApiError(404, "Product not found");
    }
    
    employeeId = returnableProduct.employee;
    if (!employeeId) {
      throw new ApiError(400, "Product is not assigned to any employee");
    }

    // Validate return policy
    if (returnableProduct.returnable === false) {
      throw new ApiError(400, "This product is non-returnable and cannot be returned.");
    }

    const returnWindowDays = returnableProduct?.returnWindow || 7;
    const deliveredAt = order.deliveredAt || order.updatedAt;
    const windowMs = returnWindowDays * 24 * 60 * 60 * 1000;
    if (Date.now() - new Date(deliveredAt).getTime() > windowMs) {
      throw new ApiError(400, `Return window of ${returnWindowDays} days has expired. Returns are only accepted within ${returnWindowDays} days of delivery.`);
    }

    const requestedResolution = resolution || "refund";
    const validMethods = ["bank_transfer", "upi"];
    const chosenRefundMethod = validMethods.includes(bodyRefundMethod) ? bodyRefundMethod : "bank_transfer";
    const parsedBankDetails = requestedResolution === "refund"
      ? sanitizeBankDetails(chosenRefundMethod, parseBankDetails(bodyBankDetails))
      : undefined;

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
      resolution:   requestedResolution,
      refundAmount: refundableAmount,
      ...(requestedResolution === "refund" && {
        refundMethod: chosenRefundMethod,
        bankDetails:  parsedBankDetails,
      }),
      evidence,
      timeline: [{ status: "REQUESTED", note: "Return request submitted by customer", by: "system" }],
    });

    if (requestedResolution === "refund") {
      await saveUserRefundDetails(req.user._id, chosenRefundMethod, parsedBankDetails);
    }

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
export const getSavedRefundDetails = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).select("savedRefundDetails");
    res.json(new ApiResponse(200, { savedRefundDetails: user?.savedRefundDetails || {} }));
  } catch (err) {
    next(err);
  }
};

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
    const valid = ["bank_transfer", "upi"];
    if (!valid.includes(refundMethod)) throw new ApiError(400, "Invalid refundMethod");

    const ret = await ReturnRequest.findOne({ _id: req.params.requestId, user: req.user._id });
    if (!ret) throw new ApiError(404, "Return request not found");
    if (!["REQUESTED", "EMPLOYEE_APPROVED", "APPROVED"].includes(ret.status)) {
      throw new ApiError(400, "Refund method cannot be changed at this stage");
    }

    // COD orders cannot refund to original payment — enforce server-side
    ret.refundMethod = refundMethod;
    const parsedBankDetails = sanitizeBankDetails(refundMethod, bankDetails);
    ret.bankDetails = parsedBankDetails;
    ret.timeline.push({ status: ret.status, note: `Customer set refund method to ${refundMethod}`, by: "customer" });
    await ret.save();
    await saveUserRefundDetails(req.user._id, refundMethod, parsedBankDetails);

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

/* ─── Employee / Admin: get all return requests ─── */
export const getEmployeeReturnRequests = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.status) filter.status = req.query.status;

    const [requests, total] = await Promise.all([
      ReturnRequest.find(filter)
        .populate("user",    "name email")
        .populate("order",   "orderNumber totalPrice orderItems createdAt")
        .populate("product", "title images")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      ReturnRequest.countDocuments(filter),
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

    // Upload refund proof screenshots (optional — meaningful for REFUND_INITIATED/COMPLETED)
    const proofFiles = req.files || [];
    if (proofFiles.length > 0) {
      for (const file of proofFiles) {
        const result = await uploadToCloudinary(file.buffer, "returns/refund-proof");
        returnReq.refundProof.push({
          url: result.secure_url,
          publicId: result.public_id,
          uploadedBy: "employee",
          uploadedAt: new Date(),
        });
      }
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
    if (refundAmount !== undefined) {
      const amt = Number(refundAmount);
      if (!Number.isFinite(amt) || amt < 0) {
        throw new ApiError(400, "Invalid refund amount");
      }
      // Cap to order's refundable amount (excluding non-refundable COD booking)
      const orderTotal = returnReq.order?.totalPrice || 0;
      const nonRefundable = (returnReq.order?.codBookingStatus === "PAID" && returnReq.order?.codBookingAmount > 0)
        ? returnReq.order.codBookingAmount : 0;
      const maxRefundable = Math.max(0, orderTotal - nonRefundable);
      returnReq.refundAmount = Math.min(amt, maxRefundable);
    }
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

    // ── Upload refund proof screenshots (optional) ──
    const proofFiles = req.files || [];
    if (proofFiles.length > 0) {
      for (const file of proofFiles) {
        const result = await uploadToCloudinary(file.buffer, "returns/refund-proof");
        returnReq.refundProof.push({
          url: result.secure_url,
          publicId: result.public_id,
          uploadedBy: "admin",
          uploadedAt: new Date(),
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
      REFUND_COMPLETED: { title: "Refund Completed! 🎉",   message: "Your refund has been marked complete. Please check your account or contact support if needed." },
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

    res.json(new ApiResponse(200, { returnRequest: returnReq }, `Return updated to ${finalStatus}`));
  } catch (err) {
    next(err);
  }
};
