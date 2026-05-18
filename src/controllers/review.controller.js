import Review from "../models/review.model.js";
import Product from "../models/product.model.js";
import Order from "../models/order.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createReview = async (req, res, next) => {
  try {
    const { productId, rating, comment, orderId } = req.body;
    if (!productId || !rating) throw new ApiError(400, "productId and rating are required");
    if (rating < 1 || rating > 5) throw new ApiError(400, "Rating must be between 1 and 5");

    const existing = await Review.findOne({ user: req.user._id, product: productId });
    if (existing) throw new ApiError(409, "You have already reviewed this product");

    let isVerifiedPurchase = false;
    if (orderId) {
      const order = await Order.findOne({
        _id: orderId,
        user: req.user._id,
        "orderItems.product": productId,
        orderStatus: "DELIVERED",
      });
      if (order) isVerifiedPurchase = true;
    }

    let images = [];
    if (req.files?.length) {
      const uploads = await Promise.all(req.files.map((f) => uploadToCloudinary(f.buffer, "ecommerce/reviews")));
      images = uploads.map((r) => r.secure_url);
    }

    const review = await Review.create({
      user: req.user._id,
      product: productId,
      order: orderId || null,
      rating: parseInt(rating),
      comment,
      images,
      isVerifiedPurchase,
    });

    // Update product rating
    const stats = await Review.aggregate([
      { $match: { product: review.product } },
      { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);

    if (stats.length > 0) {
      await Product.findByIdAndUpdate(productId, {
        rating: parseFloat(stats[0].avgRating.toFixed(1)),
        totalReviews: stats[0].count,
      });
    }

    await review.populate("user", "name profileImage");
    res.status(201).json(new ApiResponse(201, { review }, "Review submitted"));
  } catch (err) {
    next(err);
  }
};

export const getProductReviews = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { product: req.params.productId };
    if (req.query.rating) filter.rating = parseInt(req.query.rating);

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .populate("user", "name profileImage")
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 }),
      Review.countDocuments(filter),
    ]);

    const ratingBreakdown = await Review.aggregate([
      { $match: { product: reviews[0]?.product || null } },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ]);

    res.json(new ApiResponse(200, { ...buildPaginatedResponse(reviews, total, page, limit), ratingBreakdown }));
  } catch (err) {
    next(err);
  }
};

export const updateReview = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    const review = await Review.findOne({ _id: req.params.reviewId, user: req.user._id });
    if (!review) throw new ApiError(404, "Review not found");

    if (rating) review.rating = parseInt(rating);
    if (comment !== undefined) review.comment = comment;
    await review.save();

    // Recalculate product rating
    const stats = await Review.aggregate([
      { $match: { product: review.product } },
      { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    if (stats.length > 0) {
      await Product.findByIdAndUpdate(review.product, {
        rating: parseFloat(stats[0].avgRating.toFixed(1)),
        totalReviews: stats[0].count,
      });
    }

    res.json(new ApiResponse(200, { review }, "Review updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteReview = async (req, res, next) => {
  try {
    const query = { _id: req.params.reviewId };
    if (req.user.role !== "admin") query.user = req.user._id;

    const review = await Review.findOneAndDelete(query);
    if (!review) throw new ApiError(404, "Review not found");

    // Recalculate
    const stats = await Review.aggregate([
      { $match: { product: review.product } },
      { $group: { _id: null, avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
    ]);
    await Product.findByIdAndUpdate(review.product, {
      rating: stats[0]?.avgRating ? parseFloat(stats[0].avgRating.toFixed(1)) : 0,
      totalReviews: stats[0]?.count || 0,
    });

    res.json(new ApiResponse(200, null, "Review deleted"));
  } catch (err) {
    next(err);
  }
};
