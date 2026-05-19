import { Router } from "express";
import { createBrand, getAllBrands, updateBrand, deleteBrand } from "../controllers/brand.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.get("/", getAllBrands);

router.use(protect, authorize("admin"));
router.post("/", createBrand);
router.patch("/:brandId", updateBrand);
router.delete("/:brandId", deleteBrand);

export default router;
