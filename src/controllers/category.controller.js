import Category from "../models/category.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { generateUniqueSlug } from "../utils/slugify.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

const caseInsensitiveNameRegex = (name) =>
  new RegExp(`^${name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');

export const createCategory = async (req, res, next) => {
  try {
    const { name, description, parent } = req.body;
    if (!name) throw new ApiError(400, "Category name is required");
    const trimmed = name.trim();
    const existing = await Category.findOne({ name: { $regex: caseInsensitiveNameRegex(trimmed) } });
    if (existing) {
      if (existing.isActive) throw new ApiError(409, `Category "${trimmed}" already exists`);
      existing.isActive = true;
      if (description) existing.description = description;
      await existing.save();
      return res.status(200).json(new ApiResponse(200, { category: existing }, "Category restored"));
    }

    const slug = await generateUniqueSlug(trimmed, Category);
    let image = req.body.imageUrl || undefined;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/categories");
      image = result.secure_url;
    }

    const category = await Category.create({ name: trimmed, slug, description, parent: parent || null, image });
    res.status(201).json(new ApiResponse(201, { category }, "Category created"));
  } catch (err) {
    next(err);
  }
};

export const getAllCategories = async (req, res, next) => {
  try {
    const categories = await Category.find({ isActive: true })
      .populate("parent", "name slug")
      .sort({ name: 1 });
    res.json(new ApiResponse(200, { categories }));
  } catch (err) {
    next(err);
  }
};

export const getCategoryBySlug = async (req, res, next) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug, isActive: true })
      .populate("parent", "name slug");
    if (!category) throw new ApiError(404, "Category not found");
    res.json(new ApiResponse(200, { category }));
  } catch (err) {
    next(err);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const { name, description, parent, isActive, imageUrl } = req.body;
    const updates = { description, parent, isActive };
    if (imageUrl) updates.image = imageUrl;

    if (name) {
      const trimmed = name.trim();
      const existing = await Category.findOne({
        name: { $regex: caseInsensitiveNameRegex(trimmed) },
        _id: { $ne: req.params.categoryId },
      });
      if (existing) throw new ApiError(409, `Category "${trimmed}" already exists`);
      updates.name = trimmed;
      updates.slug = await generateUniqueSlug(trimmed, Category, req.params.categoryId);
    }
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/categories");
      updates.image = result.secure_url;
    }

    const category = await Category.findByIdAndUpdate(req.params.categoryId, updates, { new: true });
    if (!category) throw new ApiError(404, "Category not found");
    res.json(new ApiResponse(200, { category }, "Category updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteCategory = async (req, res, next) => {
  try {
    await Category.findByIdAndUpdate(req.params.categoryId, { isActive: false });
    res.json(new ApiResponse(200, null, "Category deactivated"));
  } catch (err) {
    next(err);
  }
};
