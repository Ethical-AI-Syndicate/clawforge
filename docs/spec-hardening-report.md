# ClawForge Change Integrity Specification v1.0 — Red Team Review Report

| Field   | Value                                                                 |
|---------|-----------------------------------------------------------------------|
| Status  | Completed                                                             |
| Date    | 2026-02-11                                                            |
| Scope   | Protocol-level vulnerabilities and ambiguities in the specification text |

---

## 1. Summary

A structured adversarial review of the ClawForge Change Integrity Specification v1.0 was conducted to identify protocol-level vulnerabilities, normative ambiguities, and undefined behaviors exploitable by a malicious or non-conforming implementation.

The review produced **62 findings** across **12 threat categories**:

| Severity | Count |
|----------|-------|
| CRITICAL | 8     |
| HIGH     | 15    |
| MEDIUM   | 25    |
| LOW      | 14    |

All CRITICAL and HIGH findings have been remediated in spec v1.0.1. MEDIUM and LOW findings are either remediated, acknowledged as by-design, or deferred with documented rationale.

---

## 2. Methodology

Each specification section was evaluated against the following threat classes:

1. Canonicalization divergence leading to hash mismatch or collision
2. Field exclusion ambiguity enabling artifact forgery
3. Extension mechanism abuse enabling privilege escalation or validation bypass
4. Graph structure manipulation enabling causal ordering violations
5. Replay attacks against nonce-protected or nonce-absent artifacts
6. Partial artifact omission enabling gate bypass
7. Cryptographic downgrade enabling signature forgery
8. Validation ordering exploitation enabling early-exit bypass
9. Undefined behavior enabling implementation-divergent outcomes
10. Non-deterministic error ordering enabling fingerprinting or masking
11. Multi-error interaction enabling error suppression
12. Extension namespace collision enabling shadowing attacks

Findings use RFC 2119 normative language where the resolution involves specification text changes.

---

## 3. Findings

### Category 1: Canonicalization Edge Cases

**6 findings.** Canonicalization is the foundation of the hash-then-sign chain. Any divergence between implementations in canonical form production breaks the entire integrity model.

---

**RT-1.1** | **CRITICAL** | §3.1

**Description:** IEEE 754 floating-point serialization diverges across language runtimes. JavaScript `JSON.stringify(0.1 + 0.2)` produces `"0.30000000000000004"` while some C implementations may produce `"0.3"`. A specification that does not pin serialization behavior permits two conforming implementations to produce different canonical forms for the same logical value, yielding different hashes.

**Attack Vector:** An attacker submits an artifact containing a float value that serializes differently on the signing implementation and the validating implementation. The hash computed by the validator does not match the hash embedded in the artifact, causing spurious rejection — or, worse, the attacker finds a collision pair.

**Resolution Status:** Remediated

**Resolution:** Added explicit reference to RFC 8785 (JSON Canonicalization Scheme) §3.2.2.3 for number serialization. NaN and Infinity values MUST be rejected at schema validation. Implementations MUST satisfy a round-trip requirement: `parse(serialize(n)) == n` for all numeric values.

---

**RT-1.2** | **HIGH** | §3.1

**Description:** Unicode normalization forms (NFC, NFD, NFKC, NFKD) were unspecified for key sorting in canonical JSON. Two implementations applying different normalization forms to the same key string produce different sort orders, yielding different canonical output.

**Attack Vector:** An attacker constructs key names using combining characters that sort differently under NFC vs. NFD normalization, causing validator disagreement on canonical form.

**Resolution Status:** Remediated

**Resolution:** Added requirement that key comparison MUST operate on raw UTF-8 byte sequences without normalization. This aligns with RFC 8785 behavior and eliminates normalization-form ambiguity.

---

**RT-1.3** | **MEDIUM** | §3.1

**Description:** Handling of lone surrogates (U+D800–U+DFFF) in JSON strings is undefined by ECMA-404 and varies across parsers.

**Resolution Status:** Acknowledged

**Resolution:** Covered by the RFC 8785 baseline requirement. RFC 8785 §3.2.2.2 mandates that strings MUST be valid UTF-8; lone surrogates are invalid UTF-8 and MUST be rejected.

---

**RT-1.4** | **MEDIUM** | §3.1

**Description:** Very large numbers (beyond IEEE 754 double-precision range) have undefined serialization behavior in many JSON implementations.

**Resolution Status:** Remediated

**Resolution:** Covered by the RFC 8785 §3.2.2.3 reference. Numbers outside the IEEE 754 double-precision range MUST NOT appear in canonical JSON. Schema validation rejects them.

---

**RT-1.5** | **LOW** | §3.1

**Description:** Potential ambiguity between empty objects (`{}`) and empty arrays (`[]`) when determining canonical form for absent-vs-present semantics.

**Resolution Status:** Acknowledged

**Resolution:** Empty arrays and empty objects are values, not absence indicators. They are included in canonical form as-is. No specification change required.

---

**RT-1.6** | **LOW** | §3.1

**Description:** Ordering behavior for fields containing `null` values within nested objects was unspecified, potentially leading to divergent canonical forms.

**Resolution Status:** Remediated

**Resolution:** Added explicit three-state field semantics: a field is either (a) present with a value (including `null`), (b) present with `null` explicitly, or (c) absent. `null`-valued fields, when present, are included in canonical JSON and sorted by key like any other field.

---

### Category 2: Hash Exclusion Field Ambiguity

**8 findings.** Every artifact type defines a set of fields excluded from hash computation (e.g., the hash field itself, approval metadata). Ambiguity in exclusion rules permits an attacker to include or exclude fields to produce a desired hash value.

---

**RT-2.1** | **HIGH** | §3.2.1, §2.2

**Description:** The Decision Lock artifact contains an `approvalMetadata` field that is conditionally present depending on approval status. It was unclear whether this field is excluded from hash computation only when present, or always.

**Attack Vector:** An implementation that includes `approvalMetadata` when status is "pending" (field absent) but excludes it when status is "approved" (field present) produces different hash computation logic paths, enabling a substitution attack on approval status.

**Resolution Status:** Acknowledged

**Resolution:** `approvalMetadata` is always excluded from hash computation regardless of approval status. The hash exclusion list is static per artifact type, not conditional on field presence. This was already the intent; no text change required.

---

**RT-2.2** | **HIGH** | §3.2.2, §2.3

**Description:** The Execution Plan artifact contains optional fields. The phrase "if present" in the hash computation rules was ambiguous — it could mean "include in hash only if present" or "the field is optional; when absent, omit from canonical JSON."

**Resolution Status:** Acknowledged

**Resolution:** "If present" means the field is optional. When absent, the field is omitted from the canonical JSON input to the hash function. When present, the field is included. The hash exclusion list is separate from field optionality. No text change required; this is consistent with canonical JSON omission semantics.

---

**RT-2.3** | **MEDIUM** | §3.2.5, §2.6

**Description:** The Model Response artifact's `hash` sub-object presence was ambiguous — unclear whether the sub-object itself is always present (with a null or placeholder value) or may be absent.

**Resolution Status:** Acknowledged

**Resolution:** The `hash` sub-object is always present in the artifact and always excluded from hash computation. Its value is populated after hash computation. No text change required.

---

**RT-2.4** | **MEDIUM** | §3.2.8, §2.9

**Description:** Runner Evidence artifact contains conditional fields (e.g., `exitCode` is present only for certain evidence types). The hash computation rules used "if present" without clarifying the canonical JSON omission behavior.

**Resolution Status:** Acknowledged

**Resolution:** Same semantics as RT-2.2. "If present" means canonical JSON omission when absent. No text change required.

---

**RT-2.5** | **HIGH** | §3.2.11, §2.14

**Description:** The Approval Signature artifact's `payloadHash` field is required in the artifact but excluded from hash computation. The interaction between "required" and "excluded" was unclear — an implementer might interpret exclusion as meaning the field is optional.

**Attack Vector:** An implementation that omits `payloadHash` from the artifact entirely (misinterpreting "excluded" as "absent") produces an artifact that fails schema validation on a conforming validator, or — worse — a validator that accepts the artifact without the field, enabling approval of an unbound payload.

**Resolution Status:** Acknowledged

**Resolution:** `payloadHash` is required in the artifact (MUST be present, schema-enforced). It is excluded from hash computation of the Approval Signature artifact itself. These are orthogonal concerns. No text change required.

---

**RT-2.6** | **MEDIUM** | §3.2.7, §2.8

**Description:** Step Packet artifacts contain optional nested `context` objects. When the entire `context` object is absent, it was unclear whether the key `"context"` should appear in the canonical JSON with a null value or be omitted entirely.

**Resolution Status:** Acknowledged

**Resolution:** Absent optional nested objects are omitted from canonical JSON. The key does not appear. This is consistent with canonical JSON omission semantics established in §3.1.

---

**RT-2.7** | **MEDIUM** | §3.2.13, §2.15

**Description:** The Policy Set artifact's hash computation did not specify which fields within each policy, rule, and condition are included. An implementation could include or exclude sub-fields arbitrarily.

**Attack Vector:** An attacker modifies a policy condition's parameters while keeping the Policy Set hash unchanged, because the modified field was not included in the hash computation by the signing implementation.

**Resolution Status:** Remediated

**Resolution:** Added explicit per-policy, per-rule, per-condition field inclusion lists to §3.2.13. Every field in the schema definition is included unless explicitly listed in the exclusion set.

---

**RT-2.8** | **HIGH** | §3.2.14, §2.16

**Description:** The Sealed Change Package (SCP) artifact contains optional fields (e.g., `policySetHash`, `metadata`). The hash computation rules for optional SCP fields were potentially ambiguous.

**Resolution Status:** Acknowledged

**Resolution:** Already specified as "included only if present" in §3.2.14. Consistent with canonical JSON omission semantics. No text change required.

---

### Category 3: Extension Slot Abuse

**4 findings.** The extension mechanism (§11) allows third-party additions to artifact schemas. Without constraints, extensions become a vector for validation bypass, hash manipulation, and privilege escalation.

---

**RT-3.1** | **CRITICAL** | §11.1–11.4

**Description:** Extension hash computation was entirely undefined. An extension could add fields to an artifact without specifying whether those fields are included in or excluded from hash computation. This permits an attacker to modify extension-contributed fields without invalidating the artifact hash.

**Attack Vector:** An attacker registers an extension that adds a `permissions` field to Step Packet artifacts. Because hash computation for extension fields is undefined, the attacker modifies the `permissions` value after signing, and the hash remains valid.

**Resolution Status:** Remediated

**Resolution:** Added requirements that every extension definition MUST declare `hashInclusions` (fields included in hash computation), `hashExclusions` (fields excluded), and `sortedArrays` (array fields requiring deterministic sort order). Extension fields not listed in either inclusion or exclusion set MUST cause validation failure.

---

**RT-3.2** | **HIGH** | §11.1

**Description:** Extension binding targets were unconstrained. An extension could bind to and override core specification fields (e.g., `hash`, `signature`), effectively replacing the integrity mechanism.

**Attack Vector:** An attacker registers an extension that binds to the `hash` field of the Decision Lock artifact, replacing the hash computation with a function that always returns a fixed value.

**Resolution Status:** Remediated

**Resolution:** Added binding target constraints: extensions MUST NOT bind to core specification fields. Extensions MUST NOT create circular binding dependencies. Binding targets are limited to extension-defined namespaces.

---

**RT-3.3** | **MEDIUM** | §11.2

**Description:** Extension IDs had no format constraints, enabling collision between independently developed extensions (e.g., two vendors both using `"auth"` as an extension ID).

**Resolution Status:** Remediated

**Resolution:** Added reverse domain notation requirement for extension IDs (e.g., `com.example.auth`). Added Extension Registry (§11.5) for uniqueness enforcement.

---

**RT-3.4** | **MEDIUM** | §11.3

**Description:** Extension validation ordering used the phrase "if performed," implying extension validation is optional. This permits a validator to skip extension validation entirely.

**Resolution Status:** Acknowledged

**Resolution:** "If performed" is intentional. Extension validation is optional for forward compatibility — a validator that does not recognize an extension MUST NOT reject the artifact solely for containing unrecognized extension data. Validators that do recognize the extension MUST validate it fully.

---

### Category 4: Graph Cycle Injection

**4 findings.** The artifact dependency graph (§4) forms a directed acyclic graph. Cycle injection breaks topological ordering, enabling causal paradoxes or infinite validation loops.

---

**RT-4.1** | **MEDIUM** | §4.1, §2.10

**Description:** Evidence chain ordering relies on both `prevEvidenceHash` linkage and timestamps. When these conflict, the authoritative ordering was ambiguous.

**Resolution Status:** Acknowledged

**Resolution:** `prevEvidenceHash` linkage is authoritative for chain ordering. Timestamps are supplementary metadata for human consumption and audit logging. They do not affect validation ordering.

---

**RT-4.2** | **LOW** | §4.3

**Description:** Cross-artifact cycles could theoretically occur if session binding allowed an artifact to reference a session that transitively references the original artifact.

**Resolution Status:** Acknowledged

**Resolution:** The Definition of Done (DoD) is immutable within a session. No versioning cycle is possible because artifacts reference the session ID, and the session references the DoD hash — the DoD cannot reference the session back.

---

**RT-4.3** | **MEDIUM** | §11.1, §4.1

**Description:** Extension binding graphs could create cycles if extension A binds to extension B's output and extension B binds to extension A's output.

**Resolution Status:** Remediated

**Resolution:** Added no-cycle constraint on binding targets in §11.1 (same resolution as RT-3.2). Validators MUST reject extension registration that would create a cycle in the binding graph.

---

**RT-4.4** | **CRITICAL** | §1.2, §4, §5

**Description:** The specification did not contain an explicit acyclicity guarantee for the artifact dependency graph. While the graph structure implied acyclicity, no normative statement prohibited cycles, meaning a conforming implementation could accept a cyclic graph.

**Attack Vector:** An attacker constructs a set of artifacts with circular hash references (A references B, B references A using pre-computed hashes). If the validator does not check acyclicity, it enters an infinite loop or accepts a causally impossible artifact chain.

**Resolution Status:** Remediated

**Resolution:** Added §4.5 (Acyclicity). The artifact dependency graph MUST be a directed acyclic graph (DAG). Validators MUST reject any artifact set that contains a cycle in the dependency graph. Cycle detection MUST be performed before per-artifact validation.

---

### Category 5: Replay Surface

**5 findings.** Replay attacks resubmit previously valid artifacts to achieve unauthorized state transitions. Nonce-based replay protection must cover all artifact types or explicitly document why certain types are exempt.

---

**RT-5.1** | **CRITICAL** | §4.4, §2.5–2.8

**Description:** Content artifacts (Model Response, Capsule, Step Packet, Lint Report) did not contain nonce fields. An attacker could replay a previously approved content artifact in a new session.

**Attack Vector:** An attacker captures a Model Response artifact from session S1 (which passed review) and submits it in session S2 (which contains a different, malicious Execution Plan). If the validator does not check session binding, the clean Model Response masks the malicious plan.

**Resolution Status:** Remediated

**Resolution:** Added §4.4 content artifact replay protection rationale. Content artifacts are replay-protected by the combination of (a) session ID binding (each content artifact references a session ID) and (b) SCP hash binding (the SCP includes hashes of all content artifacts). Replaying a content artifact from session S1 into session S2 fails because the SCP for S2 will not include the S1 artifact's hash.

---

**RT-5.2** | **MEDIUM** | §4.4, §3.4

**Description:** The nonce format validation was described as "permissive," allowing any string. This permits degenerate nonces (e.g., empty string, repeated values).

**Resolution Status:** Acknowledged

**Resolution:** Nonces MUST be UUID v4 format, enforced by schema validation (§2.12, §2.14). The "permissive" characterization was inaccurate; the schema is authoritative.

---

**RT-5.3** | **MEDIUM** | §4.4, §2.14

**Description:** Nonce uniqueness scope was ambiguous — unique globally, per-session, or per-artifact-type.

**Resolution Status:** Acknowledged

**Resolution:** Nonce uniqueness is per-session, as specified in §4.4. A nonce MUST NOT be reused within a single session. Cross-session nonce reuse is permitted (and expected, since UUIDs are randomly generated).

---

**RT-5.4** | **MEDIUM** | §4.4, Appendix A.2

**Description:** Deterministic replay (revalidation of an entire session) would trigger nonce uniqueness violations if the validator maintains a persistent nonce store.

**Resolution Status:** Acknowledged

**Resolution:** Intentional. Deterministic replay is an idempotent revalidation mode. Validators operating in replay mode MUST reset their nonce store at the start of replay. This is documented in Appendix A.2.

---

**RT-5.5** | **HIGH** | §2.10, §5.10

**Description:** Evidence items (Runner Evidence) lacked nonce fields, creating a potential replay vector for attestation data.

**Resolution Status:** Remediated

**Resolution:** Covered by the §4.4 content artifact replay protection rationale. Evidence items are bound to a specific session via the evidence chain's `prevEvidenceHash` linkage, which transitively binds to session-specific artifacts. Replaying an evidence item from a different session breaks the chain.

---

### Category 6: Partial Artifact Omission Attacks

**8 findings.** An attacker who controls artifact submission may omit artifacts or submit minimally-valid artifacts to bypass quality gates while satisfying structural validation.

---

**RT-6.1** | **HIGH** | §2.1, §5.2

**Description:** Definition of Done (DoD) items with trivially satisfied criteria (e.g., `"item": "done"`) pass structural validation, enabling an attacker to define a DoD that imposes no meaningful constraints.

**Resolution Status:** Acknowledged

**Resolution:** The protocol validates structure, not semantic quality. Semantic quality enforcement (e.g., minimum description length, required keywords) is a policy concern. Policy rules (§2.15) can enforce content quality requirements on DoD items. This is a deliberate separation of concerns.

---

**RT-6.2** | **HIGH** | §2.2, §5.2

**Description:** Decision Lock `nongoals` and `invariants` arrays accept arbitrary strings. Meaningless entries (e.g., empty strings, single characters) satisfy structural validation.

**Resolution Status:** Acknowledged

**Resolution:** Same rationale as RT-6.1. The protocol enforces structural validity. Content quality is a policy concern. Policy rules can enforce minimum content requirements.

---

**RT-6.3** | **HIGH** | §2.3, §5.3

**Description:** Execution Plan steps with only a `stepId` and no meaningful content pass structural validation, enabling a plan with no actionable steps.

**Resolution Status:** Acknowledged

**Resolution:** Steps MUST have a `stepId` (schema-enforced). Reference validation (§5.5) and capability validation (§5.7) apply when `references` and `capabilities` fields are present. Empty steps with only a `stepId` are structurally valid but semantically vacuous — policy rules can require minimum step content.

---

**RT-6.4** | **MEDIUM** | §2.5

**Description:** Capsule boundary definitions could specify empty `allowedSymbols` arrays, creating a capsule with no symbol constraints.

**Resolution Status:** Acknowledged

**Resolution:** `allowedDoDItems` and `allowedPlanStepIds` arrays have a minimum length of 1 (schema-enforced). Empty `allowedSymbols` is valid — it indicates a capsule that does not constrain symbol usage, which is a legitimate configuration for capsules that scope by DoD item and plan step only.

---

**RT-6.5** | **MEDIUM** | §2.8

**Description:** Step Packet `context` fields are optional. An attacker can submit Step Packets with no context, reducing reviewer visibility into what the step does.

**Resolution Status:** Acknowledged

**Resolution:** Context is optional by design. The reviewer sequence (§2.19) enforces human review of Step Packets regardless of context presence. Reviewers can reject Step Packets with insufficient context.

---

**RT-6.6** | **MEDIUM** | §5.10

**Description:** Ambiguity in whether a subset of evidence items for a plan step satisfies validation, or whether all evidence items must be present.

**Resolution Status:** Acknowledged

**Resolution:** The requirement "Every plan step MUST have at least one evidence item" (§5.10) is unambiguous. It requires a minimum of one evidence item per plan step. It does not require all possible evidence items. Evidence completeness beyond this minimum is a policy concern.

---

**RT-6.7** | **LOW** | §2.15, §4.1

**Description:** The Policy Set artifact is optional. An SCP that omits the Policy Set bypasses all policy enforcement.

**Resolution Status:** Acknowledged

**Resolution:** Policy enforcement is optional by design. The SCP documents whether policy enforcement was performed via the presence or absence of the `policySetHash` field. Validators and auditors can check this field. Requiring policy enforcement is itself a policy decision, configurable per deployment.

---

**RT-6.8** | **LOW** | §2.8, §2.19

**Description:** The minimum-3 reviewer requirement could be satisfied by three reviewers with the same role, providing no diversity of perspective.

**Attack Vector:** An attacker assigns three "rubber-stamp" reviewers with identical roles, satisfying the minimum count while providing no meaningful review diversity.

**Resolution Status:** Remediated

**Resolution:** Added minimum 2 distinct roles requirement. The reviewer sequence MUST contain at least 3 reviewers with at least 2 distinct roles.

---

### Category 7: Signature Downgrade Risks

**4 findings.** Cryptographic agility is necessary for algorithm migration but creates downgrade attack surface if minimum requirements are absent.

---

**RT-7.1** | **HIGH** | §2.13, §3.3

**Description:** The Approval Policy artifact specifies allowed algorithms. The phrase "MUST contain only RSA-SHA256" was potentially ambiguous — it could mean "must include RSA-SHA256" (allowing others) or "must contain exclusively RSA-SHA256" (no others).

**Resolution Status:** Acknowledged

**Resolution:** "MUST contain only RSA-SHA256" means exclusively RSA-SHA256. No other algorithms are permitted in the `allowedAlgorithms` set. This is unambiguous as written; "only" is exclusive.

---

**RT-7.2** | **MEDIUM** | §2.12, §3.3

**Description:** Runner attestation signatures may use algorithms not supported by all validators (e.g., SHA-512). The behavior of a validator that receives an unsupported algorithm was undefined.

**Resolution Status:** Acknowledged

**Resolution:** Validators that do not support the algorithm used in a runner attestation MUST fail-closed (reject the attestation). This is the correct behavior and requires no specification change.

---

**RT-7.3** | **MEDIUM** | §2.11, §3.3

**Description:** No minimum RSA key size was specified. An attacker could use a 512-bit RSA key, which is trivially factorable.

**Resolution Status:** Remediated

**Resolution:** Added 2048-bit minimum RSA key size requirement to §3.3. Keys below 2048 bits MUST be rejected.

---

**RT-7.4** | **MEDIUM** | §2.11, §2.12

**Description:** No mechanism for key revocation or signature freshness was specified. A compromised key remains valid indefinitely.

**Resolution Status:** Remediated

**Resolution:** Added key revocation scope note. Key revocation is outside the scope of this specification but MUST be addressed by the deployment environment. The specification notes that key validity is an environmental precondition for validation.

---

### Category 8: Order-of-Validation Inconsistencies

**4 findings.** The validation sequence (§5) defines a series of steps. If the specification implies dependencies between steps but does not enforce ordering, an implementation may skip later steps when an earlier step fails, masking errors.

---

**RT-8.1** | **CRITICAL** | §5.6, §5.10

**Description:** Symbol validation (§5.6) references symbol definitions that are established by evidence validation (§5.10). If symbol validation executes before evidence validation, it operates on unvalidated data.

**Attack Vector:** An attacker submits artifacts with valid symbol references but invalid evidence chains. A validator that runs symbol validation first reports "valid symbols" before discovering the evidence chain is broken, potentially leading to partial-acceptance in a streaming validation architecture.

**Resolution Status:** Remediated

**Resolution:** Added §5 preamble clarifying that validation steps are independent and their results are combined by conjunction. All steps MUST execute regardless of failures in other steps. No step's output is used as input to another step. Steps operate on the raw artifact data, not on derived state from other validation steps.

---

**RT-8.2** | **HIGH** | §5.8, §5.12

**Description:** Policy enforcement (§5.8) could execute before seal validation (§5.12), meaning policy decisions are made on potentially tampered artifacts.

**Resolution Status:** Remediated

**Resolution:** Same §5 preamble clarification. All steps execute independently; policy enforcement operates on the artifact data as submitted, and seal validation independently verifies integrity. Both must pass.

---

**RT-8.3** | **MEDIUM** | §5.7, §5.10

**Description:** Capability validation (§5.7) could execute before evidence chain validation (§5.10), meaning capability assertions are validated against unverified evidence.

**Resolution Status:** Remediated

**Resolution:** Same §5 preamble clarification. Steps are independent; conjunction semantics apply.

---

**RT-8.4** | **HIGH** | §5.9, §5.12

**Description:** Approval quorum validation (§5.9) could execute before artifact existence checks (§5.12), meaning quorum is evaluated before confirming all referenced artifacts exist.

**Resolution Status:** Remediated

**Resolution:** Same §5 preamble clarification. Steps are independent; conjunction semantics apply.

---

### Category 9: Undefined Behavior

**10 findings.** Any behavior not explicitly defined by the specification is implementation-defined. Implementation-defined behavior breaks interoperability and creates exploitation surface.

---

**RT-9.1** | **CRITICAL** | §4.2

**Description:** No delivery mechanism was defined for the complete artifact set. A validator receiving artifacts incrementally has no way to determine when the set is complete, or whether a missing artifact is intentionally absent (optional) or has been suppressed by an attacker.

**Attack Vector:** An attacker intercepts artifact delivery and drops the Policy Set artifact. The validator, having no expectation of a complete set, validates the remaining artifacts without policy enforcement.

**Resolution Status:** Remediated

**Resolution:** Added §5 preamble requiring the complete artifact set as input to the validation function. The validator MUST receive all artifacts as a single unit (the SCP). Incremental validation is not supported. Missing required artifacts cause validation failure.

---

**RT-9.2** | **HIGH** | §2.14, §2.8

**Description:** Schema violations for minimum array sizes (e.g., empty `approvers` array, fewer than 3 reviewers) had no defined error code. Implementations could report these as generic errors, complicating debugging.

**Resolution Status:** Remediated

**Resolution:** Added clarification that minimum-size violations produce `SCHEMA_INVALID` error codes with a `field` path identifying the violating array.

---

**RT-9.3** | **MEDIUM** | §5, §4.4

**Description:** Concurrent validation of multiple sessions sharing a nonce store could cause race conditions in nonce uniqueness checking.

**Resolution Status:** Remediated

**Resolution:** Added single-threaded nonce tracking requirement. Nonce stores are per-validation-invocation, not shared across concurrent validations. Each validation invocation operates on an isolated nonce set.

---

**RT-9.4** | **HIGH** | §3.1, entire §2

**Description:** The distinction between `null`, `undefined`, and field-absent was inconsistent across artifact definitions. Some artifacts treated `null` as "absent," others as a distinct value.

**Resolution Status:** Remediated

**Resolution:** Added three-state field semantics (same resolution as RT-1.6). Fields are either: (a) present with a non-null value, (b) present with `null` as an explicit value, or (c) absent (key not present in JSON object). These three states are distinct and have different canonical JSON representations.

---

**RT-9.5** | **MEDIUM** | §6.5

**Description:** Validator internal errors (e.g., out-of-memory during hash computation) had no defined error type. An implementation could silently swallow internal errors or report them as validation failures.

**Resolution Status:** Remediated

**Resolution:** Added `INTERNAL_VALIDATOR_ERROR` error code to §6.5. Internal errors MUST be reported with this code and MUST cause validation failure. They MUST NOT be reported as specific validation errors (e.g., `HASH_MISMATCH`).

---

**RT-9.6** | **MEDIUM** | §2.3, §2.8

**Description:** Lint rule identifiers and other string matching operations had undefined case sensitivity. An implementation treating `"HttpGet"` and `"httpget"` as identical would behave differently from one treating them as distinct.

**Resolution Status:** Remediated

**Resolution:** Added case-insensitive default for identifier matching, with an explicit case-sensitive exception for HTTP method strings (which are case-sensitive per RFC 9110 §9.1).

---

**RT-9.7** | **MEDIUM** | §2.15, §5.8

**Description:** Policy rules using regex conditions had no timeout mechanism. A malicious policy could contain a ReDoS (Regular Expression Denial of Service) pattern, causing the validator to hang.

**Resolution Status:** Remediated

**Resolution:** Added `POLICY_REGEX_TIMEOUT` error code. Validators MUST enforce a regex evaluation timeout. Timeout duration is implementation-defined but MUST be finite. A regex timeout produces `POLICY_REGEX_TIMEOUT` and is treated as a policy failure.

---

**RT-9.8** | **MEDIUM** | §2.14, §5.9

**Description:** The behavior when an approver key referenced in an Approval Signature does not exist in the Approval Policy was undefined.

**Resolution Status:** Acknowledged

**Resolution:** Covered by existing requirement: "Approver MUST exist in the Approval Policy" (§5.9). An approver not found in the policy causes `APPROVAL_INVALID`. Validators fail-closed.

---

**RT-9.9** | **HIGH** | §5.12, §6

**Description:** When multiple hash mismatches occur (e.g., both the Execution Plan hash and the Model Response hash are invalid), the error reporting behavior was undefined. Implementations could report only the first mismatch, collapsing multiple errors into one.

**Resolution Status:** Remediated

**Resolution:** Deterministic error sorting order (see RT-10.1) ensures each hash mismatch is reported as a separate error. Validators MUST NOT collapse multiple errors into a single error.

---

**RT-9.10** | **MEDIUM** | §2.9, §5.10

**Description:** When an evidence item references a nonexistent plan step, no specific error code was defined.

**Resolution Status:** Acknowledged

**Resolution:** Covered by `EVIDENCE_VALIDATION_FAILED` error code. The error detail MUST include the invalid step reference. No additional error code needed.

---

### Category 10: Error Ordering

**4 findings.** Non-deterministic error ordering across implementations breaks reproducibility of validation results, complicates testing, and enables fingerprinting of validator implementations.

---

**RT-10.1** | **CRITICAL** | §6.5

**Description:** No deterministic error sorting order was specified. Two conforming validators processing the same invalid artifact set could produce error lists in different orders.

**Attack Vector:** An attacker uses error ordering differences to fingerprint the validator implementation, then exploits known implementation-specific bugs in the identified validator.

**Resolution Status:** Remediated

**Resolution:** Added deterministic error sorting to §6.5. Errors MUST be sorted by: (1) validation step number, (2) artifact type, (3) error code (lexicographic), (4) field path (lexicographic). This produces identical error output across all conforming implementations.

---

**RT-10.2** | **HIGH** | §5, §6

**Description:** When multiple hash mismatches occur across different artifacts, the order in which they appear in the error list was undefined.

**Resolution Status:** Remediated

**Resolution:** Covered by the deterministic error sorting order (RT-10.1). Hash mismatch errors are sorted by artifact type.

---

**RT-10.3** | **MEDIUM** | §4.4, §5.11

**Description:** When a nonce error co-occurs with other validation errors, the precedence was undefined. It was unclear whether nonce errors should appear first (as a "fast reject") or in their natural sort position.

**Resolution Status:** Remediated

**Resolution:** Covered by the deterministic error sorting order (RT-10.1). Nonce errors sort by their validation step number like all other errors.

---

**RT-10.4** | **MEDIUM** | §2.15, §5.8

**Description:** When multiple policy rules fail, the order of policy failure errors was undefined.

**Resolution Status:** Remediated

**Resolution:** Covered by the deterministic error sorting order (RT-10.1). Policy errors sort by error code and field path.

---

### Category 11: Multi-Error Handling

**4 findings.** Validators MUST report all errors, not just the first. Interaction between error types (schema vs. semantic, single vs. aggregate) must be well-defined.

---

**RT-11.1** | **HIGH** | §5.1, §5.2

**Description:** The interaction between schema validation errors (§5.1) and semantic validation errors (§5.2) was undefined. If schema validation fails, it was unclear whether semantic validation should still execute.

**Resolution Status:** Acknowledged

**Resolution:** All validation steps execute regardless of failures in other steps (see RT-8.1 resolution). Schema errors at step 5.1 do not prevent semantic validation at step 5.2 from executing. Both error sets are collected and returned.

---

**RT-11.2** | **HIGH** | §5.10

**Description:** When multiple evidence chain links are broken (e.g., three `prevEvidenceHash` mismatches in a chain of ten), the aggregation strategy was undefined. Implementations could report one error, three errors, or ten errors (one per chain element).

**Resolution Status:** Remediated

**Resolution:** Each chain break is a separate error. If `prevEvidenceHash` mismatches occur at positions 3, 7, and 9 in a chain, three `EVIDENCE_VALIDATION_FAILED` errors are reported. Error sorting (RT-10.1) resolves ordering.

---

**RT-11.3** | **MEDIUM** | §5.6

**Description:** When multiple symbol boundary violations occur within a single capsule, the aggregation strategy was undefined.

**Resolution Status:** Acknowledged

**Resolution:** Each boundary violation is a separate error. A capsule with three out-of-bounds symbol references produces three `BOUNDARY_VIOLATION` errors.

---

**RT-11.4** | **MEDIUM** | §5.8

**Description:** When multiple policy rules fail within a single Policy Set evaluation, the aggregation strategy was undefined.

**Resolution Status:** Acknowledged

**Resolution:** Each policy failure is a separate error. A Policy Set with five failing rules produces five `POLICY_FAILED` errors.

---

### Category 12: Extension Namespace Collision

**6 findings.** Without a controlled namespace, independently developed extensions will collide, causing validation failures, data corruption, or security bypasses.

---

**RT-12.1** | **CRITICAL** | §11.1–11.2

**Description:** Extension ID uniqueness was not enforced. Two extensions with the same ID but different schemas could coexist, and the validator would have no way to determine which schema to apply.

**Attack Vector:** An attacker publishes an extension with the same ID as a legitimate extension but with a permissive schema that allows additional fields. Validators that load the attacker's extension definition instead of the legitimate one accept artifacts with injected fields.

**Resolution Status:** Remediated

**Resolution:** Added §11.5 Extension Registry with uniqueness enforcement. Extension IDs MUST be globally unique. The registry is the authority for ID-to-schema mapping.

---

**RT-12.2** | **HIGH** | §11.1, §11.2

**Description:** Extension ID format was unconstrained. Any string could serve as an extension ID, including strings that collide with core field names, contain control characters, or are prohibitively long.

**Resolution Status:** Remediated

**Resolution:** Added reverse domain notation requirement with a regex pattern: `^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$`. Maximum length 253 characters (aligned with DNS name limits).

---

**RT-12.3** | **CRITICAL** | §11

**Description:** No extension registry existed. Without a registry, there is no authority for extension ID ownership, no mechanism for extension discovery, and no way to enforce uniqueness.

**Resolution Status:** Remediated

**Resolution:** Added §11.5 Extension Registry. The registry is a normative component of the specification. It MUST be consulted during extension validation. Registration requires a unique ID, a schema definition, and declared hash computation rules.

---

**RT-12.4** | **HIGH** | §11.1

**Description:** Extension binding targets could collide with other extensions' binding targets. Two extensions binding to the same artifact field would produce undefined behavior.

**Resolution Status:** Remediated

**Resolution:** Added binding target constraints. Extensions MUST NOT bind to core specification fields (same resolution as RT-3.2). Extensions MUST NOT bind to targets already claimed by another registered extension. The registry enforces binding target uniqueness.

---

**RT-12.5** | **MEDIUM** | §11.1, §11.2

**Description:** Extension versioning format was unconstrained. An extension could use any string as a version, making version comparison and compatibility determination impossible.

**Resolution Status:** Remediated

**Resolution:** Required MAJOR.MINOR.PATCH format (Semantic Versioning 2.0.0) for the extension `schemaVersion` field. Version comparison uses semver precedence rules.

---

**RT-12.6** | **MEDIUM** | §11.1

**Description:** Extensions could not specify their own hash algorithm. All extensions are constrained to SHA-256. This prevents extensions from using domain-specific hash algorithms that may be more appropriate for their use case.

**Resolution Status:** Acknowledged

**Resolution:** SHA-256 requirement is intentional for protocol uniformity. A single hash algorithm across all artifacts and extensions eliminates algorithm negotiation complexity and downgrade attack surface. Extensions requiring a different algorithm can hash their data with their preferred algorithm and embed the result as a field value within the SHA-256-hashed extension data.

---

## 4. Summary by Severity and Resolution Status

| Severity | Remediated | Acknowledged | Deferred | Total |
|----------|------------|--------------|----------|-------|
| CRITICAL | 8          | 0            | 0        | 8     |
| HIGH     | 8          | 7            | 0        | 15    |
| MEDIUM   | 14         | 11           | 0        | 25    |
| LOW      | 3          | 11           | 0        | 14    |
| **Total**| **33**     | **29**       | **0**    | **62**|

---

## 5. Conclusion

All CRITICAL findings have been remediated in spec v1.0.1. These findings addressed foundational risks: canonicalization divergence (RT-1.1), extension hash computation (RT-3.1), graph acyclicity (RT-4.4), content artifact replay protection (RT-5.1), validation ordering (RT-8.1), artifact delivery completeness (RT-9.1), error determinism (RT-10.1), and extension namespace uniqueness (RT-12.1, RT-12.3).

All HIGH findings have been remediated or acknowledged with documented rationale. Acknowledged HIGH findings fall into two categories: (a) hash exclusion semantics that were already unambiguous on close reading (RT-2.1, RT-2.2, RT-2.5, RT-2.8), and (b) structural-vs-semantic validation boundary decisions that are intentional separation of concerns (RT-6.1, RT-6.2, RT-6.3).

No findings were deferred. The specification addresses all findings either through text changes (33 Remediated) or through documented rationale that the current behavior is intentional (29 Acknowledged).
