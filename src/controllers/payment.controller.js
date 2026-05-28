import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import Employee from "../models/employee.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { notify, notifyAdmins } from "../utils/notify.js";

let _razorpay = null;
const getRazorpay = () => {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_dummy')) {
      throw new ApiError(503, "Online payments are disabled in this environment");
    }
    _razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
};

export const createBookingOrder = async (req, res, next) => {
  try {
    const amt = Number(req.body?.amount);
    if (!Number.isFinite(amt) || amt <= 0) throw new ApiError(400, "Invalid booking amount");
    // Sanity cap — booking should never exceed 1 lakh; protects against malformed clients
    if (amt > 100000) throw new ApiError(400, "Booking amount exceeds allowed limit");

    const razorpayOrder = await getRazorpay().orders.create({
      amount: Math.round(amt * 100),
      currency: "INR",
      receipt: `bkg_${Date.now().toString().slice(-10)}`,
      notes: { type: "cod_booking", userId: req.user._id.toString() },
    });

    res.json(new ApiResponse(200, {
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    }));
  } catch (err) {
    next(err);
  }
};

export const createRazorpayOrder = async (req, res, next) => {
  try {
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) throw new ApiError(404, "Order not found");
    if (order.user.toString() !== req.user._id.toString()) throw new ApiError(403, "Access denied");
    if (order.paymentStatus === "PAID") throw new ApiError(400, "Order already paid");

    const razorpayOrder = await getRazorpay().orders.create({
      amount: Math.round(order.totalPrice * 100),
      currency: "INR",
      receipt: order.orderNumber,
      notes: { orderId: order._id.toString(), userId: req.user._id.toString() },
    });

    await Payment.findOneAndUpdate(
      { order: orderId },
      {
        order: orderId,
        user: req.user._id,
        paymentGateway: "RAZORPAY",
        razorpayOrderId: razorpayOrder.id,
        amount: order.totalPrice,
        paymentStatus: "PENDING",
      },
      { upsert: true, new: true }
    );

    res.json(new ApiResponse(200, {
      razorpayOrderId: razorpayOrder.id,
      amount: razorpayOrder.amount,
      currency: razorpayOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    }));
  } catch (err) {
    next(err);
  }
};

export const verifyRazorpayPayment = async (req, res, next) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      throw new ApiError(400, "Missing payment verification parameters");
    }

    // Constant-time HMAC compare to avoid timing attacks
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");
    const expectedBuf = Buffer.from(expected, "hex");
    const givenBuf = Buffer.from(razorpay_signature || "", "hex");
    const signatureOk = expectedBuf.length === givenBuf.length &&
      crypto.timingSafeEqual(expectedBuf, givenBuf);

    if (!signatureOk) {
      await Payment.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        { paymentStatus: "FAILED", failureReason: "Signature mismatch" }
      );
      throw new ApiError(400, "Payment verification failed");
    }

    // Resolve order from the Payment record (server-side) rather than trusting client orderId.
    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
    if (!payment) throw new ApiError(404, "Payment record not found");
    if (payment.user.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "This payment does not belong to you");
    }
    if (payment.paymentStatus === "SUCCESS") {
      // Idempotent — already verified
      const existingOrder = await Order.findById(payment.order);
      return res.json(new ApiResponse(200, { payment, order: existingOrder }, "Payment already verified"));
    }

    const order = await Order.findById(payment.order);
    if (!order) throw new ApiError(404, "Order not found");
    if (order.user.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Order does not belong to you");
    }

    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    payment.transactionId = razorpay_payment_id;
    payment.paymentStatus = "SUCCESS";
    payment.paidAt = new Date();
    await payment.save();

    order.paymentStatus = "PAID";
    order.paidAt = new Date();
    await order.save();

    // Notify all employees + admins now that payment is confirmed
    setImmediate(async () => {
      try {
        const allEmployees = await Employee.find({}).select("user").lean();
        for (const emp of allEmployees) {
          if (emp.user) {
            await notify({
              userId:  emp.user,
              title:   "New Order Received! 📦",
              message: `Order #${order.orderNumber} has been placed and payment confirmed. Please confirm and process it.`,
              type:    "ORDER",
              link:    "/employee",
            });
          }
        }
        await notifyAdmins({
          title:   "Payment Received 💳",
          message: `Order #${order.orderNumber} (₹${order.totalPrice}) — online payment confirmed.`,
          type:    "PAYMENT",
          link:    "/admin",
        });
      } catch { /* non-critical */ }
    });

    res.json(new ApiResponse(200, { payment, order }, "Payment verified successfully"));
  } catch (err) {
    next(err);
  }
};

export const getPaymentByOrder = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ order: req.params.orderId });
    if (!payment) throw new ApiError(404, "Payment record not found");
    if (req.user.role !== "admin" && payment.user.toString() !== req.user._id.toString()) {
      throw new ApiError(403, "Access denied");
    }
    res.json(new ApiResponse(200, { payment }));
  } catch (err) {
    next(err);
  }
};

export const getAllPayments = async (req, res, next) => {
  try {
    const payments = await Payment.find()
      .populate("user", "name email")
      .populate("order", "orderNumber totalPrice orderStatus")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(new ApiResponse(200, { payments }));
  } catch (err) {
    next(err);
  }
};

