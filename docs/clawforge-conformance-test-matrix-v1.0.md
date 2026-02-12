# ClawForge Change Integrity Specification v1.0 — Minimal Conformance Test Matrix

**Status:** Draft
**Version:** 1.0.0
**Date:** 2026-02-11

This matrix lists testable assertions per specification section. Each
assertion MUST produce a deterministic pass/fail result. An implementation
claiming conformance MUST pass every mandatory assertion.

---

## Section 1 — Purpose and Scope

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S1-01 | Validator produces a binary pass/fail verdict for any complete artifact set | Yes |
| S1-02 | Validator does not execute any artifact content | Yes |
| S1-03 | Validator treats all input as inert data | Yes |

## Section 2 — Terminology (Artifact Schemas)

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S2-01 | DoD with zero items fails schema validation with `SCHEMA_INVALID` | Yes |
| S2-02 | DoD with item containing "works as expected" fails vague language invariant | Yes |
| S2-03 | DoD item with `command_exit_code` method and missing `verificationCommand` fails | Yes |
| S2-04 | DoD item with `custom` method and `verificationProcedure` < 20 chars fails | Yes |
| S2-05 | Decision Lock with `status: approved` and missing `approvalMetadata` fails | Yes |
| S2-06 | Decision Lock containing `TODO` token fails placeholder check | Yes |
| S2-07 | Execution Plan containing `sudo` substring fails lint | Yes |
| S2-08 | Execution Plan containing `$(` fails lint | Yes |
| S2-09 | Execution Plan step referencing nonexistent DoD item fails referential check | Yes |
| S2-10 | Prompt Capsule with `temperature` != 0 fails schema validation | Yes |
| S2-11 | Prompt Capsule with `topP` != 1 fails schema validation | Yes |
| S2-12 | Prompt Capsule with `fileDigests` path not in `allowedFiles` fails | Yes |
| S2-13 | Prompt Capsule with `partialCoverage: false` and incomplete `fileDigests` fails | Yes |
| S2-14 | Prompt Capsule with empty string in `disallowedPatterns` fails | Yes |
| S2-15 | Prompt Capsule with duplicate `allowedFiles` entries fails | Yes |
| S2-16 | Model Response with `refusal` present and non-empty `proposedChanges` fails | Yes |
| S2-17 | Symbol Index with unsorted files fails determinism check | Yes |
| S2-18 | Step Packet exceeding 200 KB canonical JSON fails size constraint | Yes |
| S2-19 | Step Packet containing forbidden field name `"exec":` fails | Yes |
| S2-20 | Step Packet containing `TODO` fails lint | Yes |
| S2-21 | Step Packet with `reviewerSequence` < 3 entries fails | Yes |
| S2-22 | Runner Evidence with `capabilityUsed` not in registry fails | Yes |
| S2-23 | Evidence chain with first item having non-null `prevEvidenceHash` fails | Yes |
| S2-24 | Evidence chain with non-monotonic timestamps fails | Yes |
| S2-25 | Runner Identity hash excludes `attestationTimestamp` | Yes |
| S2-26 | Attestation with `createdAt` < last evidence timestamp fails | Yes |
| S2-27 | Attestation with capability snapshot != plan capabilities fails | Yes |
| S2-28 | Approval Policy with `requireDistinctApprovers: false` fails | Yes |
| S2-29 | Approval Policy with `allowedAlgorithms` containing non-RSA-SHA256 fails | Yes |
| S2-30 | Approval Policy with `m > n` in quorum fails | Yes |
| S2-31 | Approval rule requiring role with no active approver fails | Yes |
| S2-32 | Approval Bundle with duplicate nonce fails replay detection | Yes |
| S2-33 | Reviewer Report with `passed: false` and empty `violations` fails | Yes |
| S2-34 | Reviewer Report with `passed: true` and non-empty `violations` fails | Yes |
| S2-35 | Repo Snapshot with path containing `..` fails path safety | Yes |
| S2-36 | Repo Snapshot with absolute path fails path safety | Yes |
| S2-37 | SCP `packageHash` mismatch against computed hash fails | Yes |
| S2-38 | Unknown fields in any artifact are preserved (not rejected) | Yes |
| S2-39 | Execution Plan containing backtick character fails lint | Yes |
| S2-40 | Execution Plan containing `;` fails lint | Yes |
| S2-41 | Execution Plan containing `&&` fails lint | Yes |
| S2-42 | Execution Plan containing `\|\|` fails lint | Yes |
| S2-43 | Execution Plan containing pipe `\|` fails lint | Yes |
| S2-44 | Execution Plan containing `chmod` fails lint | Yes |
| S2-45 | Execution Plan containing `chown` fails lint | Yes |
| S2-46 | Execution Plan containing `npm` fails lint | Yes |
| S2-47 | Execution Plan containing `pnpm` fails lint | Yes |
| S2-48 | Execution Plan containing `yarn` fails lint | Yes |
| S2-49 | Execution Plan containing `node` fails lint | Yes |
| S2-50 | Execution Plan containing `powershell` fails lint | Yes |
| S2-51 | Execution Plan containing `cmd.exe` fails lint | Yes |
| S2-52 | Execution Plan containing `zsh` fails lint | Yes |
| S2-53 | Execution Plan containing `bash` fails lint | Yes |
| S2-54 | Execution Plan containing `POST` (case-sensitive) fails lint | Yes |
| S2-55 | Execution Plan containing `PUT` (case-sensitive) fails lint | Yes |
| S2-56 | Execution Plan containing `PATCH` (case-sensitive) fails lint | Yes |
| S2-57 | Execution Plan containing `DELETE` (case-sensitive) fails lint | Yes |
| S2-58 | Execution Plan containing whole-word `rm` fails lint | Yes |
| S2-59 | Execution Plan containing whole-word `mv` fails lint | Yes |
| S2-60 | Execution Plan containing whole-word `cp` fails lint | Yes |
| S2-61 | Execution Plan containing whole-word `sh` fails lint | Yes |
| S2-62 | Execution Plan containing whole-word `go` fails lint | Yes |
| S2-63 | Execution Plan lint for forbidden substrings is case-insensitive (except HTTP methods) | Yes |
| S2-64 | Execution Plan containing `post` (lowercase) does NOT fail lint (HTTP methods are case-sensitive) | Yes |
| S2-65 | Step Packet containing forbidden field name `"cmd":` fails | Yes |
| S2-66 | Step Packet containing forbidden field name `"command":` fails | Yes |
| S2-67 | Step Packet containing forbidden field name `"shell":` fails | Yes |
| S2-68 | Step Packet containing forbidden field name `"curl":` fails | Yes |
| S2-69 | Step Packet containing forbidden field name `"http":` fails | Yes |
| S2-70 | Step Packet containing forbidden field name `"https":` fails | Yes |
| S2-71 | Step Packet containing forbidden field name `"spawn":` fails | Yes |
| S2-72 | Step Packet containing forbidden field name `"write":` fails | Yes |
| S2-73 | Step Packet containing forbidden field name `"delete":` fails | Yes |
| S2-74 | Step Packet text containing `curl` fails lint | Yes |
| S2-75 | Step Packet text containing `wget` fails lint | Yes |
| S2-76 | Step Packet text containing `http://` fails lint | Yes |
| S2-77 | Step Packet text containing `https://` fails lint | Yes |
| S2-78 | Step Packet text containing `fetch(` fails lint | Yes |
| S2-79 | Step Packet text containing `axios` fails lint | Yes |
| S2-80 | Step Packet text containing `writeFile` fails lint | Yes |
| S2-81 | Step Packet text containing `unlink` fails lint | Yes |
| S2-82 | Step Packet text containing `rmdir` fails lint | Yes |
| S2-83 | Step Packet text containing `mkdir` fails lint | Yes |
| S2-84 | Step Packet text containing `child_process` fails lint | Yes |
| S2-85 | Step Packet text containing `spawn(` fails lint | Yes |
| S2-86 | Step Packet text containing `exec(` fails lint | Yes |
| S2-87 | Step Packet text containing `execFile(` fails lint | Yes |
| S2-88 | Step Packet text containing `fork(` fails lint | Yes |
| S2-89 | Approval Policy with duplicate `approverId` entries fails | Yes |
| S2-90 | Approval Policy with quorum `m = 0` fails | Yes |
| S2-91 | Approval Policy with quorum `n = 0` fails | Yes |
| S2-92 | Approval Policy with `n` exceeding total active approvers for required roles fails | Yes |
| S2-93 | Step Packet with `reviewerSequence` containing fewer than 2 distinct roles fails | Yes |

## Section 2A — Session Anchor

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S2A-01 | Session Anchor with `planHash` mismatch against computed Execution Plan hash fails | Yes |
| S2A-02 | Session Anchor with `finalEvidenceHash` mismatch against last evidence item hash fails | Yes |
| S2A-03 | Session Anchor with optional field present but referenced artifact missing fails | Yes |
| S2A-04 | Session Anchor with `finalAttestationHash` mismatch against computed attestation hash fails | Yes |
| S2A-05 | Session Anchor with `runnerIdentityHash` mismatch against computed Runner Identity hash fails | Yes |
| S2A-06 | Session Anchor with `policySetHash` mismatch against computed Policy Set hash fails | Yes |

## Section 3 — Cryptographic Primitives

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S3-01 | Canonical JSON sorts object keys lexicographically at all nesting levels | Yes |
| S3-02 | Canonical JSON omits undefined values | Yes |
| S3-03 | Canonical JSON preserves null values as `null` | Yes |
| S3-04 | Canonical JSON serializes datetime as ISO 8601 UTC with Z suffix | Yes |
| S3-05 | Canonical JSON preserves array order for non-canonically-sorted arrays | Yes |
| S3-06 | SHA-256 hash is 64-character lowercase hexadecimal | Yes |
| S3-07 | Decision Lock hash excludes `approvalMetadata` | Yes |
| S3-08 | Decision Lock hash sorts `nonGoals`, `invariants`, `constraints` | Yes |
| S3-09 | Execution Plan hash excludes `planHash` field | Yes |
| S3-10 | Execution Plan hash sorts steps by `stepId` | Yes |
| S3-11 | Prompt Capsule hash excludes entire `hash` sub-object | Yes |
| S3-12 | Repo Snapshot hash excludes `snapshotHash` | Yes |
| S3-13 | Repo Snapshot hash sorts `includedFiles` by path | Yes |
| S3-14 | Step Packet hash excludes `packetHash` | Yes |
| S3-15 | Step Packet hash sorts `dodItemRefs`, `allowedFiles`, `allowedSymbols` | Yes |
| S3-16 | Step Packet hash preserves `reviewerSequence` order (not sorted) | Yes |
| S3-17 | Evidence hash excludes `evidenceHash` field | Yes |
| S3-18 | Evidence hash includes `planHash` and `prevEvidenceHash` when present | Yes |
| S3-19 | Runner Identity hash excludes `attestationTimestamp` | Yes |
| S3-20 | Runner Identity hash sorts `allowedCapabilitiesSnapshot` | Yes |
| S3-21 | Attestation payload hash excludes `signature` | Yes |
| S3-22 | Approval signature payload hash excludes `signature` and `payloadHash` | Yes |
| S3-23 | Approval Bundle hash sorts signatures by `signatureId` | Yes |
| S3-24 | SCP hash excludes `packageHash` | Yes |
| S3-25 | SCP hash sorts all hash arrays lexicographically | Yes |
| S3-26 | SCP hash includes optional fields only when present | Yes |
| S3-27 | RSA-SHA256 signature verification accepts valid signature | Yes |
| S3-28 | RSA-SHA256 signature verification rejects tampered payload | Yes |
| S3-29 | PEM public key format accepted | Yes |
| S3-30 | Hex public key format accepted and converted | Yes |
| S3-31 | Identical canonical JSON input produces identical hash across implementations | Yes |
| S3-32 | Datetime with `.000Z` and without fractional seconds produce identical canonical form | Yes |
| S3-33 | NaN value in artifact rejected during canonical JSON normalization | Yes |
| S3-34 | Infinity value in artifact rejected during canonical JSON normalization | Yes |
| S3-35 | Unicode key sorting uses code point order (non-ASCII keys sorted correctly) | Yes |
| S3-36 | Nested undefined values in nested objects are omitted from canonical JSON | Yes |
| S3-37 | Decision Lock with unsorted `nonGoals` produces correct hash (implementation sorts before hashing) | Yes |
| S3-38 | Execution Plan with steps out of `stepId` order produces correct hash (implementation sorts before hashing) | Yes |
| S3-39 | Repo Snapshot with files out of `path` order produces correct hash (implementation sorts before hashing) | Yes |
| S3-40 | SCP with hash arrays in non-lexicographic order produces correct hash (implementation sorts before hashing) | Yes |
| S3-41 | Step Packet `reviewerSequence` order IS preserved (not sorted) in hash computation | Yes |
| S3-42 | RSA key shorter than 2048 bits rejected during signature verification | Yes |

## Section 4 — Artifact Binding Graph

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S4-01 | Decision Lock `dodId` matches DoD `dodId` | Yes |
| S4-02 | Prompt Capsule `planHash` matches computed Execution Plan hash | Yes |
| S4-03 | Step Packet `planHash` matches computed Execution Plan hash | Yes |
| S4-04 | Step Packet `capsuleHash` matches computed Prompt Capsule hash | Yes |
| S4-05 | Step Packet `snapshotHash` matches computed Repo Snapshot hash | Yes |
| S4-06 | Evidence `planHash` matches computed Execution Plan hash | Yes |
| S4-07 | Evidence chain linkage: each `prevEvidenceHash` matches preceding `evidenceHash` | Yes |
| S4-08 | Attestation `identityHash` matches computed Runner Identity hash | Yes |
| S4-09 | Attestation `planHash` matches computed Execution Plan hash | Yes |
| S4-10 | Attestation `evidenceChainTailHash` matches last evidence hash | Yes |
| S4-11 | SCP `decisionLockHash` matches computed Decision Lock hash | Yes |
| S4-12 | SCP `planHash` matches computed Execution Plan hash | Yes |
| S4-13 | SCP `capsuleHash` matches computed Prompt Capsule hash | Yes |
| S4-14 | SCP `snapshotHash` matches computed Repo Snapshot hash | Yes |
| S4-15 | All artifacts with `sessionId` have matching session ID | Yes |
| S4-16 | Artifact from session A rejected in session B validation | Yes |
| S4-17 | Duplicate attestation nonce rejected | Yes |
| S4-18 | Duplicate approval signature nonce rejected | Yes |
| S4-19 | Optional SCP hash field present but artifact missing fails with `SEAL_MISSING_DEPENDENCY` | Yes |
| S4-20 | Optional SCP hash field present with wrong hash fails with `SEAL_HASH_MISMATCH` | Yes |
| S4-21 | Artifact binding graph cycle detected and rejected | Yes |

## Section 5 — Validation Order

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S5-01 | All 12 validation steps execute even when earlier steps fail | Yes |
| S5-02 | Final verdict is conjunction of all step results | Yes |
| S5-03 | Schema validation runs before gate evaluation | Yes |
| S5-04 | Gate evaluation rejects missing DoD | Yes |
| S5-05 | Gate evaluation rejects unapproved Decision Lock | Yes |
| S5-06 | Gate failure blocks all downstream processing (invariant INV-6) | Yes |
| S5-07 | Execution Plan lint rejects forbidden substrings | Yes |
| S5-08 | Snapshot validation rejects hash mismatch | Yes |
| S5-09 | Patch applicability proof rejects `baseSnapshotHash` mismatch | Yes |
| S5-10 | Symbol validation rejects undefined symbol references | Yes |
| S5-11 | Capability validation rejects capabilities not in registry | Yes |
| S5-12 | Capability validation rejects capability not in plan's allowed set | Yes |
| S5-13 | Policy enforcement: deny rule with passing condition causes failure | Yes |
| S5-14 | Policy enforcement: require rule with failing condition causes failure | Yes |
| S5-15 | Policy enforcement: evaluation error causes rule failure (fail-closed) | Yes |
| S5-16 | Approval quorum enforcement: insufficient approvers rejected | Yes |
| S5-17 | Evidence chain validation rejects broken linkage | Yes |
| S5-18 | Attestation verification rejects invalid signature | Yes |
| S5-19 | Seal validation rejects `packageHash` mismatch | Yes |
| S5-20 | Seal validation rejects missing required artifact | Yes |
| S5-21 | Gate evaluation rejects Decision Lock with `status: "draft"` | Yes |
| S5-22 | Gate evaluation rejects Decision Lock with `status: "rejected"` | Yes |
| S5-23 | Gate evaluation rejects Decision Lock with invalid `status` value | Yes |
| S5-24 | Patch Apply Report `reportHash` mismatch fails | Yes |
| S5-25 | Patch touching file path containing `..` fails path safety | Yes |
| S5-26 | Patch touching file outside `allowedFiles` fails | Yes |
| S5-27 | Symbol validation: Model Response importing symbol outside `allowedSymbols` fails | Yes |
| S5-28 | Symbol validation: Model Response referencing file outside `allowedFiles` fails | Yes |

## Section 6 — Failure Semantics

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S6-01 | Missing artifact causes failure, not skip | Yes |
| S6-02 | Computation error causes failure, not inconclusive | Yes |
| S6-03 | Absence of denial does not constitute approval | Yes |
| S6-04 | Every failure produces structured error with `code`, `message`, `artifactType` | Yes |
| S6-05 | All errors collected; no short-circuit termination | Yes |
| S6-06 | Every defined error code is emitted in the appropriate failure scenario | Yes |
| S6-07 | Error output sorted by step/artifact/code/field as specified in Section 6.5 | Yes |
| S6-08 | `INTERNAL_VALIDATOR_ERROR` used for unregistered error types | Yes |
| S6-09 | `POLICY_REGEX_TIMEOUT` emitted when regex evaluation exceeds 100 ms timeout | Yes |

## Section 7 — Non-Execution Guarantee

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S7-01 | Validator does not execute shell commands during validation | Yes |
| S7-02 | Validator does not spawn processes during validation | Yes |
| S7-03 | Validator does not make network calls during validation | Yes |
| S7-04 | Validator does not mutate filesystem outside persistence layer | Yes |
| S7-05 | `verificationCommand` in DoD item is treated as string data, not executed | Yes |
| S7-06 | `systemPrompt` in Prompt Capsule is validated against lint, not sent to model | Yes |

## Section 8 — Versioning

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S8-01 | Artifact with wrong `schemaVersion` rejected | Yes |
| S8-02 | Unknown fields preserved across parse/serialize roundtrip | Yes |
| S8-03 | Unknown fields do not participate in hash computation | Yes |
| S8-04 | Duplicate migration registration rejected | Optional |

## Section 9 — Conformance Requirements

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S9-01 | Protocol Conformant: identical input produces identical hash output | Yes |
| S9-02 | Validator Conformant: all 12 validation steps implemented | Yes |
| S9-03 | Validator Conformant: fail-closed semantics enforced | Yes |
| S9-04 | Runner Conformant: produces valid evidence chain linkage | Yes |
| S9-05 | Runner Conformant: produces valid attestation signature | Yes |

## Section 10 — Security Model

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S10-01 | Tampered artifact content detected via hash mismatch | Yes |
| S10-02 | Tampered self-referential hash detected | Yes |
| S10-03 | Replayed attestation nonce detected and rejected | Yes |
| S10-04 | Replayed approval nonce detected and rejected | Yes |
| S10-05 | Cross-session artifact substitution detected via session ID mismatch | Yes |
| S10-06 | Substituted Execution Plan detected via multi-point plan hash binding | Yes |
| S10-07 | Substituted Runner Identity detected via attestation signature failure | Yes |
| S10-08 | Non-deterministic model params (temperature != 0) rejected at capsule level | Yes |
| S10-09 | Sensitive key patterns redacted in persisted artifacts | Yes |
| S10-10 | Sensitive value prefixes redacted in persisted artifacts | Yes |
| S10-11 | Plan substitution detected via multi-point hash binding (plan hash bound in capsule, step packets, attestation, evidence, anchor, SCP) | Yes |
| S10-12 | Model Response with `model.provider` different from Prompt Capsule `model.provider` detected via hash mismatch | Yes |
| S10-13 | Model Response with `model.modelId` different from Prompt Capsule `model.modelId` detected via hash mismatch | Yes |
| S10-14 | Model Response with `model.seed` different from Prompt Capsule `model.seed` detected via hash mismatch | Yes |
| S10-15 | Evidence with `capabilityUsed` differing only in case from registry entry fails (exact match required) | Yes |
| S10-16 | Evidence with capability requiring human confirmation but empty `humanConfirmationProof` fails | Yes |
| S10-17 | Sensitive key patterns matched case-insensitively during redaction | Yes |
| S10-18 | Sensitive key patterns in nested objects redacted recursively | Yes |
| S10-19 | Approval Bundle with same `approverId` signing same `artifactType` twice fails (`requireDistinctApprovers` enforcement) | Yes |

## Section 10A — Adversarial Timestamp Edge Cases

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S10A-01 | Evidence chain with equal consecutive timestamps passes (monotonically non-decreasing) | Yes |
| S10A-02 | Attestation with `createdAt` strictly less than last evidence `timestamp` fails | Yes |

## Section 11 — Extension Mechanism

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S11-01 | Extension artifact hash included in SCP `extensions` map | Optional |
| S11-02 | Extensions sorted by `extensionId` for SCP hash determinism | Optional |
| S11-03 | Extension does not alter core artifact hash computations | Yes |
| S11-04 | Unrecognized extension preserved (not rejected) | Yes |
| S11-05 | Unrecognized extension does not cause validation failure | Yes |
| S11-06 | Extension ID not matching reverse domain notation regex rejected | Yes |

## Section 12 — Formal Invariants

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S12-01 | INV-1: Hash binding verified for all artifacts | Yes |
| S12-02 | INV-2: Evidence chain integrity verified | Yes |
| S12-03 | INV-3: Attestation binds plan + identity + evidence tail | Yes |
| S12-04 | INV-4: SCP binds all required artifacts | Yes |
| S12-05 | INV-5: Identical input produces identical verdict | Yes |
| S12-06 | INV-6: Failed gate blocks all execution | Yes |
| S12-07 | INV-7: Session isolation enforced | Yes |
| S12-08 | INV-8: Capability registry is closed | Yes |
| S12-09 | INV-9: Distinct approvers required | Yes |
| S12-10 | INV-10: Timestamp monotonicity enforced | Yes |
| S12-11 | INV-11: Non-execution guarantee holds | Yes |
| S12-12 | INV-12: Fail-closed in all ambiguous states | Yes |

## Section 13 — Policy Operator Tests

| ID | Assertion | Mandatory |
|----|-----------|-----------|
| S13-01 | Policy with invalid operator fails with `POLICY_OPERATOR_UNSUPPORTED` | Yes |
| S13-02 | Policy condition evaluation error causes rule to fail (fail-closed) | Yes |

---

**Total assertions:** 258
**Mandatory:** 255
**Optional:** 3

*End of Conformance Test Matrix*
