# Incident Response Runbook v2.3

## P1 Escalation Path (after-hours)

1. PagerDuty alert fires to primary on-call.
2. Primary on-call has 15 minutes to acknowledge.
3. If no acknowledgement after 15 minutes:
   - Alert escalates to secondary on-call.
   - Slack #incident-response is notified automatically.
4. If no acknowledgement after 30 minutes:
   - Engineering manager is paged.
   - Incident is auto-declared in status page.

## SLA

| Severity | Acknowledge | Respond | Resolve |
|----------|-------------|---------|---------|
| P1       | 15 min      | 30 min  | 4 hours |
| P2       | 30 min      | 2 hours | 24 hours|

## Change History

- v2.3 (2026-02-10): Added after-hours P1 escalation path (OPS-891)
- v2.2 (2025-11-01): Updated PagerDuty rotation schedule
- v2.1 (2025-08-15): Initial runbook
