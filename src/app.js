import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import hpp from "hpp";

import { errorHandler, notFound } from "./middleware/error.middleware.js";
import { mongoSanitize } from "./middleware/sanitize.middleware.js";
import routes from "./routes/index.js";

const app = express();

// We're deployed behind Render's edge proxy, which adds X-Forwarded-For. Tell
// Express to trust the first hop so `req.ip` is the real client IP, not the
// proxy's. Without this, rate limiters, IP logging, and secure-cookie
// detection all see a single shared upstream IP for every request.
app.set("trust proxy", 1);

app.use(helmet());

// Allowed browser origins. Accepts a comma-separated list in CLIENT_URL so
// the same backend can serve local dev, the Render-hosted frontend, and any
// future preview deploys without code changes. The Render frontend is baked
// in as a safe default so a missing/typo'd env var doesn't take prod down.
//
// `credentials: true` requires an exact origin echo (no wildcards), which is
// why we match against an allowlist and return the caller's own Origin.
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://e-commerce-frontend-9vtd.onrender.com",
];
// Exported so Socket.io (server.js) shares the exact same allowlist — otherwise
// websocket connections from the Render frontend get blocked even though REST
// calls succeed.
export const ALLOWED_ORIGINS = (process.env.CLIENT_URL || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .concat(DEFAULT_ALLOWED_ORIGINS);

app.use(cors({
  origin: (origin, cb) => {
    // Non-browser callers (curl, server-to-server, health checks) have no
    // Origin header — let them through.
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(mongoSanitize);
app.use(hpp());

app.get("/health", (req, res) => res.json({ status: "OK", timestamp: new Date() }));

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
