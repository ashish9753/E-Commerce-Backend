import { Router } from "express";
import {
  checkPincode, getAll, getAllAdmin,
  create, update, remove, bulkImport,
} from "../controllers/deliveryArea.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

// Public
router.get("/check/:pincode", checkPincode);
router.get("/", getAll);

// Protected — admin & employee
router.use(protect, authorize("admin", "employee"));
router.get("/admin/all", getAllAdmin);
router.post("/", create);
router.post("/bulk", bulkImport);
router.patch("/:id", update);
router.delete("/:id", remove);

export default router;
