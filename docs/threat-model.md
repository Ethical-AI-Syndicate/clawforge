# ClawForge Threat Model

## Scope

This threat model covers the ClawForge audit and contract foundation layer: schema validation (see [Contract Schemas](contracts.md)), event storage (see [Audit Event Model](audit.md)), artifact storage, and evidence export. For module boundaries and design rationale, see [Architecture](architecture.md). This document is pragmatic: it states what we protect against, what we explicitly do not, and the mitigations in place.

## Assets

| Asset              | Sensitivity | Description                                      |
| ------------------ | ----------- | ------------------------------------------------ |
| Audit event store  | High        | Append-only SQLite database; authoritative record of all workflow actions |
| Contract data      | Medium      | Workflow definitions including user-provided intent and parameters |
| Artifacts          | Variable    | Output files produced by worker tasks; content-addressed by SHA-256 |
| Evidence bundles   | High        | Exported zip proof packages for offline verification |
| Run metadata       | Low-Medium  | Run IDs, timestamps, actor IDs, host IDs         |

## What We Protect Against

### 1. Event Tampering (post-write)

**Threat:** An attacker or bug modifies a stored event after it was written.

**Mitigation:**
- SHA-256 hash chain per run. Each event's `hash` covers all fields except `hash` and `prevHash`.
- `prevHash` links to the previous event, forming a chain.
- `verifyRunChain()` recomputes every hash and checks every chain link. Any modification is detected and reported with the exact sequence number and failure type.
- Evidence bundles include the full hash list and verification result.

**Residual risk:** An attacker with direct SQLite write access can recalculate the entire chain from the point of modification forward, producing a valid-looking chain with altered content. Local hash chains provide tamper **detection** (accidental or by parties without full DB access), not tamper **prevention** against a privileged attacker. For stronger guarantees, publish periodic hash snapshots to an external append-only store (see Recommendations).

### 2. Artifact Substitution

**Threat:** An artifact file on disk is replaced with different content after storage.

**Mitigation:**
- Content-addressable storage: the filesystem path includes the full SHA-256 hash.
- The `ArtifactRecorded` audit event records the SHA-256 hash, size, and MIME type.
- Verification: recompute the SHA-256 of the file at the stored path; compare with the hash in the event. A mismatch means substitution occurred.

**Residual risk:** An attacker who can modify both the artifact file and the corresponding database row (and recalculate the chain) can substitute undetected. Same residual as threat #1.

### 3. Secret Leakage in Events

**Threat:** API keys, tokens, or passwords are accidentally recorded in event payloads, contract fields, or artifact content.

**Mitigation:**
- All freeform text fields are documented as UNTRUSTED and subject to max-length limits.
- `redactSensitive()` helper scans for common secret patterns (API key prefixes, bearer tokens, keys named `password`/`secret`/`token`/`apiKey`/`authorization`).
- Max-length enforcement limits blast radius.
- Documentation warns operators to never store secrets in contracts or events.

**Residual risk:** Pattern-based redaction cannot catch all secrets. Custom patterns can be added. Defense in depth: do not put secrets into the system in the first place.

### 4. Path Traversal in Artifact Store

**Threat:** Malicious input to the artifact store or evidence export causes files to be written outside the designated directory.

**Mitigation:**
- Artifact storage paths are derived solely from SHA-256 hex hashes (characters `[0-9a-f]`). No user-supplied strings appear in filesystem paths.
- After path construction, `path.resolve()` is called and the result is checked to be a descendant of the artifact root directory.
- Evidence export zip entry names are constructed from the same safe hash-derived paths. No user-controlled strings are used in zip entry names.

### 5. Oversized Payloads (Resource Exhaustion)

**Threat:** Extremely large contracts, events, or artifacts exhaust memory or disk space.

**Mitigation:**
- Max-length limits on all freeform string fields (enforced at validation time).
- Max key counts on `Record<string, unknown>` fields (50 keys).
- Serialized size checks on `inputParams` and `toolParams` (100 KB max).
- Artifact export skips files larger than 50 MB (manifest-only reference).
- SQLite page size and journal mode provide practical row-size limits.

### 6. Event Ordering Manipulation

**Threat:** Events are reordered, duplicated, or gaps are introduced in the sequence.

**Mitigation:**
- `seq` is enforced as strictly sequential (increment by exactly 1, no gaps) at append time.
- The `PRIMARY KEY (run_id, seq)` constraint prevents duplicate seq within a run.
- `prevHash` chain linking makes reordering detectable during verification.
- The store rejects an event whose `seq` does not equal `max_seq + 1`.

### 7. Zip Slip in Evidence Import (future)

**Threat:** A malicious evidence bundle zip contains entries with `../` paths that escape the extraction directory.

**Mitigation (design-time):** Evidence import (not yet implemented) must validate all zip entry paths against the extraction root before writing. This is documented here as a requirement for any future import feature.

## What We Do NOT Protect Against

### 1. Privileged Insider with Full DB Access

An attacker who can read and write the SQLite file and recalculate hash chains can forge a consistent-looking audit trail. Mitigation requires external anchoring (out of scope for foundation layer).

### 2. Confidentiality at Rest

The SQLite database and artifact files are stored unencrypted on the local filesystem. Encryption at rest is the responsibility of the deployment environment (e.g., LUKS, FileVault, BitLocker).

### 3. Network-Level Attacks

ClawForge's foundation layer is local-first. It does not listen on network ports. Network security (TLS, authn, authz) is the responsibility of any future API layer built on top.

### 4. Availability / Durability

The append-only store has no replication, no backup, and no high-availability mechanism. Backup and disaster recovery are the operator's responsibility.

### 5. Side-Channel Attacks

Timing attacks on hash comparison, cache-based attacks, etc., are not mitigated. The threat model assumes a trusted local execution environment.

## Recommendations for Production Deployment

1. **External hash anchoring:** Periodically export the last event hash of each active run to an external append-only store (e.g., a transparency log, a blockchain, or a signed timestamping service).
2. **Encryption at rest:** Use OS-level or filesystem-level encryption for the data directory.
3. **Access control:** Restrict filesystem permissions on the SQLite database and artifact directory to the service account only.
4. **Backup:** Automated, regular backups of the SQLite database and artifact directory. Test restores.
5. **Monitoring:** Alert on `verifyRunChain()` failures. Any verification failure in production is a critical incident.
6. **Redaction policy:** Define organization-specific patterns for `redactSensitive()` beyond the built-in defaults. Review redaction coverage periodically.
7. **Artifact size limits:** Set organizational policy for maximum artifact size. The 50 MB export threshold is a default; adjust based on operational needs.
