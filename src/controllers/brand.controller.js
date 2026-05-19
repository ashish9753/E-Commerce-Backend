import Brand from "../models/brand.model.js";
import { generateUniqueSlug } from "../utils/slugify.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createBrand = async (req, res, next) => {
  try {
    const { name, logo } = req.body;
    if (!name) throw new ApiError(400, "Brand name is required");
    const slug = await generateUniqueSlug(name, Brand);
    const brand = await Brand.create({ name, slug, logo });
    res.status(201).json(new ApiResponse(201, { brand }, "Brand created"));
  } catch (err) { next(err); }
};

export const getAllBrands = async (req, res, next) => {
  try {
    const brands = await Brand.find({ isActive: true }).sort({ name: 1 });
    res.json(new ApiResponse(200, { brands }));
  } catch (err) { next(err); }
};

export const updateBrand = async (req, res, next) => {
  try {
    const { name, logo, isActive } = req.body;
    const updates = { logo, isActive };
    if (name) {
      updates.name = name;
      updates.slug = await generateUniqueSlug(name, Brand, req.params.brandId);
    }
    const brand = await Brand.findByIdAndUpdate(req.params.brandId, updates, { new: true });
    if (!brand) throw new ApiError(404, "Brand not found");
    res.json(new ApiResponse(200, { brand }, "Brand updated"));
  } catch (err) { next(err); }
};

export const deleteBrand = async (req, res, next) => {
  try {
    await Brand.findByIdAndUpdate(req.params.brandId, { isActive: false });
    res.json(new ApiResponse(200, null, "Brand deactivated"));
  } catch (err) { next(err); }
};
