import { Router } from "express";
import {
  createRazorpayOrder, createBookingOrder, verifyRazorpayPayment,
  getPaymentByOrder, getAllPayments,
} from "../controllers/payment.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

router.use(protect);

router.post("/razorpay/create-order", createRazorpayOrder);
router.post("/razorpay/create-booking", createBookingOrder);
router.post("/razorpay/verify", verifyRazorpayPayment);
router.get("/order/:orderId", getPaymentByOrder);

router.get("/", authorize("admin"), getAllPayments);

export default router;
