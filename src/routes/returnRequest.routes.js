import { Router } from "express";
import {
  createReturnRequest, getMyReturnRequests,
  getAllReturnRequests, processReturnRequest,
} from "../controllers/returnRequest.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadMultiple } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/", uploadMultiple("images", 3), createReturnRequest);
router.get("/my", getMyReturnRequests);

router.get("/", authorize("admin"), getAllReturnRequests);
router.patch("/:requestId/process", authorize("admin"), processReturnRequest);

export default router;
