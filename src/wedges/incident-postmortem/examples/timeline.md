# INC-2049 — Incident Timeline

All times UTC.

## Detection

- **03:17** — PagerDuty alert: payments-api 5xx rate exceeds 5% threshold.
  Primary on-call (sre-patel) acknowledged at 03:19.
- **03:22** — Grafana dashboard confirms: payments-api p99 latency jumped
  from 120ms to 8,400ms. Connection pool utilization at 94%.
- **03:25** — Second alert: inventory-api 5xx rate exceeds 5%.
  Checkout-web error page rate rising.

## Investigation

- **03:28** — sre-patel opens incident channel. Pulls in dba-kim and
  backend-eng-santos.
- **03:33** — dba-kim confirms: PostgreSQL `pg_stat_activity` shows 200/200
  connections consumed. 147 connections held by order-processing-service,
  most in state `idle in transaction`.
- **03:40** — backend-eng-santos identifies the cause: PR #1847 (merged
  2026-02-07) introduced a code path in `OrderProcessor.processRefund()`
  that opens a transaction but does not close it on the validation-error
  branch. Under normal load this is benign; under the 02:00-04:00 batch
  refund window, it accumulates.
- **03:45** — Connection pool hits 200/200. New requests begin failing
  immediately. Cascading to all services sharing the same PostgreSQL
  cluster.

## Mitigation

- **03:48** — sre-patel initiates rolling restart of order-processing-service
  pods to release leaked connections.
- **03:55** — Connection pool drops to 62/200. payments-api 5xx rate begins
  falling.
- **04:10** — backend-eng-santos pushes hotfix PR #1863: adds explicit
  `finally { connection.release() }` to the refund path.
- **04:35** — Hotfix deployed to staging; integration tests pass.
- **04:52** — Hotfix deployed to production.
- **05:15** — All error rates return to baseline. Connection pool stable
  at 38/200.
- **05:31** — Incident declared resolved. Monitoring confirms 15 minutes
  of sustained stability.

## Impact

- Duration: 2 hours 14 minutes (03:17 — 05:31)
- ~12,000 failed checkout attempts
- ~$340,000 in delayed revenue (all orders eventually completed after
  resolution; no permanent revenue loss confirmed)
- No data loss or corruption detected
