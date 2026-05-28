import Coupon from "../models/coupon.model.js";
import Cart from "../models/cart.model.js";
import Order from "../models/order.model.js";
import Product from "../models/product.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import { validateCouponAudience } from "../utils/couponAudience.utils.js";
import { computeCouponEligibility } from "../utils/couponEligibility.utils.js";
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
    const {
      code, discountType, discountValue, minimumAmount, maximumDiscount,
      expiryDate, usageLimit, visibility,
      applicableBrands, applicableCategories, applicableSubcategories,
      freebieProduct, freebieQuantity,
    } = req.body;
    if (!code || !discountType || !expiryDate) {
      throw new ApiError(400, "code, discountType, and expiryDate are required");
    }
    const needsDiscountValue = discountType !== "FREEBIE" && discountType !== "FREE_SHIPPING";
    if (needsDiscountValue && !discountValue) {
      throw new ApiError(400, "discountValue is required for PERCENTAGE / FIXED coupons");
    }
    if (discountType === "FREEBIE") {
      if (!freebieProduct) throw new ApiError(400, "freebieProduct is required for FREEBIE coupons");
      const exists = await Product.findOne({ _id: freebieProduct, isDeleted: false }).select("_id");
      if (!exists) throw new ApiError(400, "freebieProduct does not exist");
    }
    const coupon = await Coupon.create({
      code, discountType,
      discountValue: needsDiscountValue ? discountValue : 0,
      minimumAmount, maximumDiscount, expiryDate, usageLimit, visibility,
      applicableBrands, applicableCategories, applicableSubcategories,
      freebieProduct:  discountType === "FREEBIE" ? freebieProduct : null,
      freebieQuantity: discountType === "FREEBIE" ? (Number(freebieQuantity) || 1) : 1,
    });
    res.status(201).json(new ApiResponse(201, { coupon }, "Coupon created"));
  } catch (err) {
    next(err);
  }
};

export const getAllCoupons = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const [coupons, total] = await Promise.all([
      Coupon.find()
        .populate("freebieProduct", "title images stock")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
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
    // Whitelist updatable fields — prevents tampering with usedCount/usedBy/code.
    const ALLOWED = [
      "discountType", "discountValue", "minimumAmount", "maximumDiscount",
      "expiryDate", "usageLimit", "visibility", "isActive",
      "applicableBrands", "applicableCategories", "applicableSubcategories",
      "freebieProduct", "freebieQuantity",
    ];
    const updates = {};
    for (const k of ALLOWED) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    // Cross-field invariants when the type is being changed.
    if (updates.discountType === "FREEBIE") {
      if (!updates.freebieProduct) {
        const existing = await Coupon.findById(req.params.couponId).select("freebieProduct");
        if (!existing?.freebieProduct) throw new ApiError(400, "freebieProduct is required for FREEBIE coupons");
      }
      updates.discountValue = 0;
    } else if (updates.discountType === "FREE_SHIPPING") {
      updates.discountValue   = 0;
      updates.freebieProduct  = null;
      updates.freebieQuantity = 1;
    } else if (updates.discountType && updates.discountType !== "FREEBIE") {
      updates.freebieProduct  = null;
      updates.freebieQuantity = 1;
    }
    const coupon = await Coupon.findByIdAndUpdate(req.params.couponId, updates, { new: true, runValidators: true });
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

    const coupons = await Coupon.find(query)
      .populate("freebieProduct", "title images")
      .sort({ createdAt: -1 }).limit(10);
    res.json(new ApiResponse(200, { coupons }));
  } catch (err) {
    next(err);
  }
};

export const validateCoupon = async (req, res, next) => {
  try {
    const code = normalizeCouponCode(req.body?.code);
    if (!code) throw new ApiError(400, "Invalid coupon code");

    const coupon = await Coupon.findOne({ code }).populate("freebieProduct", "title images stock price discountPrice isDeleted isPublished");
    if (!coupon) throw new ApiError(404, "Invalid coupon code");

    const audience = await validateCouponAudience(coupon, req.user._id);
    if (!audience.valid) throw new ApiError(400, audience.message);

    // FREEBIE coupons need a still-available product on the other side.
    if (coupon.discountType === "FREEBIE") {
      const p = coupon.freebieProduct;
      if (!p || p.isDeleted || !p.isPublished) {
        throw new ApiError(400, "The free gift on this coupon is no longer available");
      }
      if ((p.stock ?? 0) < (coupon.freebieQuantity || 1)) {
        throw new ApiError(400, "Sorry, the free gift on this coupon is out of stock");
      }
    }

    // Always price against server-known data — never trust a client-supplied
    // amount. For Buy Now (directItem), validate against that single product;
    // otherwise validate against the user's cart.
    const directItem = req.body?.directItem;
    let items;
    let orderAmount;

    if (directItem?.productId) {
      if (!/^[0-9a-fA-F]{24}$/.test(String(directItem.productId))) {
        throw new ApiError(400, "Invalid productId");
      }
      const qty = parseInt(directItem.quantity, 10);
      if (!Number.isFinite(qty) || qty < 1 || qty > 50) {
        throw new ApiError(400, "Quantity must be between 1 and 50");
      }
      const product = await Product.findOne({
        _id: directItem.productId,
        isDeleted: false,
        isPublished: true,
      }).select("brand category price discountPrice");
      if (!product) throw new ApiError(404, "Product not found");
      const price = product.discountPrice || product.price;
      items = [{ product: { brand: product.brand, category: product.category }, price, quantity: qty }];
      orderAmount = price * qty;
    } else {
      const cart = await Cart.findOne({ user: req.user._id }).populate("items.product", "brand category");
      if (!cart || cart.items.length === 0) throw new ApiError(400, "Cart is empty");
      items = cart.items;
      orderAmount = cart.totalPrice;
    }

    // Check minimum order against the full cart total.
    const validity = coupon.isValid(orderAmount, req.user._id);
    if (!validity.valid) throw new ApiError(400, validity.message);

    const { applicableAmount, hasRestrictions } = await computeCouponEligibility(coupon, items);
    if (hasRestrictions && applicableAmount <= 0) {
      throw new ApiError(400, directItem
        ? "This coupon is not applicable to this product"
        : "This coupon is not applicable to any item in your cart");
    }

    const discount = coupon.calculateDiscount(applicableAmount);
    const freebie = coupon.discountType === "FREEBIE" && coupon.freebieProduct
      ? {
          _id:       coupon.freebieProduct._id,
          title:     coupon.freebieProduct.title,
          image:     coupon.freebieProduct.images?.[0] || "",
          quantity:  coupon.freebieQuantity || 1,
        }
      : null;
    const freeShipping = coupon.discountType === "FREE_SHIPPING";
    res.json(new ApiResponse(200, {
      discount,
      finalAmount: parseFloat((orderAmount - discount).toFixed(2)),
      freebie,
      freeShipping,
      coupon: {
        _id: coupon._id,
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        freebieQuantity: coupon.freebieQuantity,
      },
    }));
  } catch (err) {
    next(err);
  }
};
