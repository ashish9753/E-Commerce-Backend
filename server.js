import dotenv from "dotenv";
dotenv.config();

import { createServer } from "http";
import { Server } from "socket.io";
import app, { ALLOWED_ORIGINS } from "./src/app.js";
import connectDB from "./src/config/db.js";
import { initChatSocket } from "./src/sockets/chat.socket.js";
import { startOrderTimeoutJob } from "./src/jobs/orderTimeout.job.js";

const PORT = process.env.PORT || 5000;

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    // Same allowlist as the REST API so the Render frontend's websocket
    // (chat / live notifications) is accepted, not just localhost.
    origin: (origin, cb) => {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Socket.io CORS: origin ${origin} not allowed`));
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
});

initChatSocket(io);

connectDB().then(() => {
  httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT} in ${process.env.NODE_ENV} mode`);
    if (process.env.SKIP_QUEUE === "true") {
      console.log("[queue] mode: BYPASSED (SKIP_QUEUE=true) — orders processed synchronously, no Redis required");
    } else {
      console.log(`[queue] mode: ACTIVE — using Redis at ${process.env.REDIS_HOST || "127.0.0.1"}:${process.env.REDIS_PORT || 6379}`);
    }
    startOrderTimeoutJob();
  });
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err.message);
  httpServer.close(() => process.exit(1));
});
