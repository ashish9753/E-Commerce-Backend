import Settings from "../models/settings.model.js";
import ApiResponse from "../utils/ApiResponse.js";

const COD_KEY = "codBooking";

const DEFAULT_COD = {
  enabled: false,
  minOrderAmount: 5000,      // only trigger if order >= this
  bookingType: "flat",       // "flat" | "percent"
  bookingValue: 500,         // Rs. amount or %
  upiId: "",                 // e.g. "shop@upi"
  upiName: "",               // display name
  nonRefundable: true,
};

export const getCodSettings = async (req, res, next) => {
  try {
    const doc = await Settings.findOne({ key: COD_KEY });
    res.json(new ApiResponse(200, { codSettings: doc?.value ?? DEFAULT_COD }));
  } catch (err) { next(err); }
};

export const updateCodSettings = async (req, res, next) => {
  try {
    const value = { ...DEFAULT_COD, ...req.body };
    const doc = await Settings.findOneAndUpdate(
      { key: COD_KEY },
      { value },
      { upsert: true, new: true }
    );
    res.json(new ApiResponse(200, { codSettings: doc.value }, "COD settings updated"));
  } catch (err) { next(err); }
};
