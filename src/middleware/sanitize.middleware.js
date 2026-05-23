/**
 * Strip MongoDB operator/dot keys from any user-controlled object.
 *
 * Why: any `findOne({ field: req.body.x })` pattern is vulnerable if x is an
 * object like { "$ne": null } or { "$gt": "" } — Mongo treats it as a query
 * operator and matches arbitrary documents. Removing these keys at the edge
 * lets every controller treat req.body / req.query / req.params as plain JSON.
 *
 * We mutate in place rather than reassigning so existing references hold.
 */
const isPlainObject = (v) =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !Buffer.isBuffer(v);

const sanitize = (input) => {
  if (Array.isArray(input)) {
    for (const item of input) sanitize(item);
    return;
  }
  if (!isPlainObject(input)) return;
  for (const key of Object.keys(input)) {
    if (key.startsWith("$") || key.includes(".")) {
      delete input[key];
      continue;
    }
    sanitize(input[key]);
  }
};

export const mongoSanitize = (req, _res, next) => {
  if (req.body) sanitize(req.body);
  if (req.params) sanitize(req.params);
  if (req.query) sanitize(req.query);
  next();
};

export default mongoSanitize;
