import { Router } from "express";
import { createBrand, getAllBrands, updateBrand, deleteBrand, restoreBrand } from "../controllers/brand.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

// Public — active brands only
router.get("/", getAllBrands);

router.use(protect, authorize("admin", "employee"));
// Admin/employee — includes inactive brands so they can see + restore hidden ones
router.get("/all", getAllBrands);
router.post("/", createBrand);
router.patch("/:brandId/restore", restoreBrand);
router.patch("/:brandId", updateBrand);
router.delete("/:brandId", deleteBrand);

export default router;
