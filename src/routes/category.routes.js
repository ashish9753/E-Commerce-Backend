import { Router } from "express";
import {
  createCategory, getAllCategories, getCategoryBySlug,
  updateCategory, deleteCategory,
} from "../controllers/category.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", getAllCategories);
router.get("/:slug", getCategoryBySlug);

router.use(protect, authorize("admin"));
router.post("/", uploadSingle("image"), createCategory);
router.patch("/:categoryId", uploadSingle("image"), updateCategory);
router.delete("/:categoryId", deleteCategory);

export default router;
