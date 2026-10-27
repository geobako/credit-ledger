/**
 * Load test for the authorization hot path.
 *
 *  gateway   Steady card traffic through the Go gateway across many cards, as a network would
 *            send it: authorize, then capture or reverse most approvals.
 *  hot_card  Many concurrent purchases and releases on ONE card, straight at the lending API's
 *            internal endpoint (signed like the gateway): worst-case contention on a single
 *            account row lock.
 *
 * Afterwards, teardown runs reconciliation: the run fails if the books don't balance.
 * Run with `make load` (seeds cards, then runs this in a k6 container on the compose network).
 */
import crypto from 'k6/crypto';
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const GATEWAY = __ENV.GATEWAY_URL || 'http://card-gateway:8081';
const API = __ENV.API_URL || 'http://lending-api:3000';
const NETWORK_KEY = __ENV.NETWORK_API_KEY || 'local-dev-network-key-change-me';
const GATEWAY_SECRET =
  __ENV.GATEWAY_SHARED_SECRET || 'local-dev-gateway-secret-change-me-0123456789';
const RATE = Number(__ENV.RATE || 30); // gateway authorizations per second
const DURATION = __ENV.DURATION || '1m';

const fixtures = JSON.parse(open('./.fixtures.json'));

const SCENARIOS = {
  gateway: {
    executor: 'constant-arrival-rate',
    exec: 'gatewayTraffic',
    rate: RATE,
    timeUnit: '1s',
    duration: DURATION,
    preAllocatedVUs: 20,
    maxVUs: 100,
  },
  hot_card: {
    executor: 'constant-vus',
    exec: 'hotCard',
    vus: 25,
    duration: '30s',
    startTime: '10s',
  },
};
// SCENARIOS=gateway (or hot_card) runs one in isolation.
const selected = (__ENV.SCENARIOS || Object.keys(SCENARIOS).join(',')).split(',');

export const options = {
  scenarios: Object.fromEntries(
    Object.entries(SCENARIOS).filter(([name]) => selected.includes(name)),
  ),
  thresholds: {
    'http_req_duration{scenario:gateway,op:authorize}': ['p(95)<250', 'p(99)<500'],
    'http_req_duration{scenario:hot_card}': ['p(95)<500'],
    // Fail-closed declines would mean the API could not answer in time.
    issuer_unavailable: ['rate<0.001'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
  },
};

const issuerUnavailable = new Rate('issuer_unavailable');
const responseCodes = new Counter('response_codes');
const hotCardLatency = new Trend('hot_card_authorize_ms', true);

const uuid = () =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

const networkHeaders = { 'Content-Type': 'application/json', 'X-Network-Key': NETWORK_KEY };

export function gatewayTraffic() {
  const card = fixtures.cards[Math.floor(Math.random() * fixtures.cards.length)];
  const res = http.post(
    `${GATEWAY}/v1/authorizations`,
    JSON.stringify({
      network_transaction_id: `k6_${uuid()}`,
      card_token: card,
      amount: 100 + Math.floor(Math.random() * 1900),
      currency: 'USD',
      merchant: { name: 'k6 Merchant', mcc: '5812' },
    }),
    { headers: networkHeaders, tags: { op: 'authorize' } },
  );
  const body = res.json();
  responseCodes.add(1, { code: body.response_code });
  issuerUnavailable.add(body.response_code === '91');
  check(res, {
    'authorize answered': (r) => r.status === 200,
    'approved or a business decline': () => ['00', '51', '65'].includes(body.response_code),
  });

  if (body.approved) {
    const roll = Math.random();
    if (roll < 0.6) {
      const c = http.post(`${GATEWAY}/v1/authorizations/${body.authorization_id}/capture`, '{}', {
        headers: networkHeaders,
        tags: { op: 'capture' },
      });
      check(c, { 'capture ok': (r) => r.status === 200 });
    } else if (roll < 0.85) {
      const v = http.post(`${GATEWAY}/v1/authorizations/${body.authorization_id}/reversal`, null, {
        headers: networkHeaders,
        tags: { op: 'reverse' },
      });
      check(v, { 'reversal ok': (r) => r.status === 200 });
    }
  }
}

function signed(path, payload) {
  const raw = payload === undefined ? '' : JSON.stringify(payload);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.hmac('sha256', GATEWAY_SECRET, `${t}\nPOST\n${path}\n${raw}`, 'hex');
  return http.post(`${API}${path}`, raw, {
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Id': 'card-gateway',
      'X-Signature': `t=${t},v1=${sig}`,
    },
  });
}

export function hotCard() {
  const res = signed('/v1/network/authorizations', {
    networkTransactionId: `k6hot_${uuid()}`,
    cardToken: fixtures.hotCard,
    amount: '500',
    currency: 'USD',
    merchantName: 'k6 Hot Card',
  });
  hotCardLatency.add(res.timings.duration);
  const body = res.json();
  check(res, { 'hot card answered': (r) => r.status === 200 });
  // Release every approval so the card never runs dry: maximum churn on one row lock.
  if (body.approved) {
    const rev = signed(`/v1/network/authorizations/${body.authorizationId}/reverse`);
    check(rev, { 'hot card reversal ok': (r) => r.status === 200 });
  }
}

export function teardown() {
  const login = http.post(`${API}/v1/auth/demo-login`, JSON.stringify({ email: 'ops@acme.test' }), {
    headers: { 'Content-Type': 'application/json' },
  });
  const token = login.json('accessToken');
  const report = http.get(`${API}/v1/ops/reconciliation`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ok = report.json('ok');
  console.log(`reconciliation after load: ${ok ? 'OK' : 'FAILED'}`);
  if (!ok) throw new Error(`reconciliation failed: ${report.body}`);
}
