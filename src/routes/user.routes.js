import { Router } from "express";
import {
  getProfile, updateProfile, uploadProfileImage, changePassword,
  addAddress, updateAddress, deleteAddress,
  getWishlist, toggleWishlist,
  getSavedRefundDetails, updateSavedRefundDetails,
  getAllUsers, getUserById, toggleBlockUser, deleteUser,
} from "../controllers/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.get("/profile", getProfile);
router.patch("/profile", updateProfile);
router.patch("/profile/image", uploadSingle("profileImage"), uploadProfileImage);
router.patch("/change-password", changePassword);

router.post("/addresses", addAddress);
router.patch("/addresses/:addressId", updateAddress);
router.delete("/addresses/:addressId", deleteAddress);

router.get("/wishlist", getWishlist);
router.patch("/wishlist/:productId", toggleWishlist);

router.get("/refund-details", getSavedRefundDetails);
router.patch("/refund-details", updateSavedRefundDetails);

// Admin only
router.get("/", authorize("admin"), getAllUsers);
router.get("/:userId", authorize("admin"), getUserById);
router.patch("/:userId/block", authorize("admin"), toggleBlockUser);
router.delete("/:userId", authorize("admin"), deleteUser);

export default router;
