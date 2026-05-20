import { Router } from "express";
import {
  registerEmployee, getMyEmployeeProfile, updateEmployeeProfile, uploadShopLogo,
  getAllEmployees, verifyEmployee, getEmployeeById, adminCreateEmployee,
} from "../controllers/employee.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

router.post("/register", registerEmployee);
router.get("/me", authorize("employee", "admin"), getMyEmployeeProfile);
router.patch("/me", authorize("employee", "admin"), updateEmployeeProfile);
router.patch("/me/logo", authorize("employee", "admin"), uploadSingle("shopLogo"), uploadShopLogo);

router.post("/admin/create", authorize("admin"), adminCreateEmployee);
router.get("/", authorize("admin"), getAllEmployees);
router.get("/:employeeId", getEmployeeById);
router.patch("/:employeeId/verify", authorize("admin"), verifyEmployee);

export default router;
