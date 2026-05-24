import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:5000';
const fixture = JSON.parse(open('./load-test-users.json'));
const users = new SharedArray('load-test-users', () => fixture.users);
const productId = __ENV.PRODUCT_ID || fixture.productId;
const paymentMethod = __ENV.PAYMENT_METHOD || 'ONLINE';

const orderSuccess = new Counter('orders_201_created');
const orderConflict = new Counter('orders_409_out_of_stock');
const orderOther = new Counter('orders_other_status');

export const options = {
  scenarios: {
    browse_products: {
      executor: 'constant-arrival-rate',
      exec: 'browseProducts',
      rate: Number(__ENV.BROWSE_RPS || 100),
      timeUnit: '1s',
      duration: __ENV.BROWSE_DURATION || '30s',
      preAllocatedVUs: Number(__ENV.BROWSE_VUS || 100),
      maxVUs: Number(__ENV.BROWSE_MAX_VUS || 300),
    },
    flash_sale_orders: {
      executor: 'shared-iterations',
      exec: 'placeOrder',
      vus: Number(__ENV.ORDER_VUS || 1000),
      iterations: Number(__ENV.ORDER_ITERATIONS || 1000),
      maxDuration: __ENV.ORDER_MAX_DURATION || '5m',
      startTime: __ENV.ORDER_START_TIME || '2s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.50'],
    http_req_duration: ['p(95)<30000'],
    orders_201_created: ['count<=500'],
    orders_other_status: ['count==0'],
  },
};

export function browseProducts() {
  const res = http.get(`${BASE_URL}/api/v1/products`);

  check(res, {
    'products list returns 200': (r) => r.status === 200,
  });

  sleep(1);
}

export function placeOrder() {
  const user = users[__ITER % users.length];
  const payload = JSON.stringify({
    shippingAddressId: user.addressId,
    paymentMethod,
    useCart: false,
    directItem: {
      productId,
      quantity: 1,
    },
  });

  const res = http.post(`${BASE_URL}/api/v1/orders`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${user.token}`,
    },
    timeout: '120s',
  });

  if (res.status === 201) {
    orderSuccess.add(1);
  } else if (res.status === 409 || (res.status === 400 && res.body.includes('out of stock'))) {
    orderConflict.add(1);
  } else {
    orderOther.add(1);
    console.log(`Unexpected order status ${res.status}: ${res.body}`);
  }

  check(res, {
    'order is created or rejected for stock only': (r) =>
      r.status === 201 ||
      r.status === 409 ||
      (r.status === 400 && r.body.includes('out of stock')),
  });
}

export default browseProducts;
