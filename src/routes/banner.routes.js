import { Router } from "express";
import {
  createBanner, getActiveBanners, getAllBanners, updateBanner, deleteBanner,
} from "../controllers/banner.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { requirePermission } from "../middleware/permission.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/active", getActiveBanners);

router.use(protect, authorize("admin", "employee"));
router.get("/", requirePermission("banners"), getAllBanners);
router.post("/", requirePermission("banners.write"), uploadSingle("image"), createBanner);
router.patch("/:bannerId", requirePermission("banners.write"), uploadSingle("image"), updateBanner);
router.delete("/:bannerId", requirePermission("banners.write"), deleteBanner);

export default router;
