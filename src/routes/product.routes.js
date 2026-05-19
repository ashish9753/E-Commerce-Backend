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
router.post("/", authorize("employee", "admin"), uploadMultiple("images", 5), createProduct);
router.get("/employee/my-products", authorize("employee", "admin"), getMyProducts);
router.patch("/:productId", authorize("employee", "admin"), uploadMultiple("images", 5), updateProduct);
router.delete("/:productId", authorize("employee", "admin"), deleteProduct);

export default router;
