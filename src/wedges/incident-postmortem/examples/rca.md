# INC-2049 — Root Cause Analysis

## Root Cause

A connection pool leak introduced in PR #1847 (merged 2026-02-07, author:
backend-eng-santos, reviewer: backend-eng-cho).

The `OrderProcessor.processRefund()` method opens a database transaction
at the start of the refund flow. On the happy path and on most error
branches, the transaction is committed or rolled back, releasing the
connection. However, the `ValidationError` branch added in PR #1847
throws before reaching the `finally` block, leaving the connection in
`idle in transaction` state indefinitely.

Under normal load (~20 refunds/hour), leaked connections are reclaimed
by the server-side `idle_in_transaction_session_timeout` (set to 30
minutes). During the 02:00-04:00 batch refund window (~800 refunds/hour),
connections accumulate faster than the timeout reclaims them.

## Contributing Factors

1. **Missing `finally` block.** The refund path lacked a guaranteed
   connection release. This was a code defect.
2. **No connection pool monitoring alert.** The existing alert triggers
   at 95% pool utilization, which gives approximately 3 minutes of
   warning at batch-refund rates. Insufficient for human response.
3. **Shared connection pool.** payments-api, inventory-api, and
   order-processing-service share a PostgreSQL cluster with a single
   200-connection pool. Exhaustion in one service cascades to all.
4. **No integration test for the refund-validation-error path under
   load.** The unit test for PR #1847 mocked the database connection
   and did not detect the leak.

## Remediation

| Action | Owner | Status | Due |
|--------|-------|--------|-----|
| Hotfix: add `finally { connection.release() }` | backend-eng-santos | Done (PR #1863) | — |
| Add connection pool utilization alert at 70% | sre-patel | Pending | 2026-02-14 |
| Implement per-service connection pool isolation | dba-kim | Pending | 2026-02-28 |
| Add integration test: refund-validation-error under load | backend-eng-santos | Pending | 2026-02-17 |
| Audit all transaction paths for missing `finally` blocks | backend-eng-cho | Pending | 2026-02-21 |

## What Went Well

- Alert fired within 2 minutes of threshold breach.
- On-call acknowledged within 2 minutes.
- Root cause identified within 23 minutes.
- Rolling restart mitigated impact within 38 minutes.
- No data loss or corruption.

## What Went Poorly

- Batch refund window was not considered during PR review.
- Connection pool alert threshold too high for fast-leak scenarios.
- Shared pool meant one service's bug affected three services.
