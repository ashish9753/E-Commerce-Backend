import { Router } from "express";
import { createBrand, getAllBrands, updateBrand, deleteBrand, restoreBrand } from "../controllers/brand.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { requirePermission } from "../middleware/permission.middleware.js";

const router = Router();

// Public — active brands only
router.get("/", getAllBrands);

router.use(protect, authorize("admin", "employee"));
// Admin/employee — includes inactive brands so they can see + restore hidden ones
router.get("/all", requirePermission("catalog"), getAllBrands);
router.post("/", requirePermission("catalog.write"), createBrand);
router.patch("/:brandId/restore", requirePermission("catalog.write"), restoreBrand);
router.patch("/:brandId", requirePermission("catalog.write"), updateBrand);
router.delete("/:brandId", requirePermission("catalog.write"), deleteBrand);

export default router;
