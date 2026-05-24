import Order from "../models/order.model.js";

export const getCouponAudienceMessage = (visibility) => {
  if (visibility === "new_users") {
    return "This coupon is only for first-order users";
  }
  return null;
};

export const validateCouponAudience = async (coupon, userId) => {
  if (!coupon || coupon.visibility !== "new_users") {
    return { valid: true };
  }

  if (!userId) {
    return { valid: false, message: "Please sign in to use this first-order coupon" };
  }

  const orderCount = await Order.countDocuments({ user: userId });
  if (orderCount > 0) {
    return { valid: false, message: getCouponAudienceMessage(coupon.visibility) };
  }

  return { valid: true };
};
