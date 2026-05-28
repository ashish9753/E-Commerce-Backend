import { upayaService, invalidateLocationsCache } from "../services/upaya.service.js";
import ApiError from "../utils/ApiError.js";
import ApiResponse from "../utils/ApiResponse.js";

// True when Upaya wasn't configured / reachable — used so we can degrade
// gracefully on public endpoints instead of spamming the customer with toasts.
const isNotConfigured = (err) =>
  err?.statusCode === 503 ||
  /not configured/i.test(err?.message || "");

// Normalise whatever shape Upaya returns into a stable `{ locations: [...] }`
// payload the frontend can consume.
const normaliseLocations = (raw) => {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.locations)
      ? raw.locations
      : Array.isArray(raw?.data)
        ? raw.data
        : [];
  return list.map((l) => ({
    locationId:   l.locationId   ?? l.location_id ?? l.id,
    locationName: l.locationName ?? l.location_name ?? l.name,
    address:      l.address      ?? "",
    areaId:       l.areaId       ?? l.area_id ?? null,
    raw: l,
  }));
};

export const getLocations = async (req, res, next) => {
  try {
    const force = req.query.refresh === "true";
    const raw = await upayaService.getLocations({ force });
    res.json(new ApiResponse(200, { locations: normaliseLocations(raw), fetchedAt: new Date().toISOString(), configured: true }));
  } catch (err) {
    // Public endpoint — never error a 503 here, just signal "no upaya" so the
    // frontend transparently falls back to the manual delivery-areas list.
    if (isNotConfigured(err)) {
      return res.json(new ApiResponse(200, { locations: [], configured: false, message: "Upaya not configured" }));
    }
    next(err);
  }
};

export const getLocation = async (req, res, next) => {
  try {
    const data = await upayaService.getLocation(req.params.locationId);
    res.json(new ApiResponse(200, { location: data }));
  } catch (err) { next(err); }
};

export const getRate = async (req, res, next) => {
  try {
    const { location_id, initial_weight, service_type_id, length, breadth, height, order_type } = req.body || {};
    if (!location_id) throw new ApiError(400, "location_id is required");
    const data = await upayaService.rate({
      location_id, initial_weight, service_type_id, length, breadth, height, order_type,
    });
    res.json(new ApiResponse(200, { rate: data }));
  } catch (err) { next(err); }
};

export const trackOrder = async (req, res, next) => {
  try {
    const { orderRef } = req.params;
    if (!orderRef) throw new ApiError(400, "Order reference is required");
    const data = await upayaService.trackOrder(orderRef);
    res.json(new ApiResponse(200, { tracking: data }));
  } catch (err) { next(err); }
};

// Admin-only — force refresh the cached location list (e.g. after Upaya
// has added new serviceable areas).
export const refreshLocations = async (req, res, next) => {
  try {
    invalidateLocationsCache();
    const raw = await upayaService.getLocations({ force: true });
    res.json(new ApiResponse(200, { locations: normaliseLocations(raw), refreshedAt: new Date().toISOString() }, "Upaya locations refreshed"));
  } catch (err) { next(err); }
};
