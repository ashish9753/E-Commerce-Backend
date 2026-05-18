import Coupon from "../models/coupon.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createCoupon = async (req, res, next) => {
  try {
    const { code, discountType, discountValue, minimumAmount, maximumDiscount, expiryDate, usageLimit } = req.body;
    if (!code || !discountType || !discountValue || !expiryDate) {
      throw new ApiError(400, "code, discountType, discountValue, and expiryDate are required");
    }
    const coupon = await Coupon.create({ code, discountType, discountValue, minimumAmount, maximumDiscount, expiryDate, usageLimit });
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

export const validateCoupon = async (req, res, next) => {
  try {
    const { code, orderAmount } = req.body;
    if (!code || !orderAmount) throw new ApiError(400, "code and orderAmount required");

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (!coupon) throw new ApiError(404, "Invalid coupon code");

    const validity = coupon.isValid(parseFloat(orderAmount), req.user._id);
    if (!validity.valid) throw new ApiError(400, validity.message);

    const discount = coupon.calculateDiscount(parseFloat(orderAmount));
    res.json(new ApiResponse(200, { discount, finalAmount: parseFloat(orderAmount) - discount, coupon: { _id: coupon._id, code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue } }));
  } catch (err) {
    next(err);
  }
};
