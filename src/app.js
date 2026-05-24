import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
// import rateLimit from "express-rate-limit";

import { errorHandler, notFound } from "./middleware/error.middleware.js";
import { mongoSanitize } from "./middleware/sanitize.middleware.js";
import routes from "./routes/index.js";

const app = express();

app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:3000",
  credentials: true,
}));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());
app.use(mongoSanitize);

// Temporarily disabled for load testing.
// const limiter = rateLimit({
//   windowMs: 15 * 60 * 1000,
//   max: 500,
//   standardHeaders: true,
//   legacyHeaders: false,
//   message: { message: "Too many requests, please try again later." },
// });
// app.use("/api", limiter);

app.get("/health", (req, res) => res.json({ status: "OK", timestamp: new Date() }));

app.use("/api/v1", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
