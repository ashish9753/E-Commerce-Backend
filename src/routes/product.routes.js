import { Router } from "express";
import {
  createProduct, getProducts, getProductBySlug, getProductById,
  updateProduct, deleteProduct, getMyProducts, getFeaturedProducts,
} from "../controllers/product.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { optionalAuth } from "../middleware/auth.middleware.js";
import { uploadMultiple } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", getProducts);
router.get("/featured", getFeaturedProducts);
router.get("/slug/:slug", optionalAuth, getProductBySlug);
router.get("/:productId", getProductById);

router.use(protect);
router.post("/", authorize("seller", "admin"), uploadMultiple("images", 5), createProduct);
router.get("/seller/my-products", authorize("seller", "admin"), getMyProducts);
router.patch("/:productId", authorize("seller", "admin"), uploadMultiple("images", 5), updateProduct);
router.delete("/:productId", authorize("seller", "admin"), deleteProduct);

export default router;
