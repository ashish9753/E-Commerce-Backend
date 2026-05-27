import DeliveryArea from "../models/deliveryArea.model.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

// Escape special regex chars so a user-supplied city name can't break the
// query — "St. John's" should match a literal string, not become a regex.
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Public — check whether a city/location is serviceable. Case-insensitive
// exact match first, then a startsWith fallback so "Ktm" still resolves to
// "Kathmandu" if admin only set up the canonical name.
export const checkLocation = async (req, res, next) => {
  try {
    const raw = (req.params.location || req.query.q || "").trim();
    if (!raw) throw new ApiError(400, "Location is required");

    const exact = new RegExp(`^${escapeRegex(raw)}$`, "i");
    let area = await DeliveryArea.findOne({ city: exact, isActive: true });
    if (!area) {
      const starts = new RegExp(`^${escapeRegex(raw)}`, "i");
      area = await DeliveryArea.findOne({ city: starts, isActive: true });
    }
    if (!area) {
      return res.json(new ApiResponse(200, { available: false, location: raw }));
    }
    res.json(new ApiResponse(200, {
      available: true,
      city: area.city,
      state: area.state,
      pincode: area.pincode,
      deliveryCharge: area.deliveryCharge,
    }));
  } catch (err) { next(err); }
};

// Public — list of all active areas (so the storefront can show an autocomplete)
export const getAll = async (req, res, next) => {
  try {
    const areas = await DeliveryArea.find({ isActive: true })
      .collation({ locale: "en", strength: 2 })
      .sort({ city: 1 });
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
    const { city, state, pincode, deliveryCharge } = req.body;
    if (!city || !city.trim()) throw new ApiError(400, "City is required");
    if (deliveryCharge === undefined || deliveryCharge === null) {
      throw new ApiError(400, "Delivery charge is required");
    }
    const existing = await DeliveryArea.findOne({ city: city.trim() })
      .collation({ locale: "en", strength: 2 });
    if (existing) throw new ApiError(409, `"${city}" is already in the delivery list`);
    const area = await DeliveryArea.create({
      city: city.trim(),
      state: state?.trim() || "",
      pincode: pincode?.trim() || "",
      deliveryCharge: Number(deliveryCharge),
    });
    res.status(201).json(new ApiResponse(201, { area }, "Delivery area added"));
  } catch (err) { next(err); }
};

// Admin/Employee — update
export const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };
    if (updates.city) updates.city = updates.city.trim();
    if (updates.state !== undefined) updates.state = updates.state?.trim() || "";
    if (updates.pincode !== undefined) updates.pincode = updates.pincode?.trim() || "";
    const area = await DeliveryArea.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
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
    const { areas } = req.body; // [{ city, state, pincode, deliveryCharge }]
    if (!Array.isArray(areas) || !areas.length) throw new ApiError(400, "areas array required");
    let inserted = 0, skipped = 0;
    for (const a of areas) {
      const city = a.city?.trim();
      if (!city) { skipped++; continue; }
      const exists = await DeliveryArea.findOne({ city })
        .collation({ locale: "en", strength: 2 });
      if (exists) { skipped++; continue; }
      await DeliveryArea.create({
        city,
        state: a.state?.trim() || "",
        pincode: a.pincode?.trim() || "",
        deliveryCharge: Number(a.deliveryCharge) || 0,
      });
      inserted++;
    }
    res.json(new ApiResponse(200, { inserted, skipped }, `${inserted} inserted, ${skipped} skipped`));
  } catch (err) { next(err); }
};
