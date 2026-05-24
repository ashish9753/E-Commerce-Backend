import Coupon from "../models/coupon.model.js";
import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import { validateCouponAudience } from "../utils/couponAudience.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

// See cart.controller.js — same pattern; coupon codes must be a literal string,
// not an object/array (which would otherwise reach Mongo as a query operator).
const COUPON_CODE_RE = /^[A-Z0-9_-]{2,32}$/;
const normalizeCouponCode = (raw) => {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return COUPON_CODE_RE.test(code) ? code : null;
};

export const createCoupon = async (req, res, next) => {
  try {
    const { code, discountType, discountValue, minimumAmount, maximumDiscount, expiryDate, usageLimit, visibility } = req.body;
    if (!code || !discountType || !discountValue || !expiryDate) {
      throw new ApiError(400, "code, discountType, discountValue, and expiryDate are required");
    }
    const coupon = await Coupon.create({ code, discountType, discountValue, minimumAmount, maximumDiscount, expiryDate, usageLimit, visibility });
    res.status(201).json(new ApiResponse(201, { coupon }, "Coupon created"));
  } catch (err) {
    next(err);
  }
};

export const getAllCoupons = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const [coupons, total] = await Promise.all([
      Coupon.find().skip(skip).limit(limit).sort({ createdAt: -1 }),
      Coupon.countDocuments(),
    ]);
    res.json(new ApiResponse(200, buildPaginatedResponse(coupons, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getCouponById = async (req, res, next) => {
  try {
    const coupon = await Coupon.findById(req.params.couponId);
    if (!coupon) throw new ApiError(404, "Coupon not found");
    res.json(new ApiResponse(200, { coupon }));
  } catch (err) {
    next(err);
  }
};

export const updateCoupon = async (req, res, next) => {
  try {
    const coupon = await Coupon.findByIdAndUpdate(req.params.couponId, req.body, { new: true, runValidators: true });
    if (!coupon) throw new ApiError(404, "Coupon not found");
    res.json(new ApiResponse(200, { coupon }, "Coupon updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteCoupon = async (req, res, next) => {
  try {
    await Coupon.findByIdAndDelete(req.params.couponId);
    res.json(new ApiResponse(200, null, "Coupon deleted"));
  } catch (err) {
    next(err);
  }
};

// Public endpoint: returns active, non-hidden coupons filtered by user status.
// new_users coupons are shown only when the requester has no prior orders.
export const getPublicCoupons = async (req, res, next) => {
  try {
    const now = new Date();
    const query = {
      isActive: true,
      expiryDate: { $gt: now },
      visibility: { $ne: 'hidden' },
    };

    let isNewUser = true;
    if (req.user) {
      const orderCount = await Order.countDocuments({ user: req.user._id });
      isNewUser = orderCount === 0;
    }

    if (!isNewUser) {
      query.visibility = 'everyone';
    }

    const coupons = await Coupon.find(query).sort({ createdAt: -1 }).limit(10);
    res.json(new ApiResponse(200, { coupons }));
  } catch (err) {
    next(err);
  }
};

export const validateCoupon = async (req, res, next) => {
  try {
    const code = normalizeCouponCode(req.body?.code);
    if (!code) throw new ApiError(400, "Invalid coupon code");

    // Always price against the server cart — never trust a client-supplied amount.
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) throw new ApiError(400, "Cart is empty");
    const orderAmount = cart.totalPrice;

    const coupon = await Coupon.findOne({ code });
    if (!coupon) throw new ApiError(404, "Invalid coupon code");

    const validity = coupon.isValid(orderAmount, req.user._id);
    if (!validity.valid) throw new ApiError(400, validity.message);

    const audience = await validateCouponAudience(coupon, req.user._id);
    if (!audience.valid) throw new ApiError(400, audience.message);

    const discount = coupon.calculateDiscount(orderAmount);
    res.json(new ApiResponse(200, {
      discount,
      finalAmount: parseFloat((orderAmount - discount).toFixed(2)),
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
      },
    }));
  } catch (err) {
    next(err);
  }
};
