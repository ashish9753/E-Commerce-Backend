import Notification from "../models/notification.model.js";
import User from "../models/user.model.js";
import { pushToUser } from "./sseClients.js";

/**
 * Create one notification and push it via SSE if the user is connected.
 * @param {{ userId, title, message, type, link?, couponCode? }} opts
 */
export async function notify({ userId, title, message, type, link, couponCode }) {
  try {
    const doc = await Notification.create({
      user: userId,
      title,
      message,
      type,
      ...(link       && { link }),
      ...(couponCode && { couponCode }),
    });
    pushToUser(userId.toString(), { type: "notification", notification: doc });
    return doc;
  } catch { /* never let a notification failure crash the main flow */ }
}

/**
 * Notify all admin users.
 */
export async function notifyAdmins({ title, message, type, link }) {
  try {
    const admins = await User.find({ role: "admin" }).select("_id");
    await Promise.all(admins.map(a => notify({ userId: a._id, title, message, type, link })));
  } catch { /* silent */ }
}

/**
 * Notify the seller user that owns a Seller document.
 * @param {ObjectId|string} sellerId — the Seller._id (not user._id)
 */
export async function notifySeller(sellerId, { title, message, type, link }) {
  try {
    const { default: Seller } = await import("../models/seller.model.js");
    const seller = await Seller.findById(sellerId).select("user");
    if (seller?.user) await notify({ userId: seller.user, title, message, type, link });
  } catch { /* silent */ }
}
