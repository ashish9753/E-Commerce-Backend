// Thin wrapper around the Upaya client API. All outbound calls go through
// here so we have one place to attach the API key, normalize errors and
// apply caching.
//
// Required env vars:
//   UPAYA_API_KEY        — issued by Upaya for the client account
//   UPAYA_BASE_URL       — optional, defaults to the production endpoint
//
// Reference: docs/Upaya Client API.pdf
import ApiError from "../utils/ApiError.js";

const DEFAULT_BASE_URL = "https://portal-api.upaya.com.np/api/v1/client";
const REQUEST_TIMEOUT_MS = 15_000;
const LOCATIONS_TTL_MS = 60 * 60 * 1000; // 1 hour — locations rarely change

const baseUrl = () => (process.env.UPAYA_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
const apiKey  = () => process.env.UPAYA_API_KEY;

const assertConfigured = () => {
  if (!apiKey()) {
    throw new ApiError(503, "Delivery service is not configured. Please contact support.");
  }
};

const request = async (path, { method = "GET", body, signal } = {}) => {
  assertConfigured();
  const ctrl = signal ? null : new AbortController();
  const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS) : null;

  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: {
        "X-API-Key": apiKey(),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || ctrl?.signal,
    });

    let payload = null;
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
    }

    if (!res.ok) {
      const message = payload?.message || payload?.error || `Upaya ${method} ${path} failed (${res.status})`;
      throw new ApiError(res.status === 401 ? 502 : res.status, `Upaya: ${message}`);
    }
    return payload;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === "AbortError") throw new ApiError(504, "Delivery service timed out");
    throw new ApiError(502, `Delivery service error: ${err.message || "unknown"}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// In-memory cache for the location list — refreshed lazily.
let locationsCache = { data: null, expiresAt: 0 };
export const invalidateLocationsCache = () => { locationsCache = { data: null, expiresAt: 0 }; };

export const upayaService = {
  async getLocations({ force = false } = {}) {
    if (!force && locationsCache.data && Date.now() < locationsCache.expiresAt) {
      return locationsCache.data;
    }
    const data = await request("/locations");
    locationsCache = { data, expiresAt: Date.now() + LOCATIONS_TTL_MS };
    return data;
  },

  getLocation(locationId) {
    return request(`/locations/${encodeURIComponent(locationId)}`);
  },

  trackOrder(orderRef) {
    return request(`/track-order/${encodeURIComponent(orderRef)}`);
  },

  // POST /order-rates — calculate shipping cost for a prospective order
  rate({ initial_weight, order_type = "delivery_order", service_type_id = 3, location_id, length = null, breadth = null, height = null }) {
    return request("/order-rates", {
      method: "POST",
      body: {
        initial_weight: Number(initial_weight) || 1,
        order_type,
        service_type_id: Number(service_type_id),
        location_id: Number(location_id),
        length, breadth, height,
      },
    });
  },

  // POST /add-order — create a delivery order on Upaya. `orders` is an array
  // of receiver payloads matching the docs.
  addOrder(orders) {
    return request("/add-order", {
      method: "POST",
      body: { orders: Array.isArray(orders) ? orders : [orders] },
    });
  },

  isConfigured() { return !!apiKey(); },
};
