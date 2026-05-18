import { Router } from "express";
import { getRecentlyViewed, clearRecentlyViewed } from "../controllers/recentlyViewed.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = Router();

router.use(protect);
router.get("/", getRecentlyViewed);
router.delete("/", clearRecentlyViewed);

export default router;
