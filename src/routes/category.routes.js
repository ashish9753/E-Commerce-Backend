import { Router } from "express";
import {
  createCategory, getAllCategories, getCategoryBySlug,
  updateCategory, deleteCategory,
} from "../controllers/category.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { requirePermission } from "../middleware/permission.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/", getAllCategories);
router.get("/:slug", getCategoryBySlug);

router.use(protect, authorize("admin", "employee"));
router.post("/", requirePermission("catalog.write"), uploadSingle("image"), createCategory);
router.patch("/:categoryId", requirePermission("catalog.write"), uploadSingle("image"), updateCategory);
router.delete("/:categoryId", requirePermission("catalog.write"), deleteCategory);

export default router;
