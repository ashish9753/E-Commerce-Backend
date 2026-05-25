import Bull from "bull";
import redisConfig from "../config/redis.js";
import { processOrderJob } from "./order.processor.js";

const orderQueue = new Bull("order-queue", {
  redis: redisConfig,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    timeout: 30000,
  },
});

// Concurrency = 1 ensures jobs are processed one at a time (serialized)
// This prevents race conditions when multiple users buy the same low-stock item
orderQueue.process(1, processOrderJob);

orderQueue.on("completed", (job, result) => {
  console.log(`[queue] order job ${job.id} completed (orderId=${result?.orderId})`);
});

orderQueue.on("failed", (job, err) => {
  console.error(`[queue] order job ${job.id} failed:`, err.message);
});

orderQueue.on("stalled", (job) => {
  console.warn(`[queue] order job ${job.id} stalled`);
});

// Bull's underlying ioredis client surfaces connection issues here.
// Logging once at WARN keeps the user informed without spamming the console.
let redisErrorLogged = false;
orderQueue.on("error", (err) => {
  if (!redisErrorLogged) {
    console.error(
      `[queue] Redis connection error: ${err.message}\n` +
      `        Queue is configured to use Redis at ${redisConfig.host}:${redisConfig.port}.\n` +
      `        Start Redis, or set SKIP_QUEUE=true in .env to bypass the queue (dev only).`
    );
    redisErrorLogged = true;
  }
});

export default orderQueue;
