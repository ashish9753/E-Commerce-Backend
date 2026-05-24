import fs from "fs";
import http from "http";
import https from "https";
import { performance } from "perf_hooks";

const BASE_URL = process.env.BASE_URL || "http://localhost:5000";
const ORDER_CONCURRENCY = Number(process.env.ORDER_ITERATIONS || 1000);
const BROWSE_REQUESTS = Number(process.env.BROWSE_REQUESTS || 100);
const PAYMENT_METHOD = process.env.PAYMENT_METHOD || "ONLINE";

if (!fs.existsSync("load-test-users.json")) {
  throw new Error("load-test-users.json not found. Run npm run load:setup first.");
}

const fixture = JSON.parse(fs.readFileSync("load-test-users.json", "utf8"));
const productId = process.env.PRODUCT_ID || fixture.productId;
const users = fixture.users;
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 2000 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 2000 });

function request(method, url, { headers = {}, body = "" } = {}) {
  const parsed = new URL(url);
  const transport = parsed.protocol === "https:" ? https : http;
  const agent = parsed.protocol === "https:" ? httpsAgent : httpAgent;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        method,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          ...headers,
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
        },
        agent,
        timeout: 180000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            text: async () => Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error("request timeout"));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

async function timedRequest(label, request) {
  const started = performance.now();
  try {
    const response = await request();
    const text = await response.text();
    return {
      label,
      status: response.status,
      ms: performance.now() - started,
      body: text,
    };
  } catch (err) {
    return {
      label,
      status: 0,
      ms: performance.now() - started,
      body: [err.code, err.message, err.cause?.message].filter(Boolean).join(" - "),
    };
  }
}

async function browseProducts() {
  const requests = Array.from({ length: BROWSE_REQUESTS }, () =>
    timedRequest("browse", () => request("GET", `${BASE_URL}/api/v1/products`))
  );

  return Promise.all(requests);
}

async function placeOrders() {
  const requests = Array.from({ length: ORDER_CONCURRENCY }, (_, index) => {
    const user = users[index % users.length];
    const body = JSON.stringify({
      shippingAddressId: user.addressId,
      paymentMethod: PAYMENT_METHOD,
      useCart: false,
      directItem: {
        productId,
        quantity: 1,
      },
    });

    return timedRequest("order", () =>
      request("POST", `${BASE_URL}/api/v1/orders`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
        body,
      })
    );
  });

  return Promise.all(requests);
}

function summarize(results) {
  const durations = results.map((result) => result.ms);
  const statuses = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});

  return {
    total: results.length,
    statuses,
    avgMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    p95Ms: percentile(durations, 95),
    maxMs: Math.max(...durations),
  };
}

function printSummary(title, summary) {
  console.log(`\n${title}`);
  console.log(`Total requests: ${summary.total}`);
  console.log(`Status counts: ${JSON.stringify(summary.statuses)}`);
  console.log(`Avg latency: ${summary.avgMs.toFixed(0)} ms`);
  console.log(`P95 latency: ${summary.p95Ms.toFixed(0)} ms`);
  console.log(`Max latency: ${summary.maxMs.toFixed(0)} ms`);
}

async function main() {
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Product ID: ${productId}`);
  console.log(`Browse requests: ${BROWSE_REQUESTS}`);
  console.log(`Concurrent order attempts: ${ORDER_CONCURRENCY}`);

  const browseResults = await browseProducts();
  const orderResults = await placeOrders();

  const browseSummary = summarize(browseResults);
  const orderSummary = summarize(orderResults);
  const orderSuccess = orderSummary.statuses[201] || 0;
  const outOfStock = (orderSummary.statuses[409] || 0) + (orderSummary.statuses[400] || 0);
  const unexpected = orderResults.filter((result) => {
    if (result.status === 201 || result.status === 409) return false;
    if (result.status === 400 && result.body.includes("out of stock")) return false;
    return true;
  });

  printSummary("Product browsing", browseSummary);
  printSummary("Flash sale orders", orderSummary);

  console.log("\nInventory expectation");
  console.log(`Expected created orders: <= ${fixture.stock}`);
  console.log(`Actual created orders: ${orderSuccess}`);
  console.log(`Stock rejections: ${outOfStock}`);
  console.log(`Unexpected responses: ${unexpected.length}`);

  if (unexpected.length > 0) {
    console.log("\nFirst unexpected responses:");
    for (const result of unexpected.slice(0, 10)) {
      console.log(`${result.status}: ${result.body.slice(0, 300)}`);
    }
  }

  const ok = orderSuccess <= fixture.stock && unexpected.length === 0;
  console.log(`\nLoad test result: ${ok ? "PASS" : "FAIL"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
