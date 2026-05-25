// Redis connection config used by the Bull queue (src/queues/order.queue.js).
// We export only the config object — Bull manages its own connection lifecycle.
// When SKIP_QUEUE=true the queue module is never imported and Redis is unused.
const redisConfig = {
  host: process.env.REDIS_HOST || "127.0.0.1",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

export default redisConfig;
