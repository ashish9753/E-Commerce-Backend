import Razorpay from "razorpay";
import Payment from "../models/payment.model.js";
import Order from "../models/order.model.js";

let _razorpay = null;
const getRazorpay = () => {
  if (!_razorpay) {
    if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith("rzp_test_dummy")) {
      return null; // gracefully disabled in dev
    }
    _razorpay = new Razorpay({
      key_id:    process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _razorpay;
};

/**
 * Attempt an automatic Razorpay refund for an online-paid order.
 *
 * @param {string} orderId        — MongoDB Order._id
 * @param {number} [amount]       — Refund amount in rupees (defaults to full payment)
 * @param {string} [reason]       — Label stored in Razorpay notes
 * @returns {{ success, refund?, error? }}
 */
export async function autoRefund(orderId, amount, reason = "refund") {
  const rz = getRazorpay();
  if (!rz) {
    return { success: false, error: "Razorpay not configured — manual refund required" };
  }

  const payment = await Payment.findOne({ order: orderId });
  if (!payment) {
    return { success: false, error: "No payment record found for this order" };
  }
  if (payment.paymentStatus !== "SUCCESS") {
    return { success: false, error: `Payment status is '${payment.paymentStatus}' — cannot refund` };
  }
  if (payment.paymentStatus === "REFUNDED") {
    return { success: false, error: "Already refunded" };
  }
  if (!payment.razorpayPaymentId) {
    return { success: false, error: "No Razorpay payment ID on record" };
  }

  const amountPaise = Math.round((amount ?? payment.amount) * 100);

  try {
    const refund = await rz.payments.refund(payment.razorpayPaymentId, {
      amount: amountPaise,
      speed: "normal",
      notes: { orderId: orderId.toString(), reason },
    });

    // Update payment record
    await Payment.findOneAndUpdate(
      { order: orderId },
      {
        paymentStatus: "REFUNDED",
        refundId:      refund.id,
        refundAmount:  refund.amount / 100,
        refundedAt:    new Date(),
      }
    );

    // Update order payment status
    await Order.findByIdAndUpdate(orderId, {
      paymentStatus: "REFUNDED",
      refundStatus:  "COMPLETED",
      refundAmount:  refund.amount / 100,
    });

    return { success: true, refund, refundId: refund.id, refundAmount: refund.amount / 100 };
  } catch (err) {
    const msg = err?.error?.description || err?.message || "Razorpay API error";
    return { success: false, error: msg };
  }
}
