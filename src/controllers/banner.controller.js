import Banner from "../models/banner.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createBanner = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "Banner image is required");
    const { title, link, position, isActive, startDate, endDate } = req.body;

    const result = await uploadToCloudinary(req.file.buffer, "ecommerce/banners");
    const banner = await Banner.create({
      title,
      image: result.secure_url,
      link,
      position: parseInt(position) || 0,
      isActive: isActive !== "false",
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });

    res.status(201).json(new ApiResponse(201, { banner }, "Banner created"));
  } catch (err) {
    next(err);
  }
};

export const getActiveBanners = async (req, res, next) => {
  try {
    const now = new Date();
    const banners = await Banner.find({
      isActive: true,
      $or: [
        { startDate: null, endDate: null },
        { startDate: { $lte: now }, endDate: { $gte: now } },
        { startDate: null, endDate: { $gte: now } },
        { startDate: { $lte: now }, endDate: null },
      ],
    }).sort({ position: 1 });
    res.json(new ApiResponse(200, { banners }));
  } catch (err) {
    next(err);
  }
};

export const getAllBanners = async (req, res, next) => {
  try {
    const banners = await Banner.find().sort({ position: 1, createdAt: -1 });
    res.json(new ApiResponse(200, { banners }));
  } catch (err) {
    next(err);
  }
};

export const updateBanner = async (req, res, next) => {
  try {
    const updates = { ...req.body };
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/banners");
      updates.image = result.secure_url;
    }
    const banner = await Banner.findByIdAndUpdate(req.params.bannerId, updates, { new: true });
    if (!banner) throw new ApiError(404, "Banner not found");
    res.json(new ApiResponse(200, { banner }, "Banner updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteBanner = async (req, res, next) => {
  try {
    await Banner.findByIdAndDelete(req.params.bannerId);
    res.json(new ApiResponse(200, null, "Banner deleted"));
  } catch (err) {
    next(err);
  }
};
