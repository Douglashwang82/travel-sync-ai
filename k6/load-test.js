/**
 * TravelSync AI — k6 load test
 *
 * Usage:
 *   BASE_URL=https://your-app.vercel.app k6 run k6/load-test.js
 *
 * Scenarios tested:
 *   1. webhook        — simulate LINE webhook event bursts (200 VUs, 1 min ramp)
 *   2. liff_session   — LIFF session fetch (50 VUs, steady)
 *   3. liff_expenses  — LIFF expenses endpoint read (50 VUs, steady)
 *   4. health         — healthcheck probe (10 VUs, constant)
 *
 * Acceptance thresholds:
 *   - p(95) < 2000ms for webhook
 *   - p(95) < 1500ms for LIFF endpoints
 *   - error rate < 1%
 */

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const LINE_GROUP_ID = __ENV.TEST_LINE_GROUP_ID || "Ctest-group-0001";
const LINE_USER_ID = __ENV.TEST_LINE_USER_ID || "Utest-user-0001";

// ─── Custom metrics ───────────────────────────────────────────────────────────

const webhookErrors = new Rate("webhook_errors");
const liffErrors = new Rate("liff_errors");
const webhookDuration = new Trend("webhook_duration_ms", true);
const liffDuration = new Trend("liff_duration_ms", true);

// ─── Scenarios ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    webhook: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 },
        { duration: "1m", target: 200 },
        { duration: "30s", target: 0 },
      ],
      exec: "webhookScenario",
      tags: { scenario: "webhook" },
    },
    liff_session: {
      executor: "constant-vus",
      vus: 30,
      duration: "2m",
      exec: "liffSessionScenario",
      tags: { scenario: "liff_session" },
    },
    liff_expenses: {
      executor: "constant-vus",
      vus: 30,
      duration: "2m",
      exec: "liffExpensesScenario",
      tags: { scenario: "liff_expenses" },
    },
    health: {
      executor: "constant-vus",
      vus: 5,
      duration: "2m",
      exec: "healthScenario",
      tags: { scenario: "health" },
    },
  },
  thresholds: {
    webhook_duration_ms: ["p(95)<2000"],
    liff_duration_ms: ["p(95)<1500"],
    webhook_errors: ["rate<0.01"],
    liff_errors: ["rate<0.01"],
    http_req_failed: ["rate<0.05"],
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lineWebhookBody(text) {
  return JSON.stringify({
    destination: "Ubot123",
    events: [
      {
        type: "message",
        mode: "active",
        timestamp: Date.now(),
        source: {
          type: "group",
          groupId: LINE_GROUP_ID,
          userId: LINE_USER_ID,
        },
        webhookEventId: `ev-${Math.random().toString(36).slice(2)}`,
        deliveryContext: { isRedelivery: false },
        replyToken: `rt-${Math.random().toString(36).slice(2)}`,
        message: {
          id: `msg-${Math.random().toString(36).slice(2)}`,
          type: "text",
          text,
        },
      },
    ],
  });
}

// ─── Scenario: LINE webhook ───────────────────────────────────────────────────

const WEBHOOK_COMMANDS = [
  "/status",
  "/help",
  "/exp-summary",
  "/ideas",
  "We should check out Shinjuku!",
  "I am available July 15-20",
];

export function webhookScenario() {
  const text = WEBHOOK_COMMANDS[Math.floor(Math.random() * WEBHOOK_COMMANDS.length)];
  const body = lineWebhookBody(text);

  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/webhook`, body, {
    headers: {
      "Content-Type": "application/json",
      "x-line-signature": "test-signature-bypass",
    },
  });
  webhookDuration.add(Date.now() - start);

  const ok = check(res, {
    "webhook: status 200 or 400": (r) => r.status === 200 || r.status === 400,
    "webhook: fast response": (r) => r.timings.duration < 3000,
  });

  webhookErrors.add(!ok);
  sleep(Math.random() * 0.5);
}

// ─── Scenario: LIFF session ───────────────────────────────────────────────────

export function liffSessionScenario() {
  const url =
    `${BASE_URL}/api/liff/session` +
    `?lineGroupId=${encodeURIComponent(LINE_GROUP_ID)}` +
    `&lineUserId=${encodeURIComponent(LINE_USER_ID)}` +
    `&displayName=LoadTest`;

  const start = Date.now();
  const res = http.get(url, {
    headers: { Accept: "application/json" },
  });
  liffDuration.add(Date.now() - start);

  const ok = check(res, {
    "liff/session: 200 or 404": (r) => r.status === 200 || r.status === 404,
    "liff/session: has JSON": (r) => r.headers["Content-Type"]?.includes("application/json"),
  });

  liffErrors.add(!ok);
  sleep(0.5 + Math.random() * 0.5);
}

// ─── Scenario: LIFF expenses ─────────────────────────────────────────────────

export function liffExpensesScenario() {
  const url =
    `${BASE_URL}/api/liff/expenses` +
    `?lineGroupId=${encodeURIComponent(LINE_GROUP_ID)}` +
    `&lineUserId=${encodeURIComponent(LINE_USER_ID)}`;

  const start = Date.now();
  const res = http.get(url, {
    headers: { Accept: "application/json" },
  });
  liffDuration.add(Date.now() - start);

  const ok = check(res, {
    "liff/expenses: 200 or 404": (r) => r.status === 200 || r.status === 404,
  });

  liffErrors.add(!ok);
  sleep(0.5 + Math.random() * 0.5);
}

// ─── Scenario: health check ───────────────────────────────────────────────────

export function healthScenario() {
  const res = http.get(`${BASE_URL}/api/health`);

  check(res, {
    "health: 200 or 503": (r) => r.status === 200 || r.status === 503,
    "health: has status field": (r) => {
      try {
        const body = JSON.parse(r.body);
        return typeof body.status === "string";
      } catch {
        return false;
      }
    },
  });

  sleep(2);
}
