import { Router } from "express";
import {
  registerSeller, getMySellerProfile, updateSellerProfile, uploadShopLogo,
  getAllSellers, verifySeller, getSellerById,
} from "../controllers/seller.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/register", registerSeller);
router.get("/me", authorize("seller", "admin"), getMySellerProfile);
router.patch("/me", authorize("seller", "admin"), updateSellerProfile);
router.patch("/me/logo", authorize("seller", "admin"), uploadSingle("shopLogo"), uploadShopLogo);

router.get("/", authorize("admin"), getAllSellers);
router.get("/:sellerId", getSellerById);
router.patch("/:sellerId/verify", authorize("admin"), verifySeller);

export default router;
