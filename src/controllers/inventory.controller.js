import Product from "../models/product.model.js";
import InventoryLog from "../models/inventoryLog.model.js";
import Employee from "../models/employee.model.js";
import Order from "../models/order.model.js";
import { getPaginationData, buildPaginatedResponse } from "../utils/pagination.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

export const restockProduct = async (req, res, next) => {
  try {
    const { productId, quantity, note } = req.body;
    if (!productId || !quantity || quantity < 1) throw new ApiError(400, "productId and quantity (>0) required");

    const employee = req.user.role === "admin" ? null : await Employee.findOne({ user: req.user._id });

    const filter = { _id: productId, isDeleted: false };
    if (employee) filter.employee = employee._id;

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

export const getInventoryAnalytics = async (req, res, next) => {
  try {
    const TZ = process.env.TZ_OFFSET_HOURS ? parseFloat(process.env.TZ_OFFSET_HOURS) : 5.5; // IST default
    const tzMs = TZ * 3600000;
    // All dates shifted to local midnight in UTC
    const nowLocal     = new Date(Date.now() + tzMs);
    const todayStart   = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate()) - tzMs);
    const monthStart   = new Date(Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), 1) - tzMs);
    const yearStart    = new Date(Date.UTC(nowLocal.getUTCFullYear(), 0, 1) - tzMs);
    const MONGO_TZ     = "+05:30";

    const [
      orderStats,
      paymentStats,
      codDepositStats,
      hourlySeries,
      dailySeries,
      monthlySeries,
      topProducts,
      allProducts,
      categoryAgg,
    ] = await Promise.all([
      // Order-level totals by status
      Order.aggregate([
        { $group: {
          _id: "$orderStatus",
          count:    { $sum: 1 },
          revenue:  { $sum: "$totalPrice" },
          refunded: { $sum: "$refundAmount" },
          shipping: { $sum: "$shippingPrice" },
        }},
      ]),

      // Orders by payment method (COD / ONLINE)
      Order.aggregate([
        { $group: {
          _id: "$paymentMethod",
          count:    { $sum: 1 },
          revenue:  { $sum: "$totalPrice" },
          refunded: { $sum: "$refundAmount" },
        }},
      ]),

      // COD deposit breakdown
      Order.aggregate([
        { $match: { paymentMethod: "COD" } },
        { $group: {
          _id: "$codBookingStatus",
          count:       { $sum: 1 },
          totalAmount: { $sum: "$codBookingAmount" },
        }},
      ]),

      // Today: hourly breakdown in local timezone
      Order.aggregate([
        { $match: { createdAt: { $gte: todayStart } } },
        { $group: {
          _id: { $hour: { date: "$createdAt", timezone: MONGO_TZ } },
          revenue: { $sum: "$totalPrice" }, orders: { $sum: 1 }, refunded: { $sum: "$refundAmount" },
        }},
        { $sort: { _id: 1 } },
      ]),

      // Daily series: current month (covers "This Week" + "This Month")
      Order.aggregate([
        { $match: { createdAt: { $gte: monthStart } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: MONGO_TZ } },
          revenue: { $sum: "$totalPrice" }, orders: { $sum: 1 }, refunded: { $sum: "$refundAmount" }, shipping: { $sum: "$shippingPrice" },
        }},
        { $sort: { _id: 1 } },
      ]),

      // Monthly series: current year
      Order.aggregate([
        { $match: { createdAt: { $gte: yearStart } } },
        { $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt", timezone: MONGO_TZ } },
          revenue: { $sum: "$totalPrice" }, orders: { $sum: 1 }, refunded: { $sum: "$refundAmount" }, shipping: { $sum: "$shippingPrice" },
        }},
        { $sort: { _id: 1 } },
      ]),

      // Top 10 products by units sold
      Product.find({ isDeleted: false })
        .select("title images price discountPrice sold stock category brand")
        .populate("category", "name")
        .sort({ sold: -1 })
        .limit(10),

      // All products for stock summary
      Product.find({ isDeleted: false })
        .select("title images price discountPrice sold stock category brand")
        .populate("category", "name"),

      // Category-level aggregation
      Product.aggregate([
        { $match: { isDeleted: false } },
        { $group: {
          _id: "$category",
          totalSold:  { $sum: "$sold"  },
          totalStock: { $sum: "$stock" },
          productCount: { $sum: 1 },
          revenue: { $sum: { $multiply: ["$price", "$sold"] } },
        }},
        { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "cat" } },
        { $unwind: { path: "$cat", preserveNullAndEmptyArrays: true } },
        { $project: {
          categoryName: { $ifNull: ["$cat.name", "Uncategorised"] },
          totalSold: 1, totalStock: 1, productCount: 1, revenue: 1,
        }},
        { $sort: { totalSold: -1 } },
      ]),
    ]);

    // Flatten order stats
    const byStatus = {};
    orderStats.forEach(s => { byStatus[s._id] = s; });
    const totalOrders    = orderStats.reduce((a, s) => a + s.count, 0);
    const totalSold      = (byStatus.DELIVERED?.count || 0)
                         + (byStatus.SHIPPED?.count   || 0)
                         + (byStatus.PACKED?.count     || 0)
                         + (byStatus.CONFIRMED?.count  || 0)
                         + (byStatus.PLACED?.count     || 0);
    const totalCancelled = byStatus.CANCELLED?.count || 0;
    const totalReturned  = byStatus.RETURNED?.count  || 0;
    const totalRefunded  = orderStats.reduce((a, s) => a + (s.refunded || 0), 0);
    const totalRevenue   = orderStats.reduce((a, s) => a + (s.revenue  || 0), 0);
    const totalShipping  = orderStats.reduce((a, s) => a + (s.shipping || 0), 0);

    // Stock health
    const outOfStock = allProducts.filter(p => p.stock === 0).length;
    const lowStock   = allProducts.filter(p => p.stock > 0 && p.stock <= 10).length;
    const totalUnits = allProducts.reduce((a, p) => a + p.stock, 0);
    const totalProductsSold = allProducts.reduce((a, p) => a + p.sold, 0);

    // Payment method breakdown
    const byPayment = {};
    paymentStats.forEach(p => { byPayment[p._id] = p; });
    const cod    = byPayment.COD    || { count: 0, revenue: 0, refunded: 0 };
    const online = byPayment.ONLINE || { count: 0, revenue: 0, refunded: 0 };

    // COD deposit breakdown
    const byDepositStatus = {};
    codDepositStats.forEach(d => { byDepositStatus[d._id] = d; });
    const depositPaid    = byDepositStatus.PAID           || { count: 0, totalAmount: 0 };
    const depositPending = byDepositStatus.PENDING        || { count: 0, totalAmount: 0 };
    const depositNone    = byDepositStatus.NOT_REQUIRED   || { count: 0, totalAmount: 0 };

    res.json(new ApiResponse(200, {
      orderSummary: { totalOrders, totalSold, totalCancelled, totalReturned, totalRefunded, totalRevenue, totalShipping },
      stockHealth:  { outOfStock, lowStock, totalUnits, totalProducts: allProducts.length, totalProductsSold },
      paymentBreakdown: {
        cod:    { count: cod.count,    revenue: cod.revenue,    refunded: cod.refunded,
          deposit: {
            paid:    { count: depositPaid.count,    amount: depositPaid.totalAmount    },
            pending: { count: depositPending.count, amount: depositPending.totalAmount },
            none:    { count: depositNone.count },
          }
        },
        online: { count: online.count, revenue: online.revenue, refunded: online.refunded },
      },
      topProducts,
      allProducts,
      categoryBreakdown: categoryAgg,
      timeSeries: { hourly: hourlySeries, daily: dailySeries, monthly: monthlySeries },
    }));
  } catch (err) {
    next(err);
  }
};
