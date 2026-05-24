import { Router } from "express";
import {
  createReturnRequest,
  getSavedRefundDetails,
  getReturnById,
  updateRefundMethod,
  getMyReturnRequests,
  getEmployeeReturnRequests,
  employeeActionOnReturn,
  employeeAdvanceReturn,
  getAllReturnRequests,
  processReturnRequest,
} from "../controllers/returnRequest.controller.js";
import { protect }    from "../middleware/auth.middleware.js";
import { authorize }  from "../middleware/role.middleware.js";
import { uploadReturnEvidence, uploadRefundProof } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

// Static routes MUST come before /:requestId or Express will match the literal string as an ID

// Admin
router.get("/",                     authorize("admin"), getAllReturnRequests);

// Employee
router.get("/employee",               authorize("employee", "admin"), getEmployeeReturnRequests);

// Customer
router.post("/",                    uploadReturnEvidence, createReturnRequest);
router.get("/my",                   getMyReturnRequests);
router.get("/refund-details",       getSavedRefundDetails);

// Parameterised routes last
router.get("/:requestId",                   getReturnById);
router.patch("/:requestId/refund-method",   updateRefundMethod);
router.patch("/:requestId/employee-action", authorize("employee"), employeeActionOnReturn);
router.patch("/:requestId/employee-advance",authorize("employee"), uploadRefundProof, employeeAdvanceReturn);
router.patch("/:requestId/process",         authorize("admin"),    uploadRefundProof, processReturnRequest);

export default router;
