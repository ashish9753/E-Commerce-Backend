import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import { notify } from "../utils/notify.js";

// Online orders that sit unpaid for this many minutes are auto-cancelled
// and stock is restored. Tunable via env (PENDING_ORDER_TIMEOUT_MIN).
const TIMEOUT_MIN = parseInt(process.env.PENDING_ORDER_TIMEOUT_MIN || "30", 10);
const SCAN_INTERVAL_MS = 60_000; // every minute

let timer = null;

const sweepOnce = async () => {
  const now = Date.now();
  const cutoff = new Date(now - TIMEOUT_MIN * 60_000);
  // Halfway through the window — send a single reminder if we haven't already.
  const reminderCutoff = new Date(now - (TIMEOUT_MIN / 2) * 60_000);

  try {
    // --- Reminder pass: halfway through the timeout, nudge once ---
    const reminderTargets = await Order.find({
      paymentMethod: "ONLINE",
      paymentStatus: "PENDING",
      orderStatus:   "PLACED",
      createdAt:     { $lt: reminderCutoff, $gte: cutoff },
      paymentReminderSentAt: null,
    }).limit(100);

    for (const order of reminderTargets) {
      try {
        order.paymentReminderSentAt = new Date();
        await order.save();
        const minutesLeft = Math.max(1, Math.ceil(
          (new Date(order.createdAt).getTime() + TIMEOUT_MIN * 60_000 - now) / 60_000
        ));
        await notify({
          userId:  order.user,
          title:   "Reminder: Payment Pending ⏰",
          message: `Order ${order.orderNumber} is still awaiting payment. Please confirm payment or cancel — auto-cancels in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.`,
          type:    "ORDER",
          link:    "/orders",
        });
      } catch (err) {
        console.error(`[orderTimeout] reminder failed for ${order._id}:`, err.message);
      }
    }

    // --- Cancel pass: orders past the full window ---
    // Anchor on createdAt (when the order was placed). Status must still be PLACED —
    // if the employee already confirmed it, we leave it alone so they can chase the customer.
    const stale = await Order.find({
      paymentMethod: "ONLINE",
      paymentStatus: "PENDING",
      orderStatus:   "PLACED",
      createdAt:     { $lt: cutoff },
    }).limit(50);

    if (!stale.length) return;
    console.log(`[orderTimeout] auto-cancelling ${stale.length} stale unpaid order(s)`);

    for (const order of stale) {
      try {
        order.orderStatus = "CANCELLED";
        order.cancellationReason = `Auto-cancelled — payment not completed within ${TIMEOUT_MIN} minutes`;
        order.statusHistory.push({
          status: "CANCELLED",
          note:   order.cancellationReason,
        });
        await order.save();

        // Restore stock for every item — same pattern as manual cancel.
        await Product.bulkWrite(
          order.orderItems.map(item => ({
            updateOne: {
              filter: { _id: item.product },
              update: { $inc: { stock: item.quantity, sold: -item.quantity } },
            },
          }))
        );

        await notify({
          userId:  order.user,
          title:   "Order Auto-Cancelled ⏱️",
          message: `Your order #${order.orderNumber} was cancelled because payment wasn't completed within ${TIMEOUT_MIN} minutes. You can place it again from your cart.`,
          type:    "ORDER",
          link:    "/orders",
        });
      } catch (err) {
        console.error(`[orderTimeout] failed to cancel order ${order._id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[orderTimeout] sweep failed:", err.message);
  }
};

export const startOrderTimeoutJob = () => {
  if (timer) return;
  console.log(`[orderTimeout] started — unpaid online orders expire after ${TIMEOUT_MIN} minutes`);
  // Run once shortly after boot, then on the interval.
  setTimeout(sweepOnce, 10_000);
  timer = setInterval(sweepOnce, SCAN_INTERVAL_MS);
  timer.unref?.();
};

export const stopOrderTimeoutJob = () => {
  if (timer) { clearInterval(timer); timer = null; }
};

// Exported so tests / admin tools can trigger a sweep on demand.
export { sweepOnce as sweepStaleOrdersNow, TIMEOUT_MIN as ORDER_TIMEOUT_MIN };
