import { Router } from "express";
import {
  createReturnRequest,
  getReturnById,
  updateRefundMethod,
  getMyReturnRequests,
  getSellerReturnRequests,
  sellerActionOnReturn,
  sellerAdvanceReturn,
  getAllReturnRequests,
  processReturnRequest,
} from "../controllers/returnRequest.controller.js";
import { protect }    from "../middleware/auth.middleware.js";
import { authorize }  from "../middleware/role.middleware.js";
import { uploadMultiple } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

// Static routes MUST come before /:requestId or Express will match the literal string as an ID

// Admin
router.get("/",                     authorize("admin"), getAllReturnRequests);

// Seller
router.get("/seller",               authorize("seller", "admin"), getSellerReturnRequests);

// Customer
router.post("/",                    uploadMultiple("images", 3), createReturnRequest);
router.get("/my",                   getMyReturnRequests);

// Parameterised routes last
router.get("/:requestId",                  getReturnById);
router.patch("/:requestId/refund-method",  updateRefundMethod);
router.patch("/:requestId/seller-action",  authorize("seller"), sellerActionOnReturn);
router.patch("/:requestId/seller-advance", authorize("seller"), sellerAdvanceReturn);
router.patch("/:requestId/process",        authorize("admin"),  processReturnRequest);

export default router;
