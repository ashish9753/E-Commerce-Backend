import { Router } from "express";
import {
  createReview, getProductReviews, updateReview, deleteReview,
} from "../controllers/review.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { uploadMultiple } from "../middleware/upload.middleware.js";

const router = Router();

router.get("/product/:productId", getProductReviews);

router.use(protect);
router.post("/", uploadMultiple("images", 2), createReview);
router.patch("/:reviewId", updateReview);
router.delete("/:reviewId", deleteReview);

export default router;
