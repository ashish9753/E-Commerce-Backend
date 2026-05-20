import Cart from "../models/cart.model.js";
import Product from "../models/product.model.js";
import Coupon from "../models/coupon.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

const getOrCreateCart = async (userId) => {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
};

export const getCart = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id }).populate({
      path: "items.product",
      select: "title price discountPrice images stock isDeleted isPublished",
    }).populate("coupon", "code discountType discountValue");

    if (!cart) return res.json(new ApiResponse(200, { cart: { items: [], totalItems: 0, totalPrice: 0, finalPrice: 0 } }));

    // Remove deleted/unpublished products
    cart.items = cart.items.filter((item) => item.product && !item.product.isDeleted && item.product.isPublished);
    cart.recalculate();
    await cart.save();

    res.json(new ApiResponse(200, { cart }));
  } catch (err) {
    next(err);
  }
};

export const addToCart = async (req, res, next) => {
  try {
    const { productId, quantity = 1 } = req.body;
    if (!productId) throw new ApiError(400, "productId is required");

    const qty = Math.max(1, parseInt(quantity));
    const product = await Product.findOne({ _id: productId, isDeleted: false, isPublished: true });
    if (!product) throw new ApiError(404, "Product not found");
    if (product.stock === 0) throw new ApiError(400, "This product is out of stock");

    const price = product.discountPrice || product.price;
    const cart = await getOrCreateCart(req.user._id);

    const existingIndex = cart.items.findIndex((i) => i.product.toString() === productId);
    if (existingIndex > -1) {
      cart.items[existingIndex].quantity += qty;
    } else {
      cart.items.push({ product: productId, quantity: qty, price });
    }

    cart.recalculate();
    await cart.save();
    await cart.populate("items.product", "title price discountPrice images stock");

    res.json(new ApiResponse(200, { cart }, "Item added to cart"));
  } catch (err) {
    next(err);
  }
};

export const updateCartItem = async (req, res, next) => {
  try {
    const { productId, quantity } = req.body;
    const qty = parseInt(quantity);
    if (!productId || qty < 1) throw new ApiError(400, "Valid productId and quantity required");

    const product = await Product.findById(productId);
    if (!product) throw new ApiError(404, "Product not found");

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) throw new ApiError(404, "Cart not found");

    const item = cart.items.find((i) => i.product.toString() === productId);
    if (!item) throw new ApiError(404, "Item not in cart");

    item.quantity = qty;
    cart.recalculate();
    await cart.save();

    res.json(new ApiResponse(200, { cart }, "Cart updated"));
  } catch (err) {
    next(err);
  }
};

export const removeFromCart = async (req, res, next) => {
  try {
    const { productId } = req.params;
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) throw new ApiError(404, "Cart not found");

    cart.items = cart.items.filter((i) => i.product.toString() !== productId);
    cart.recalculate();
    await cart.save();

    res.json(new ApiResponse(200, { cart }, "Item removed from cart"));
  } catch (err) {
    next(err);
  }
};

export const clearCart = async (req, res, next) => {
  try {
    await Cart.findOneAndUpdate(
      { user: req.user._id },
      { items: [], coupon: null, totalItems: 0, totalPrice: 0, discountAmount: 0, finalPrice: 0 }
    );
    res.json(new ApiResponse(200, null, "Cart cleared"));
  } catch (err) {
    next(err);
  }
};

export const applyCoupon = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) throw new ApiError(400, "Coupon code required");

    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart || cart.items.length === 0) throw new ApiError(400, "Cart is empty");

    const coupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (!coupon) throw new ApiError(404, "Invalid coupon code");

    const validity = coupon.isValid(cart.totalPrice, req.user._id);
    if (!validity.valid) throw new ApiError(400, validity.message);

    const discount = coupon.calculateDiscount(cart.totalPrice);
    cart.coupon = coupon._id;
    cart.discountAmount = discount;
    cart.finalPrice = cart.totalPrice - discount;
    await cart.save();

    res.json(new ApiResponse(200, { discount, finalPrice: cart.finalPrice }, `Coupon applied! You saved ₹${discount}`));
  } catch (err) {
    next(err);
  }
};

export const removeCoupon = async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ user: req.user._id });
    if (!cart) throw new ApiError(404, "Cart not found");

    cart.coupon = null;
    cart.discountAmount = 0;
    cart.finalPrice = cart.totalPrice;
    await cart.save();

    res.json(new ApiResponse(200, { cart }, "Coupon removed"));
  } catch (err) {
    next(err);
  }
};
