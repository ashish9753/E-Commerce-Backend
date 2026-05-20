import Razorpay from "razorpay";
import crypto from "crypto";
import Order from "../models/order.model.js";
import Payment from "../models/payment.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

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
    const { amount } = req.body;
    if (!amount || amount <= 0) throw new ApiError(400, "Invalid booking amount");

    const razorpayOrder = await getRazorpay().orders.create({
      amount: Math.round(amount * 100),
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await Payment.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        { paymentStatus: "FAILED", failureReason: "Signature mismatch" }
      );
      throw new ApiError(400, "Payment verification failed");
    }

    const [payment, order] = await Promise.all([
      Payment.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        {
          razorpayPaymentId: razorpay_payment_id,
          razorpaySignature: razorpay_signature,
          transactionId: razorpay_payment_id,
          paymentStatus: "SUCCESS",
          paidAt: new Date(),
        },
        { new: true }
      ),
      Order.findByIdAndUpdate(
        orderId,
        { paymentStatus: "PAID", paidAt: new Date() },
        { new: true }
      ),
    ]);

    res.json(new ApiResponse(200, { payment, order }, "Payment verified successfully"));
  } catch (err) {
    next(err);
  }
};

export const getPaymentByOrder = async (req, res, next) => {
  try {
    const payment = await Payment.findOne({ order: req.params.orderId });
    if (!payment) throw new ApiError(404, "Payment record not found");
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

export const initiateRefund = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { refundAmount, reason = "refund" } = req.body;

    const payment = await Payment.findOne({ order: orderId });
    if (!payment) throw new ApiError(404, "No payment record found for this order");
    if (payment.paymentStatus !== "SUCCESS") throw new ApiError(400, "Payment is not in SUCCESS state — cannot refund");
    if (payment.paymentStatus === "REFUNDED") throw new ApiError(400, "Already refunded");
    if (!payment.razorpayPaymentId) throw new ApiError(400, "No Razorpay payment ID on record — cannot initiate refund");

    const amountPaise = Math.round((refundAmount || payment.amount) * 100);

    let refund;
    try {
      refund = await getRazorpay().payments.refund(payment.razorpayPaymentId, {
        amount: amountPaise,
        speed: "normal",
        notes: { orderId: orderId.toString(), reason },
      });
    } catch (rzpErr) {
      const msg = rzpErr?.error?.description || rzpErr?.message || "Razorpay API error";
      throw new ApiError(422, `Razorpay refund failed: ${msg}`);
    }

    const updated = await Payment.findOneAndUpdate(
      { order: orderId },
      {
        paymentStatus: "REFUNDED",
        refundId: refund.id,
        refundAmount: refund.amount / 100,
        refundedAt: new Date(),
      },
      { new: true }
    );

    const order = await Order.findByIdAndUpdate(
      orderId,
      { paymentStatus: "REFUNDED" },
      { new: true }
    );

    res.json(new ApiResponse(200, { refund, payment: updated, order }, "Refund initiated successfully"));
  } catch (err) {
    next(err);
  }
};
