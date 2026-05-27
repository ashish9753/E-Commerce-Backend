import Event from "../models/event.model.js";
import Coupon from "../models/coupon.model.js";
import { uploadToCloudinary } from "../utils/cloudinary.utils.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

const CODE_RE = /^[A-Z0-9_-]{2,32}$/;

// Derive a coupon code from the event. Prefers explicit badge, falls back to a
// slug of the event name + discount percent.
const deriveCouponCode = (name, badge, discountPercent) => {
  if (badge && CODE_RE.test(badge.trim().toUpperCase())) return badge.trim().toUpperCase();
  const slug = (name || "EVENT").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 20) || "EVENT";
  const suffix = discountPercent ? String(Math.round(discountPercent)) : "";
  const code = (slug + suffix).slice(0, 32);
  return CODE_RE.test(code) ? code : null;
};

// Build the coupon fields that mirror this event.
const buildCouponPayload = (event, code) => ({
  code,
  discountType: "PERCENTAGE",
  discountValue: event.discountPercent,
  expiryDate: event.endDate,
  isActive: event.isActive !== false,
  visibility: "everyone",
  minimumAmount: 0,
  usageLimit: null,
});

// Find a free coupon code: if `code` collides with a different doc, append -1, -2 etc.
const resolveFreeCode = async (code, excludeId) => {
  let candidate = code;
  let n = 1;
  while (true) {
    const existing = await Coupon.findOne({ code: candidate });
    if (!existing || (excludeId && existing._id.toString() === excludeId.toString())) return candidate;
    n += 1;
    candidate = `${code.slice(0, 30 - String(n).length)}-${n}`;
    if (n > 100) return candidate;
  }
};

// Sync a coupon for an event. Creates/updates/deletes as needed so the coupons
// section always reflects what's live in the events tab.
const syncCouponForEvent = async (event) => {
  const wantsCoupon = event.discountPercent > 0;
  const code = wantsCoupon ? deriveCouponCode(event.name, event.badge, event.discountPercent) : null;

  // No usable code or no discount → remove any linked coupon
  if (!code) {
    if (event.coupon) {
      await Coupon.findByIdAndDelete(event.coupon);
      event.coupon = undefined;
      await event.save();
    }
    return;
  }

  // Update existing linked coupon
  if (event.coupon) {
    const existing = await Coupon.findById(event.coupon);
    if (existing) {
      const freeCode = await resolveFreeCode(code, existing._id);
      existing.code = freeCode;
      existing.discountType = "PERCENTAGE";
      existing.discountValue = event.discountPercent;
      existing.expiryDate = event.endDate;
      existing.isActive = event.isActive !== false;
      existing.visibility = "everyone";
      await existing.save();
      return;
    }
    // linked coupon was deleted outside — fall through to recreate
  }

  // Create new coupon
  const freeCode = await resolveFreeCode(code);
  const coupon = await Coupon.create(buildCouponPayload(event, freeCode));
  event.coupon = coupon._id;
  await event.save();
};

export const createEvent = async (req, res, next) => {
  try {
    const { name, badge, description, discountPercent, startDate, endDate } = req.body;
    if (!name || !startDate || !endDate) throw new ApiError(400, "Name, startDate and endDate are required");

    let image;
    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/events");
      image = result.secure_url;
    }

    const event = await Event.create({ name, badge, description, discountPercent, startDate, endDate, image });
    await syncCouponForEvent(event);

    const populated = await Event.findById(event._id).populate("coupon");
    res.status(201).json(new ApiResponse(201, { event: populated }, "Event created"));
  } catch (err) { next(err); }
};

export const getAllEvents = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.active === "true") filter.isActive = true;
    const events = await Event.find(filter).populate("coupon").sort({ startDate: -1 });
    res.json(new ApiResponse(200, { events }));
  } catch (err) { next(err); }
};

export const updateEvent = async (req, res, next) => {
  try {
    const { name, badge, description, discountPercent, startDate, endDate, isActive } = req.body;
    const updates = {};
    if (name !== undefined)            updates.name = name;
    if (badge !== undefined)           updates.badge = badge;
    if (description !== undefined)     updates.description = description;
    if (discountPercent !== undefined) updates.discountPercent = discountPercent;
    if (startDate !== undefined)       updates.startDate = startDate;
    if (endDate !== undefined)         updates.endDate = endDate;
    if (isActive !== undefined)        updates.isActive = isActive === true || isActive === "true";

    if (req.file) {
      const result = await uploadToCloudinary(req.file.buffer, "ecommerce/events");
      updates.image = result.secure_url;
    }
    const event = await Event.findByIdAndUpdate(req.params.eventId, updates, { new: true });
    if (!event) throw new ApiError(404, "Event not found");

    await syncCouponForEvent(event);

    const populated = await Event.findById(event._id).populate("coupon");
    res.json(new ApiResponse(200, { event: populated }, "Event updated"));
  } catch (err) { next(err); }
};

export const deleteEvent = async (req, res, next) => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) throw new ApiError(404, "Event not found");
    if (event.coupon) await Coupon.findByIdAndDelete(event.coupon);
    await event.deleteOne();
    res.json(new ApiResponse(200, null, "Event deleted"));
  } catch (err) { next(err); }
};
