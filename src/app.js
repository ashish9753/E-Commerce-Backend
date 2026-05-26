import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import hpp from "hpp";

import { errorHandler, notFound } from "./middleware/error.middleware.js";
import { mongoSanitize } from "./middleware/sanitize.middleware.js";
import routes from "./routes/index.js";

const app = express();

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
const ALLOWED_ORIGINS = (process.env.CLIENT_URL || "")
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

// Rate limiting disabled for development
// const limiter = rateLimit({ windowMs: 15*60*1000, max: 500, ... });
// const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, ... });

app.get("/health", (req, res) => res.json({ status: "OK", timestamp: new Date() }));

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
