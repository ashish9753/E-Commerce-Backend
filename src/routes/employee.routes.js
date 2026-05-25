import { Router } from "express";
import {
  getMyEmployeeProfile, updateEmployeeProfile, uploadShopLogo,
  getAllEmployees, verifyEmployee, getEmployeeById,
  adminCreateEmployee, adminRegisterExistingUser,
  updateEmployee, blockEmployee, deleteEmployee,
  getEmployeeSalary, addSalaryRecord, updateSalaryRecord, deleteSalaryRecord,
  getMySalary,
} from "../controllers/employee.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { uploadSingle } from "../middleware/upload.middleware.js";

const router = Router();

router.use(protect);

// Employee: own profile & salary (static paths before parameterized)
router.get("/me",        authorize("employee", "admin"), getMyEmployeeProfile);
router.patch("/me",      authorize("employee", "admin"), updateEmployeeProfile);
router.patch("/me/logo", authorize("employee", "admin"), uploadSingle("shopLogo"), uploadShopLogo);
router.get("/me/salary", authorize("employee", "admin"), getMySalary);

// Admin: create employees
router.post("/admin/create",            authorize("admin"), adminCreateEmployee);
router.post("/admin/register-existing", authorize("admin"), adminRegisterExistingUser);

// Admin: salary record CRUD (before /:employeeId to avoid conflict)
router.patch("/salary/:recordId",  authorize("admin"), updateSalaryRecord);
router.delete("/salary/:recordId", authorize("admin"), deleteSalaryRecord);

// Admin: list
router.get("/", authorize("admin"), getAllEmployees);

// Parameterized routes last
router.get("/:employeeId", authorize("admin", "employee"), getEmployeeById);
router.patch("/:employeeId/verify", authorize("admin"), verifyEmployee);
router.patch("/:employeeId/block",  authorize("admin"), blockEmployee);
router.patch("/:employeeId",        authorize("admin"), updateEmployee);
router.delete("/:employeeId",       authorize("admin"), deleteEmployee);
router.get("/:employeeId/salary",   authorize("admin"), getEmployeeSalary);
router.post("/:employeeId/salary",  authorize("admin"), addSalaryRecord);

export default router;
