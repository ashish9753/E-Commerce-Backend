import { Router } from "express";
import { protect } from "../middleware/auth.middleware.js";
import { getUserReservations } from "../utils/reservation.utils.js";
import ApiResponse from "../utils/ApiResponse.js";

const router = Router();

router.use(protect);

// Returns active reservations for the logged-in user (used for cart timers)
router.get("/my", async (req, res, next) => {
  try {
    const reservations = await getUserReservations(req.user._id);
    res.json(new ApiResponse(200, { reservations }));
  } catch (err) {
    next(err);
  }
});

export default router;
