import { Router } from "express";
import {
  getLocations, getLocation, getRate, trackOrder, refreshLocations,
} from "../controllers/upaya.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = Router();

// Public — checkout & product pages need these
router.get("/locations", getLocations);
router.get("/locations/:locationId", getLocation);
router.post("/rate", getRate);
router.get("/track/:orderRef", trackOrder);

// Admin/employee — bust the locations cache
router.post("/locations/refresh", protect, authorize("admin", "employee"), refreshLocations);

export default router;
