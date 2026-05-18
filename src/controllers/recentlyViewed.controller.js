import RecentlyViewed from "../models/recentlyViewed.model.js";
import ApiResponse from "../utils/ApiResponse.js";

export const getRecentlyViewed = async (req, res, next) => {
  try {
    const doc = await RecentlyViewed.findOne({ user: req.user._id }).populate({
      path: "products.product",
      select: "title price discountPrice images rating slug",
      match: { isDeleted: false, isPublished: true },
    });

    const products = (doc?.products || [])
      .filter((p) => p.product)
      .sort((a, b) => new Date(b.viewedAt) - new Date(a.viewedAt))
      .slice(0, 20)
      .map((p) => ({ ...p.product.toObject(), viewedAt: p.viewedAt }));

    res.json(new ApiResponse(200, { products }));
  } catch (err) {
    next(err);
  }
};

export const clearRecentlyViewed = async (req, res, next) => {
  try {
    await RecentlyViewed.findOneAndUpdate({ user: req.user._id }, { products: [] });
    res.json(new ApiResponse(200, null, "Recently viewed cleared"));
  } catch (err) {
    next(err);
  }
};
