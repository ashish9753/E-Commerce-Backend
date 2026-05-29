import mongoose from "mongoose";
import Product from "../models/product.model.js";
import Category from "../models/category.model.js";
import Employee from "../models/employee.model.js";
import RecentlyViewed from "../models/recentlyViewed.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import { generateUniqueSlug } from "../utils/slugify.utils.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";
import { notifyAdmins } from "../utils/notify.js";

export const createProduct = async (req, res, next) => {
  try {
    let employee;
    if (req.user.role === "admin") {
      // Admin must specify which employee/seller owns this product
      if (!req.body.employee) throw new ApiError(400, "employee (seller) is required when admin creates a product");
      employee = await Employee.findById(req.body.employee);
      if (!employee) throw new ApiError(404, "Selected employee not found");
    } else {
      employee = await Employee.findOne({ user: req.user._id, isVerified: true });
      if (!employee) throw new ApiError(403, "Only verified employees can create products");
    }

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
      specifications: specifications ? new Map(Object.entries(typeof specifications === "string" ? JSON.parse(specifications) : specifications)) : new Map(),
      isFeatured:   isFeatured === "true" || isFeatured === true,
      returnable:   returnable === false || returnable === "false" ? false : true,
      returnWindow: [7, 10].includes(parseInt(returnWindow)) ? parseInt(returnWindow) : 7,
      images,
    });

    // Notify admins when an employee adds a new product (admin-created products
    // skip this — the admin is the one creating it).
    if (req.user.role !== "admin") {
      notifyAdmins({
        title:   "New Product Added 📦",
        message: `${employee.name || "An employee"} added a new product: "${product.title}".`,
        type:    "SYSTEM",
        link:    "/admin",
      }).catch(() => { /* non-critical */ });
    }

    res.status(201).json(new ApiResponse(201, { product }, "Product created"));
  } catch (err) {
    next(err);
  }
};

export const getProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const { search, category, brand, minPrice, maxPrice, sort, isFeatured, onSale } = req.query;

    const filter = { isDeleted: false, isPublished: true };
    // ?onSale=true → only products with a real discount (discountPrice
    // present and strictly less than the regular price). Used by the
    // storefront's "Flash Sale" / "Events & Offers" nav links.
    if (onSale === "true") {
      filter.discountPrice = { $gt: 0 };
      filter.$expr = { $lt: ["$discountPrice", "$price"] };
    }
    if (category) {
      // Accept either an ObjectId or a category name/slug. If a name is
      // supplied, look it up case-insensitively. If no Category matches,
      // short-circuit to an empty result instead of throwing a CastError.
      if (mongoose.Types.ObjectId.isValid(category)) {
        filter.category = category;
      } else {
        const cat = await Category.findOne({
          $or: [
            { name: { $regex: `^${category}$`, $options: "i" } },
            { slug: { $regex: `^${category}$`, $options: "i" } },
          ],
        }).select("_id");
        if (!cat) {
          return res.json(new ApiResponse(200, buildPaginatedResponse([], 0, page, limit)));
        }
        filter.category = cat._id;
      }
    }
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
    const product = await Product.findOne({ slug: req.params.slug, isDeleted: false, isPublished: true })
      .populate("category", "name slug")
      .populate("employee", "shopName shopLogo rating");

    if (!product) throw new ApiError(404, "Product not found");

    if (req.user) {
      await RecentlyViewed.findOneAndUpdate(
        { user: req.user._id },
        { $pull: { products: { product: product._id } } },
        { upsert: true }
      );
      await RecentlyViewed.findOneAndUpdate(
        { user: req.user._id },
        { $push: { products: { $each: [{ product: product._id }], $position: 0, $slice: 20 } } }
      );
    }

    res.json(new ApiResponse(200, { product }));
  } catch (err) {
    next(err);
  }
};

export const getProductById = async (req, res, next) => {
  try {
    const product = await Product.findOne({ _id: req.params.productId, isDeleted: false, isPublished: true })
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
    if (req.user.role !== "admin") {
      const employee = await Employee.findOne({ user: req.user._id });
      if (!employee) throw new ApiError(403, "Employee profile not found");
    }

    const product = await Product.findOne({ _id: req.params.productId, isDeleted: false });
    if (!product) throw new ApiError(404, "Product not found");

    // Whitelist updatable fields — prevents tampering with sold, rating, isDeleted, etc.
    const ALLOWED = [
      "title", "description", "shortDescription", "category", "brand", "sku",
      "price", "discountPrice", "stock", "tags", "specifications",
      "isFeatured", "isPublished", "returnable", "returnWindow",
      "keepImages",
      ...(req.user.role === "admin" ? ["employee"] : []),
    ];
    const updates = {};
    for (const k of ALLOWED) {
      if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (updates.title) updates.slug = await generateUniqueSlug(updates.title, Product, product._id);
    if (updates.price) updates.price = parseFloat(updates.price);
    if (updates.discountPrice) updates.discountPrice = parseFloat(updates.discountPrice);
    if (updates.stock !== undefined) updates.stock = parseInt(updates.stock);
    if (updates.returnable !== undefined) updates.returnable = updates.returnable === false || updates.returnable === "false" ? false : true;
    if (updates.returnWindow !== undefined) updates.returnWindow = [7, 10].includes(parseInt(updates.returnWindow)) ? parseInt(updates.returnWindow) : 7;
    if (updates.specifications !== undefined) {
      const raw = typeof updates.specifications === "string" ? JSON.parse(updates.specifications) : updates.specifications;
      updates.specifications = new Map(Object.entries(raw));
    }
    // keepImages lets the frontend specify which existing images to retain (removes the rest)
    if (req.body.keepImages !== undefined) {
      const keep = Array.isArray(req.body.keepImages) ? req.body.keepImages : [req.body.keepImages];
      updates.images = keep.filter(Boolean);
    }
    if (req.files?.length) {
      const uploads = await Promise.all(req.files.map((f) => uploadToCloudinary(f.buffer, "ecommerce/products")));
      const base = updates.images ?? product.images;
      updates.images = [...base, ...uploads.map((r) => r.secure_url)];
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

    const product = await Product.findOneAndUpdate({ _id: req.params.productId }, { isDeleted: true }, { new: true });
    if (!product) throw new ApiError(404, "Product not found");

    res.json(new ApiResponse(200, null, "Product deleted"));
  } catch (err) {
    next(err);
  }
};

export const getMyProducts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = { isDeleted: false };

    // Employees only see their own products; admins see all.
    if (req.user.role !== "admin") {
      const employee = await Employee.findOne({ user: req.user._id }).select("_id");
      if (!employee) throw new ApiError(403, "Employee profile not found");
      filter.employee = employee._id;
    }

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
