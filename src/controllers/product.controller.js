import Product from "../models/product.model.js";
import Employee from "../models/seller.model.js";
import RecentlyViewed from "../models/recentlyViewed.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { generateUniqueSlug } from "../utils/slugify.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const createProduct = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id, isVerified: true });
    if (!employee) throw new ApiError(403, "Only verified employees can create products");

    const { title, description, shortDescription, category, brand, sku, price, discountPrice, stock, tags, specifications, isFeatured, returnable, returnWindow } = req.body;
    if (!title || !description || !category || !price) {
      throw new ApiError(400, "title, description, category, and price are required");
    }

    const slug = await generateUniqueSlug(title, Product);

    let images = [];
    if (req.files?.length) {
      const uploads = await Promise.all(
        req.files.map((file) => uploadToCloudinary(file.buffer, "ecommerce/products"))
      );
      images = uploads.map((r) => r.secure_url);
    }

    const product = await Product.create({
      employee: employee._id,
      title, slug, description, shortDescription, category, brand, sku,
      price: parseFloat(price),
      discountPrice: discountPrice ? parseFloat(discountPrice) : undefined,
      stock: parseInt(stock) || 0,
      tags: tags ? (Array.isArray(tags) ? tags : tags.split(",").map((t) => t.trim())) : [],
      specifications: specifications ? (typeof specifications === "string" ? JSON.parse(specifications) : specifications) : {},
      isFeatured:   isFeatured === "true" || isFeatured === true,
      returnable:   returnable === false || returnable === "false" ? false : true,
      returnWindow: [7, 10].includes(parseInt(returnWindow)) ? parseInt(returnWindow) : 7,
      images,
    });

    res.status(201).json(new ApiResponse(201, { product }, "Product created"));
  } catch (err) {
    next(err);
  }
};

export const getProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const { search, category, brand, minPrice, maxPrice, sort, isFeatured } = req.query;

    const filter = { isDeleted: false, isPublished: true };
    if (category) filter.category = category;
    if (brand) filter.brand = { $regex: brand, $options: "i" };
    if (isFeatured) filter.isFeatured = isFeatured === "true";
    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = parseFloat(minPrice);
      if (maxPrice) filter.price.$lte = parseFloat(maxPrice);
    }
    if (search) filter.$text = { $search: search };

    const sortOptions = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      price_asc: { price: 1 },
      price_desc: { price: -1 },
      rating: { rating: -1 },
      popular: { sold: -1 },
    };
    const sortBy = sortOptions[sort] || { createdAt: -1 };

    const [products, total] = await Promise.all([
      Product.find(filter)
        .populate("category", "name slug")
        .populate("employee", "shopName")
        .select("-specifications")
        .skip(skip)
        .limit(limit)
        .sort(sortBy),
      Product.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(products, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getProductBySlug = async (req, res, next) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, isDeleted: false })
      .populate("category", "name slug")
      .populate("employee", "shopName shopLogo rating");

    if (!product) throw new ApiError(404, "Product not found");

    if (req.user) {
      await RecentlyViewed.findOneAndUpdate(
        { user: req.user._id },
        {
          $pull: { products: { product: product._id } },
        },
        { upsert: true }
      );
      await RecentlyViewed.findOneAndUpdate(
        { user: req.user._id },
        {
          $push: { products: { $each: [{ product: product._id }], $position: 0, $slice: 20 } },
        }
      );
    }

    res.json(new ApiResponse(200, { product }));
  } catch (err) {
    next(err);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findOne({ _id: req.params.productId, isDeleted: false })
      .populate("category", "name slug")
      .populate("employee", "shopName shopLogo rating");
    if (!product) throw new ApiError(404, "Product not found");
    res.json(new ApiResponse(200, { product }));
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(403, "Employee profile not found");

    const product = await Product.findOne({ _id: req.params.productId, employee: employee._id, isDeleted: false });
    if (!product) throw new ApiError(404, "Product not found or you don't own it");

    const updates = { ...req.body };
    if (updates.title) updates.slug = await generateUniqueSlug(updates.title, Product, product._id);
    if (updates.price) updates.price = parseFloat(updates.price);
    if (updates.discountPrice) updates.discountPrice = parseFloat(updates.discountPrice);
    if (updates.stock !== undefined) updates.stock = parseInt(updates.stock);
    if (updates.returnable !== undefined) updates.returnable = updates.returnable === false || updates.returnable === "false" ? false : true;
    if (updates.returnWindow !== undefined) updates.returnWindow = [7, 10].includes(parseInt(updates.returnWindow)) ? parseInt(updates.returnWindow) : 7;
    if (req.files?.length) {
      const uploads = await Promise.all(req.files.map((f) => uploadToCloudinary(f.buffer, "ecommerce/products")));
      updates.images = [...product.images, ...uploads.map((r) => r.secure_url)];
    }

    const updated = await Product.findByIdAndUpdate(req.params.productId, updates, { new: true });
    res.json(new ApiResponse(200, { product: updated }, "Product updated"));
  } catch (err) {
    next(err);
  }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id });
    const isAdmin = req.user.role === "admin";

    const filter = { _id: req.params.productId };
    if (!isAdmin) filter.employee = employee?._id;

    const product = await Product.findOneAndUpdate(filter, { isDeleted: true }, { new: true });
    if (!product) throw new ApiError(404, "Product not found or access denied");

    res.json(new ApiResponse(200, null, "Product deleted"));
  } catch (err) {
    next(err);
  }
};

export const getMyProducts = async (req, res, next) => {
  try {
    const employee = await Employee.findOne({ user: req.user._id });
    if (!employee) throw new ApiError(404, "Employee profile not found");

    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { employee: employee._id, isDeleted: false };

    const [products, total] = await Promise.all([
      Product.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Product.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(products, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getFeaturedProducts = async (req, res, next) => {
  try {
    const products = await Product.find({ isFeatured: true, isDeleted: false, isPublished: true })
      .populate("category", "name")
      .limit(12)
      .sort({ createdAt: -1 });
    res.json(new ApiResponse(200, { products }));
  } catch (err) {
    next(err);
  }
};
