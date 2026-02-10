# Security Policy

## Scope of security concerns

ClawForge is a local-first toolkit for deterministic workflow governance and
verifiable evidence generation. Security-relevant concerns generally include:

- Integrity of the append-only audit event chain.
- Correctness of hash and verification behavior.
- Artifact-addressing and manifest integrity.
- Evidence export correctness and tamper-detection behavior.
- Input validation boundaries for contracts and events.
- CLI behaviors that could cause unintentional data disclosure on local
  systems.

## Out of scope

The following are generally out of scope for this repository's security
reporting process:

- Vulnerabilities in third-party infrastructure not controlled by this project.
- Hosted-service concerns (uptime, DDoS, multi-tenant isolation), because this
  project is not a hosted or networked service.
- Reports that require unsupported deployment assumptions (for example,
  internet-exposed local databases without external protections).
- Best-practice hardening requests that do not identify a concrete, reproducible
  vulnerability in project behavior.

## Responsible reporting

Please report suspected vulnerabilities privately before any public disclosure.
Include enough detail to reproduce and assess the issue:

1. Affected version or commit.
2. Reproduction steps.
3. Expected vs. observed behavior.
4. Potential impact.
5. Any proof-of-concept files or logs (redacted as needed).

Use GitHub Security Advisories (preferred) or contact the maintainers directly
through the repository's private security reporting channel.

After triage, maintainers can coordinate acknowledgment, remediation planning,
and disclosure timing.

## Notes on deployment model

ClawForge is distributed as software and is intended to run in environments
operated by users. It does not provide a managed network endpoint or hosted API
as part of this repository.

Operational security controls (host hardening, access control,
encryption-at-rest, backup policy, and monitoring) are the responsibility of
the operator running the software.
