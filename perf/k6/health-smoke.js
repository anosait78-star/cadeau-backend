import http from "k6/http";
import { check } from "k6";

/**
 * API performance smoke (Roadmap §2.4). Loads the read endpoint `/v1/health` and
 * enforces the read budget: server P95 < 300ms. Thresholds are hard gates — k6
 * exits non-zero (blocking the merge) if any is breached.
 *
 * Write-path load tests (P95 < 500ms) are added with the domain write endpoints
 * (EPIC-3+); today the foundation only exposes reads.
 */
export const options = {
  vus: 10,
  duration: "20s",
  thresholds: {
    // §2.4 read budget.
    "http_req_duration{expected_response:true}": ["p(95)<300"],
    // Availability under load.
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.API_BASE_URL || "http://localhost:3001";

export default function () {
  const res = http.get(`${BASE_URL}/v1/health`);
  check(res, {
    "status is 200": (r) => r.status === 200,
    "status is ok": (r) => r.json("status") === "ok",
  });
}
