import { Router } from "express";
import {
  createBanner, getActiveBanners, getAllBanners, updateBanner, deleteBanner,
} from "../controllers/banner.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/active", getActiveBanners);

router.use(protect, authorize("admin"));
router.get("/", getAllBanners);
router.post("/", uploadSingle("image"), createBanner);
router.patch("/:bannerId", uploadSingle("image"), updateBanner);
router.delete("/:bannerId", deleteBanner);

export default router;
