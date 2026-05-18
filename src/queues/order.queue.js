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
  console.log(`Order job ${job.id} completed. OrderId: ${result?.orderId}`);
});

orderQueue.on("failed", (job, err) => {
  console.error(`Order job ${job.id} failed: ${err.message}`);
});

orderQueue.on("stalled", (job) => {
  console.warn(`Order job ${job.id} stalled`);
});

export default orderQueue;
