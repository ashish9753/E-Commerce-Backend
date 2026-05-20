import mongoose from "mongoose";
import InventoryReservation from "../models/inventoryReservation.model.js";

export const RESERVATION_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Returns how many units are available for a given user to reserve.
 * Available = product.stock  −  units held by OTHER users (active reservations only)
 */
export async function getAvailableForUser(productId, userId, productStock) {
  const uid = typeof userId === "string" ? new mongoose.Types.ObjectId(userId) : userId;
  const pid = typeof productId === "string" ? new mongoose.Types.ObjectId(productId) : productId;

  const [result] = await InventoryReservation.aggregate([
    {
      $match: {
        product:   pid,
        user:      { $ne: uid },
        expiresAt: { $gt: new Date() },
      },
    },
    { $group: { _id: null, total: { $sum: "$quantity" } } },
  ]);

  const reservedByOthers = result?.total || 0;
  return Math.max(0, productStock - reservedByOthers);
}

/**
 * Upserts a reservation for this user+product.
 * Resets the 15-minute timer every time.
 */
export async function upsertReservation(userId, productId, quantity) {
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);
  return InventoryReservation.findOneAndUpdate(
    { product: productId, user: userId },
    { quantity, expiresAt },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Releases (deletes) a reservation for this user+product.
 */
export async function releaseReservation(userId, productId) {
  return InventoryReservation.deleteOne({ product: productId, user: userId });
}

/**
 * Releases all reservations for a user (on cart clear / logout).
 */
export async function releaseAllUserReservations(userId) {
  return InventoryReservation.deleteMany({ user: userId });
}

/**
 * Releases reservations for specific products after an order is confirmed.
 */
export async function confirmReservations(userId, productIds) {
  return InventoryReservation.deleteMany({
    user:    userId,
    product: { $in: productIds },
  });
}

/**
 * Returns all active reservations for a user (for cart timer display).
 */
export async function getUserReservations(userId) {
  return InventoryReservation.find({
    user:      userId,
    expiresAt: { $gt: new Date() },
  }).select("product quantity expiresAt").lean();
}
