import Banner from "../models/banner.model.js";
import { uploadToCloudinary, deleteFromCloudinary, getPublicIdFromUrl } from "../utils/cloudinary.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

const parseBoolean = (v) => v === true || v === "true" || v === 1 || v === "1";

const pickBannerFields = (body) => {
  const out = {};
  const keys = [
    "title", "subtitle", "overlayText", "ctaLabel", "textColor",
    "textPosition", "fontFamily", "fontSize", "fontWeight", "fontStyle",
    "link", "product", "position", "startDate", "endDate",
  ];
  for (const k of keys) {
    if (body[k] !== undefined && body[k] !== "") out[k] = body[k];
  }
  if (body.isActive !== undefined) out.isActive = parseBoolean(body.isActive);
  if (out.position !== undefined) out.position = parseInt(out.position, 10) || 0;
  if (out.fontSize !== undefined) {
    const fs = parseInt(out.fontSize, 10);
    if (Number.isFinite(fs)) out.fontSize = Math.max(12, Math.min(120, fs));
    else delete out.fontSize;
  }
  if (out.startDate) out.startDate = new Date(out.startDate);
  if (out.endDate) out.endDate = new Date(out.endDate);
  // Empty product string from FormData means "no link"
  if (out.product === "" || out.product === "null") delete out.product;
  return out;
};

export const createBanner = async (req, res, next) => {
  try {
    if (!req.file) throw new ApiError(400, "Banner image is required");
    const fields = pickBannerFields(req.body);
    if (!fields.title) throw new ApiError(400, "Title is required");

    const result = await uploadToCloudinary(req.file.buffer, "ecommerce/banners");
    const banner = await Banner.create({
      ...fields,
      image: result.secure_url,
      imagePublicId: result.public_id,
    });

    const populated = await Banner.findById(banner._id).populate("product", "title slug images");
    res.status(201).json(new ApiResponse(201, { banner: populated }, "Banner created"));
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
    })
      .populate("product", "title slug images")
      .sort({ position: 1 });
    res.json(new ApiResponse(200, { banners }));
  } catch (err) {
    next(err);
  }
};

export const getAllBanners = async (req, res, next) => {
  try {
    const banners = await Banner.find()
      .populate("product", "title slug images")
      .sort({ position: 1, createdAt: -1 });
    res.json(new ApiResponse(200, { banners }));
  } catch (err) {
    next(err);
  }
};

export const updateBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.bannerId);
    if (!banner) throw new ApiError(404, "Banner not found");

    const updates = pickBannerFields(req.body);

    // Allow explicit unlink — empty string in product/link field clears it
    if (req.body.product === "" || req.body.product === "null") banner.product = undefined;
    if (req.body.link === "") banner.link = "";

    // Replacing the image: delete the old asset from Cloudinary first
    if (req.file) {
      const oldPublicId = banner.imagePublicId || getPublicIdFromUrl(banner.image);
      if (oldPublicId) {
        try { await deleteFromCloudinary(oldPublicId); }
        catch (_) { /* swallow — don't block the update if the old asset was already gone */ }
      }
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/banners");
      updates.image = result.secure_url;
      updates.imagePublicId = result.public_id;
    }

    Object.assign(banner, updates);
    await banner.save();
    const populated = await Banner.findById(banner._id).populate("product", "title slug images");
    res.json(new ApiResponse(200, { banner: populated }, "Banner updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteBanner = async (req, res, next) => {
  try {
    const banner = await Banner.findById(req.params.bannerId);
    if (!banner) throw new ApiError(404, "Banner not found");

    const publicId = banner.imagePublicId || getPublicIdFromUrl(banner.image);
    if (publicId) {
      try { await deleteFromCloudinary(publicId); }
      catch (_) { /* asset may already be gone — DB delete still wins */ }
    }
    await banner.deleteOne();
    res.json(new ApiResponse(200, null, "Banner deleted"));
  } catch (err) {
    next(err);
  }
};
