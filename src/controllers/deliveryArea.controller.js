import DeliveryArea from "../models/deliveryArea.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

// Public — check a single pincode
export const checkPincode = async (req, res, next) => {
  try {
    const { pincode } = req.params;
    const area = await DeliveryArea.findOne({ pincode: pincode.trim(), isActive: true });
    if (!area) {
      return res.json(new ApiResponse(200, { available: false, pincode }));
    }
    res.json(new ApiResponse(200, {
      available: true,
      pincode: area.pincode,
      city: area.city,
      state: area.state,
      deliveryCharge: area.deliveryCharge,
    }));
  } catch (err) { next(err); }
};

// Public — get all active areas (for display)
export const getAll = async (req, res, next) => {
  try {
    const areas = await DeliveryArea.find({ isActive: true }).sort({ pincode: 1 });
    res.json(new ApiResponse(200, { areas }));
  } catch (err) { next(err); }
};

// Admin/Employee — get all (including inactive)
export const getAllAdmin = async (req, res, next) => {
  try {
    const areas = await DeliveryArea.find().sort({ createdAt: -1 });
    res.json(new ApiResponse(200, { areas }));
  } catch (err) { next(err); }
};

// Admin/Employee — create
export const create = async (req, res, next) => {
  try {
    const { pincode, city, state, deliveryCharge } = req.body;
    if (!pincode || deliveryCharge === undefined) throw new ApiError(400, "pincode and deliveryCharge are required");
    const existing = await DeliveryArea.findOne({ pincode: pincode.trim() });
    if (existing) throw new ApiError(409, `Pincode ${pincode} already exists`);
    const area = await DeliveryArea.create({ pincode: pincode.trim(), city, state, deliveryCharge: Number(deliveryCharge) });
    res.status(201).json(new ApiResponse(201, { area }, "Delivery area added"));
  } catch (err) { next(err); }
};

// Admin/Employee — update
export const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const area = await DeliveryArea.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    if (!area) throw new ApiError(404, "Delivery area not found");
    res.json(new ApiResponse(200, { area }, "Updated"));
  } catch (err) { next(err); }
};

// Admin/Employee — delete
export const remove = async (req, res, next) => {
  try {
    const { id } = req.params;
    await DeliveryArea.findByIdAndDelete(id);
    res.json(new ApiResponse(200, {}, "Deleted"));
  } catch (err) { next(err); }
};

// Admin/Employee — bulk import
export const bulkImport = async (req, res, next) => {
  try {
    const { areas } = req.body; // [{ pincode, city, state, deliveryCharge }]
    if (!Array.isArray(areas) || !areas.length) throw new ApiError(400, "areas array required");
    let inserted = 0, skipped = 0;
    for (const a of areas) {
      const exists = await DeliveryArea.findOne({ pincode: a.pincode?.trim() });
      if (exists) { skipped++; continue; }
      await DeliveryArea.create({ ...a, pincode: a.pincode?.trim() });
      inserted++;
    }
    res.json(new ApiResponse(200, { inserted, skipped }, `${inserted} inserted, ${skipped} skipped`));
  } catch (err) { next(err); }
};
