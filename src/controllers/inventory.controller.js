import Product from "../models/product.model.js";
import InventoryLog from "../models/inventoryLog.model.js";
import Seller from "../models/seller.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const restockProduct = async (req, res, next) => {
  try {
    const { productId, quantity, note } = req.body;
    if (!productId || !quantity || quantity < 1) throw new ApiError(400, "productId and quantity (>0) required");

    const seller = req.user.role === "admin" ? null : await Seller.findOne({ user: req.user._id });

    const filter = { _id: productId, isDeleted: false };
    if (seller) filter.seller = seller._id;

    const product = await Product.findOneAndUpdate(
      filter,
      { $inc: { stock: parseInt(quantity) } },
      { new: true }
    );
    if (!product) throw new ApiError(404, "Product not found or access denied");

    await InventoryLog.create({
      product: productId,
      changeType: "RESTOCK",
      quantityChanged: parseInt(quantity),
      oldStock: product.stock - parseInt(quantity),
      newStock: product.stock,
      note: note || "Manual restock",
      performedBy: req.user._id,
    });

    res.json(new ApiResponse(200, { product }, `Stock updated. New stock: ${product.stock}`));
  } catch (err) {
    next(err);
  }
};

export const adjustStock = async (req, res, next) => {
  try {
    const { productId, newStock, note } = req.body;
    if (!productId || newStock === undefined || newStock < 0) {
      throw new ApiError(400, "productId and newStock (>=0) required");
    }

    const product = await Product.findById(productId);
    if (!product) throw new ApiError(404, "Product not found");

    const diff = parseInt(newStock) - product.stock;
    product.stock = parseInt(newStock);
    await product.save();

    await InventoryLog.create({
      product: productId,
      changeType: "ADJUSTMENT",
      quantityChanged: diff,
      oldStock: product.stock - diff,
      newStock: product.stock,
      note: note || "Manual adjustment",
      performedBy: req.user._id,
    });

    res.json(new ApiResponse(200, { product }, "Stock adjusted"));
  } catch (err) {
    next(err);
  }
};

export const getInventoryLogs = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPaginationData(req.query);
    const filter = {};
    if (req.query.productId) filter.product = req.query.productId;
    if (req.query.changeType) filter.changeType = req.query.changeType;

    const [logs, total] = await Promise.all([
      InventoryLog.find(filter)
        .populate("product", "title sku")
        .populate("performedBy", "name email")
        .populate("order", "orderNumber")
        .skip(skip).limit(limit).sort({ createdAt: -1 }),
      InventoryLog.countDocuments(filter),
    ]);

    res.json(new ApiResponse(200, buildPaginatedResponse(logs, total, page, limit)));
  } catch (err) {
    next(err);
  }
};

export const getLowStockProducts = async (req, res, next) => {
  try {
    const threshold = parseInt(req.query.threshold) || 10;
    const products = await Product.find({ stock: { $lte: threshold }, isDeleted: false })
      .select("title sku stock images")
      .sort({ stock: 1 });
    res.json(new ApiResponse(200, { products, count: products.length }));
  } catch (err) {
    next(err);
  }
};
