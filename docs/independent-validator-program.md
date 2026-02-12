# ClawForge Independent Validator Program

| Field            | Value      |
|------------------|------------|
| **Status**       | Draft      |
| **Version**      | 1.0.0      |
| **Date**         | 2026-02-11 |

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

---

## 1. Purpose

The Independent Validator Program enables third parties to implement conformant ClawForge validators without access to the reference implementation. This document defines:

1. Minimum compliance requirements for independent validators
2. The conformance harness packaging and execution model
3. The canonical test vector suite (structure, categories, and coverage)
4. Reproducibility requirements for deterministic validation
5. Submission evaluation criteria and weighting
6. The call for independent implementations and ratification prerequisites
7. The adversarial review bounty for spec-level vulnerabilities

A conformant independent validator is any program that accepts a ClawForge artifact set, applies the full validation pipeline defined in the specification, and produces a structured verdict. The reference implementation is explicitly excluded from the set of independent implementations for ratification purposes.

---

## 2. Minimum Compliance Requirements

A conformant independent validator MUST:

1. **Accept a complete artifact set as input.** The input format MUST be one of:
   - A directory of JSON files conforming to the artifact schema hierarchy, OR
   - A single archive (`.tar.gz` or `.zip`) containing the same directory structure.

   The validator MUST reject any input that is neither a valid directory nor a recognized archive format, producing error code `INPUT_FORMAT_INVALID`.

2. **Produce a structured JSON verdict** with the following schema:

   ```json
   {
     "passed": boolean,
     "errors": [
       {
         "code": "string",
         "message": "string",
         "artifactType": "string",
         "field": "string"
       }
     ],
     "warnings": [
       {
         "code": "string",
         "message": "string"
       }
     ],
     "validatorId": "string",
     "protocolVersion": "1.0.0",
     "timestamp": "ISO 8601 UTC (e.g., 2026-02-11T14:30:00Z)"
   }
   ```

   - `passed` MUST be `true` if and only if `errors` is empty.
   - `validatorId` MUST be a stable identifier unique to the validator implementation (format: `<org>/<name>/<semver>`).
   - `protocolVersion` MUST match the specification version the validator targets.
   - `timestamp` MUST be the UTC wall-clock time at which validation completed, formatted as ISO 8601 with seconds precision and the `Z` suffix.

3. **Sort errors deterministically** per specification section 6.5: by validation step number (ascending numeric), then `artifactType` (lexicographic), then `code` (lexicographic), then `field` (lexicographic). All comparisons are case-sensitive, code-point-order.

4. **Pass 100% of mandatory conformance test assertions.** Any mandatory assertion failure disqualifies the implementation.

5. **Produce byte-identical hash values** for every entry in the reference hash corpus. Hash divergence on any single entry disqualifies the implementation.

6. **Complete validation of the standard-size test corpus in under 60 seconds** on commodity hardware (4-core CPU, 8 GB RAM, spinning disk or SSD). The harness measures wall-clock time from process start to verdict output on stdout.

7. **Operate without network access during validation.** The validator process MUST NOT open any network sockets, resolve DNS, or make HTTP requests. Validators SHOULD be testable inside a network-isolated container or namespace.

8. **Not execute any artifact content during validation.** Artifact payloads (patches, scripts, prompts) MUST be treated as opaque data. Code execution, `eval`, dynamic loading, or shell-out based on artifact content is forbidden.

---

## 3. Conformance Harness Packaging

The conformance suite is distributed as a self-contained directory with the following structure:

```
clawforge-conformance-suite/
├── README.md
├── vectors/
│   ├── canonical-json/
│   │   ├── 001-key-sorting.json
│   │   ├── 002-null-handling.json
│   │   ├── 003-datetime.json
│   │   ├── 004-nested-objects.json
│   │   ├── 005-empty-collections.json
│   │   ├── 006-unicode-keys.json
│   │   ├── 007-number-formatting.json
│   │   ├── 008-undefined-omission.json
│   │   ├── 009-mixed-types.json
│   │   └── 010-deep-nesting.json
│   ├── hash-computation/
│   │   ├── decision-lock.json
│   │   ├── execution-plan.json
│   │   ├── prompt-capsule.json
│   │   ├── repo-snapshot.json
│   │   ├── model-response.json
│   │   ├── symbol-index.json
│   │   ├── step-packet.json
│   │   ├── runner-evidence.json
│   │   ├── runner-identity.json
│   │   ├── attestation-payload.json
│   │   ├── approval-signature-payload.json
│   │   ├── approval-bundle.json
│   │   ├── policy-set.json
│   │   ├── sealed-change-package.json
│   │   ├── patch-apply-report.json
│   │   └── reviewer-report.json
│   ├── signature-verification/
│   │   ├── valid-rsa-sha256.json
│   │   ├── tampered-payload.json
│   │   ├── wrong-key.json
│   │   └── hex-key-format.json
│   ├── evidence-chain/
│   │   ├── valid-3-item-chain.json
│   │   ├── broken-link.json
│   │   ├── non-monotonic-timestamps.json
│   │   └── null-first-prev-hash.json
│   ├── sealed-packages/
│   │   ├── minimal-valid.json
│   │   ├── missing-required-artifact.json
│   │   ├── hash-mismatch.json
│   │   ├── session-id-mismatch.json
│   │   ├── optional-artifact-wrong-hash.json
│   │   └── extension-artifact.json
│   └── adversarial/
│       ├── plan-substitution.json
│       ├── nonce-replay.json
│       ├── cross-session-artifact.json
│       ├── capability-escalation.json
│       ├── vague-dod.json
│       └── forbidden-lint-token.json
├── assertions/
│   ├── section-02-schemas.json
│   ├── section-03-crypto.json
│   ├── section-04-bindings.json
│   ├── section-05-validation.json
│   ├── section-06-failures.json
│   ├── section-10-security.json
│   └── section-12-invariants.json
├── harness/
│   ├── runner.sh
│   └── report-schema.json
└── reference-hashes.json
```

### 3.1 Vector File Format

Every test vector file MUST contain a single JSON object with the following structure:

```json
{
  "vectorId": "string",
  "description": "string",
  "input": { },
  "expected": {
    "canonical_json": "string (present for canonical JSON vectors)",
    "hash": "sha256hex (present for hash computation vectors)",
    "verdict": "pass|fail (present for validation vectors)",
    "error_codes": ["array of expected error codes (present for fail vectors)"]
  }
}
```

- `vectorId` MUST be unique across the entire suite. Format: `<category>-<nnn>` (e.g., `canonical-json-001`, `hash-decision-lock`, `adversarial-nonce-replay`).
- `description` MUST be a single sentence stating what the vector tests.
- `input` contains the artifact data or artifact set to be validated. Its schema varies by category.
- `expected` contains the fields relevant to the vector category. Fields not applicable to a category MUST be omitted (not set to `null`).

### 3.2 Assertion File Format

Each assertion file in `assertions/` maps specification section requirements to test vectors:

```json
{
  "section": "string (e.g., '02')",
  "title": "string",
  "assertions": [
    {
      "assertionId": "string",
      "requirement": "string (normative text from spec)",
      "mandatory": true,
      "vectorIds": ["array of vectorId references"],
      "check": "description of what the harness verifies"
    }
  ]
}
```

Assertions with `"mandatory": true` MUST pass for conformance. Assertions with `"mandatory": false` are RECOMMENDED and contribute to the optional assertion pass rate (see section 6).

### 3.3 Harness Execution

The harness runner (`harness/runner.sh`) MUST:

1. Accept exactly one argument: the path to the validator binary or executable script.
2. Invoke the validator once per vector, passing the vector's `input` as a temporary directory or archive.
3. Capture the validator's stdout as the verdict JSON.
4. Compare the verdict against the vector's `expected` values.
5. Produce a report conforming to `harness/report-schema.json`.
6. Exit with code `0` if all mandatory assertions pass, `1` otherwise.

The validator binary MUST accept a single positional argument (path to artifact set) and write the verdict JSON to stdout. Exit code `0` indicates the validator ran successfully (regardless of whether the artifact set passed validation). Non-zero exit codes indicate validator-internal failure.

---

## 4. Canonical Test Vector Suite

The suite contains 46 vectors across 6 categories.

### 4.1 Canonical JSON Vectors (10 vectors)

These vectors test the canonicalization algorithm that all hash computations depend on. Each vector provides an `input` JSON object and the expected `canonical_json` byte string.

| Vector ID | Tests |
|-----------|-------|
| `canonical-json-001` | Lexicographic key sorting at the top level and nested levels |
| `canonical-json-002` | Null value preservation (null MUST appear in output, not be stripped) |
| `canonical-json-003` | ISO 8601 datetime string passthrough (no re-parsing or reformatting) |
| `canonical-json-004` | Nested object key sorting (recursive, depth-first) |
| `canonical-json-005` | Empty arrays `[]` and empty objects `{}` preserved as-is |
| `canonical-json-006` | Unicode keys sorted by code point, not locale-aware collation |
| `canonical-json-007` | Number formatting: no trailing zeros, no leading zeros, no positive sign, exponential notation threshold |
| `canonical-json-008` | Keys with `undefined` values MUST be omitted from canonical form |
| `canonical-json-009` | Mixed-type arrays maintain insertion order; objects within arrays are key-sorted |
| `canonical-json-010` | Deep nesting (20 levels) produces correct canonical output without stack overflow |

### 4.2 Per-Artifact Hash Vectors (16 vectors)

One vector per artifact type. Each provides a complete artifact `input` and the expected SHA-256 hex digest computed over the canonical JSON form.

Artifact types covered:
`decision-lock`, `execution-plan`, `prompt-capsule`, `repo-snapshot`, `model-response`, `symbol-index`, `step-packet`, `runner-evidence`, `runner-identity`, `attestation-payload`, `approval-signature-payload`, `approval-bundle`, `policy-set`, `sealed-change-package`, `patch-apply-report`, `reviewer-report`.

For each vector, the harness:
1. Canonicalizes the `input` using the canonical JSON algorithm.
2. Computes SHA-256 over the canonical UTF-8 byte string.
3. Compares the hex-encoded digest against `expected.hash`.

Any divergence indicates a canonicalization or hashing implementation error.

### 4.3 RSA-SHA256 Signature Vectors (4 vectors)

| Vector ID | Tests |
|-----------|-------|
| `sig-valid-rsa-sha256` | Valid signature over a known payload with a known public key; validator MUST accept |
| `sig-tampered-payload` | Payload modified after signing; validator MUST reject with `SIGNATURE_INVALID` |
| `sig-wrong-key` | Valid signature verified against incorrect public key; validator MUST reject with `SIGNATURE_KEY_MISMATCH` |
| `sig-hex-key-format` | Public key provided in hex-encoded DER format; validator MUST parse correctly |

All vectors include the RSA key pair (2048-bit), the payload, and the signature in hex encoding.

### 4.4 Evidence Chain Linkage Vectors (4 vectors)

| Vector ID | Tests |
|-----------|-------|
| `chain-valid-3-item` | Three runner-evidence entries with correct `prevHash` linkage; validator MUST accept |
| `chain-broken-link` | Second entry's `prevHash` does not match hash of first entry; validator MUST reject with `CHAIN_LINK_BROKEN` |
| `chain-non-monotonic-ts` | Timestamps decrease across chain entries; validator MUST reject with `CHAIN_TIMESTAMP_NON_MONOTONIC` |
| `chain-null-first-prev` | First entry has `prevHash: null`; validator MUST accept (this is the valid initial state) |

### 4.5 Sealed Change Package (SCP) Validation Vectors (6 vectors)

| Vector ID | Tests |
|-----------|-------|
| `scp-minimal-valid` | Minimal valid SCP with all required artifacts and correct hashes; validator MUST accept |
| `scp-missing-required` | SCP missing the `execution-plan` artifact; validator MUST reject with `SCP_MISSING_REQUIRED_ARTIFACT` |
| `scp-hash-mismatch` | SCP manifest hash for `model-response` does not match actual artifact hash; validator MUST reject with `SCP_HASH_MISMATCH` |
| `scp-session-id-mismatch` | Artifacts reference different `sessionId` values; validator MUST reject with `SCP_SESSION_ID_MISMATCH` |
| `scp-optional-wrong-hash` | Optional artifact present in manifest but with incorrect hash; validator MUST reject with `SCP_HASH_MISMATCH` (optional artifacts, if present, are hash-verified) |
| `scp-extension-artifact` | SCP contains an artifact type not defined in the specification; validator MUST accept if the extension artifact is listed in the manifest under `extensions` with a valid hash |

### 4.6 Adversarial Vectors (6 vectors)

These vectors test defense against attacks described in the specification's threat model.

| Vector ID | Tests |
|-----------|-------|
| `adv-plan-substitution` | Execution plan replaced after decision lock was signed; hash binding MUST catch the substitution (`BINDING_PLAN_HASH_MISMATCH`) |
| `adv-nonce-replay` | Two SCPs share an identical nonce; validator MUST reject the second with `NONCE_REUSE_DETECTED` (requires stateful nonce tracking or nonce-set input) |
| `adv-cross-session` | Artifact from session A included in session B's SCP; validator MUST reject with `SCP_SESSION_ID_MISMATCH` |
| `adv-capability-escalation` | Step packet requests file-system scope broader than the execution plan grants; validator MUST reject with `CAPABILITY_SCOPE_EXCEEDED` |
| `adv-vague-dod` | Decision lock contains a definition-of-done with no verifiable assertions; validator MUST emit warning `DOD_NOT_VERIFIABLE` (not an error unless policy mandates it) |
| `adv-forbidden-lint-token` | Model response contains a token on the forbidden-lint list; validator MUST reject with `FORBIDDEN_TOKEN_DETECTED` |

---

## 5. Reproducibility Requirements

### 5.1 Determinism

A conformant validator MUST be deterministic. Given identical input, the validator MUST produce:
- Identical `passed` value.
- Identical `errors` array (same length, same elements, same order per section 2 item 3).
- Identical `warnings` array (same elements; order SHOULD be stable but is not required to be identical).
- Identical hash values for all intermediate and final computations.

The only permitted variance between runs is the `timestamp` field.

### 5.2 Hash Reproducibility

Validators MUST produce byte-identical SHA-256 hex digests for every entry in `reference-hashes.json`. This file contains one entry per artifact type:

```json
{
  "entries": [
    {
      "artifactType": "string",
      "vectorId": "string",
      "canonical_json_sha256": "hex string (64 characters)"
    }
  ]
}
```

Hash divergence on any single entry constitutes a conformance failure. Common causes of divergence:
- Locale-aware string sorting instead of code-point sorting.
- Floating-point serialization differences (trailing zeros, exponential notation thresholds).
- BOM insertion or trailing newline appended to canonical form.
- UTF-16 or other non-UTF-8 encoding of the canonical byte string.

### 5.3 Offline Execution

The conformance test suite MUST be runnable without network access. All test data, keys, and expected values are embedded in the vector files. Validators MUST NOT fetch external resources during test execution.

### 5.4 Single-Command Execution

The entire conformance suite MUST be executable via a single shell command:

```
./runner.sh /path/to/validator-binary
```

The runner MUST NOT require environment variables, configuration files, or interactive input beyond the validator path argument.

### 5.5 Machine-Readable Output

The harness MUST produce a JSON report conforming to `harness/report-schema.json`. The report MUST include:
- Per-assertion pass/fail status.
- Per-vector actual vs. expected comparison (on failure).
- Aggregate counts: total assertions, mandatory passed, mandatory failed, optional passed, optional failed.
- Wall-clock execution time for the full suite.

---

## 6. Submission Evaluation Criteria

Submissions are evaluated against the following weighted criteria. Both hard thresholds and weighted scoring apply.

| Criterion | Weight | Threshold | Notes |
|-----------|--------|-----------|-------|
| Mandatory assertion pass rate | 40% | 100% required | Any mandatory failure is disqualifying |
| Reference hash corpus match | 30% | 100% required | Any hash divergence is disqualifying |
| Optional assertion pass rate | 15% | >= 80% recommended | Below 80% triggers manual review |
| Performance (standard corpus) | 10% | < 60 seconds | Measured on reference hardware (4-core, 8 GB RAM) |
| Documentation quality | 5% | Must include all items below | Incomplete documentation delays evaluation |

### 6.1 Documentation Requirements

Submissions MUST include:

1. **Build instructions**: Step-by-step commands to build the validator from source on a clean system.
2. **Dependency list**: All runtime and build-time dependencies with version constraints.
3. **Platform requirements**: Operating systems and architectures tested. At minimum one of: Linux x86_64, macOS arm64, Windows x86_64.
4. **Usage instructions**: How to invoke the validator (command-line interface, arguments, exit codes).
5. **Known limitations**: Any specification features not yet implemented, with references to the relevant spec sections.

### 6.2 Scoring

The final score is computed as:

```
score = (mandatory_pass_pct * 0.40)
      + (hash_match_pct * 0.30)
      + (optional_pass_pct * 0.15)
      + (performance_score * 0.10)
      + (documentation_score * 0.05)
```

Where `performance_score` is `100` if under 60 seconds, linearly decreasing to `0` at 120 seconds. `documentation_score` is `100` if all 5 items in section 6.1 are present, `0` for each missing item deducted at 20 points per item.

A submission MUST achieve 100% on both mandatory assertion pass rate and reference hash corpus match to be considered conformant. The remaining criteria determine ranking among conformant submissions.

---

## 7. Call for Independent Validator Implementations

### 7.1 Eligibility

The call is open to any individual, organization, or team. There are no restrictions on:
- Programming language or runtime.
- Operating system or platform.
- Licensing model (proprietary or open-source implementations are both eligible).

The reference implementation maintained in this repository is NOT eligible as an independent implementation for ratification purposes.

### 7.2 Timeline

- **T+0**: Publication of the conformance suite (vectors, assertions, harness, reference hashes).
- **T+6 months**: Submission deadline for independent implementations.
- **T+7 months**: Evaluation results published.
- **T+8 months**: Specification v1.0 ratification vote (contingent on prerequisites).

### 7.3 Ratification Prerequisites

Specification v1.0 SHALL NOT be ratified until:

1. At least **2 independent implementations** pass all mandatory assertions and reference hash checks.
2. At least **2 independent implementations** are written in **different programming languages**.
3. All **Critical** and **High** severity bounty findings (see section 8) have been resolved or formally accepted as known limitations.

If fewer than 2 qualifying implementations exist at T+7 months, the submission deadline extends in 3-month increments until the prerequisite is met.

### 7.4 Evaluation Process

1. **Automated phase**: The harness runs the full vector suite against the submission. Results are recorded as a JSON report.
2. **Manual phase**: Evaluators review edge cases, documentation quality, and adversarial vector handling. Evaluators MAY run additional vectors not in the public suite.
3. **Publication**: Per-assertion pass/fail results are published for every submission. Aggregate scores are published. Source code review notes are shared with the submitter privately.

### 7.5 Intellectual Property

Submitters retain all intellectual property rights to their implementations. Submission to this program does not grant any license to the project maintainers or other parties. Submitters MAY choose to release their implementation under any license.

---

## 8. Adversarial Review Bounty

### 8.1 Scope

The bounty covers **specification-level vulnerabilities only**. Implementation bugs in any specific validator (including the reference implementation) are out of scope. A valid finding MUST demonstrate that the specification text, as written, permits or fails to prevent a security-relevant behavior.

### 8.2 Vulnerability Categories

| Category | Description |
|----------|-------------|
| Canonicalization divergence | Two compliant canonicalization implementations produce different byte output for the same input |
| Hash collision construction | Practical (not theoretical) construction of two distinct artifacts with the same SHA-256 canonical hash |
| Binding graph bypass | Method to substitute an artifact without detection by the hash binding graph |
| Replay surface | Method to reuse a signed artifact (nonce, timestamp, or chain entry) in a context the specification intends to prohibit |
| Validation order exploit | Vulnerability arising from ambiguous or underspecified validation step ordering |
| Extension mechanism abuse | Method to use the extension artifact mechanism to bypass validation of required artifacts |

### 8.3 Severity Tiers

| Severity | Bounty | Criteria |
|----------|--------|----------|
| **Critical** | $2,000 | Allows forging a valid SCP without legitimate approval, or bypassing validation entirely such that an invalid artifact set is accepted as valid |
| **High** | $1,000 | Allows bypassing a specific validation step (e.g., skipping signature verification, ignoring a hash binding) while the overall verdict still reports pass |
| **Medium** | $500 | Ambiguity in specification text that causes two conformant implementations to produce different verdicts (one pass, one fail) for the same well-formed input |
| **Informational** | Acknowledgment | Clarification needed in specification text, but no demonstrated security impact; typos or inconsistencies that do not affect validation behavior |

### 8.4 Submission Process

1. Reports MUST be submitted via GitHub Security Advisories on the ClawForge repository.
2. Each report MUST include:
   - Affected specification section(s).
   - A concrete test vector demonstrating the vulnerability.
   - A description of the security impact.
   - Suggested specification text fix (RECOMMENDED but not required).
3. Reports MUST NOT be disclosed publicly until the disclosure window expires.

### 8.5 Evaluation and Disclosure

- **Acknowledgment**: Within 5 business days of submission.
- **Severity assessment**: Within 15 business days of submission.
- **Fix timeline**: Critical and High findings MUST be addressed in a specification revision within 30 days of confirmed severity. Medium findings MUST be addressed within 60 days.
- **Responsible disclosure window**: 90 days from the date of acknowledgment. After 90 days, the reporter MAY disclose publicly regardless of fix status.
- **Duplicate handling**: First report received (by GitHub timestamp) takes priority. Duplicate submissions receive no bounty but are acknowledged.

### 8.6 Funding

The bounty program is funded by project sponsors. Total pool allocation and remaining balance are published quarterly. If the pool is exhausted, new submissions are queued until additional funding is secured. Queued submissions retain their priority timestamp.

---

## Appendix A: Error Code Registry (Informative)

The following error codes are referenced in this document. The authoritative error code registry is maintained in the specification.

| Code | Section | Description |
|------|---------|-------------|
| `INPUT_FORMAT_INVALID` | 2.1 | Input is not a valid directory or recognized archive |
| `SIGNATURE_INVALID` | 4.3 | RSA-SHA256 signature verification failed |
| `SIGNATURE_KEY_MISMATCH` | 4.3 | Signature valid but signed by unexpected key |
| `CHAIN_LINK_BROKEN` | 4.4 | Evidence chain `prevHash` does not match computed hash of previous entry |
| `CHAIN_TIMESTAMP_NON_MONOTONIC` | 4.4 | Evidence chain timestamps are not strictly increasing |
| `SCP_MISSING_REQUIRED_ARTIFACT` | 4.5 | Sealed change package missing a required artifact type |
| `SCP_HASH_MISMATCH` | 4.5 | Artifact hash does not match manifest entry |
| `SCP_SESSION_ID_MISMATCH` | 4.5 | Artifacts reference different session IDs |
| `BINDING_PLAN_HASH_MISMATCH` | 4.6 | Execution plan hash does not match decision lock binding |
| `NONCE_REUSE_DETECTED` | 4.6 | Nonce value has been previously observed |
| `CAPABILITY_SCOPE_EXCEEDED` | 4.6 | Step packet requests capabilities beyond execution plan scope |
| `DOD_NOT_VERIFIABLE` | 4.6 | Definition-of-done contains no machine-verifiable assertions (warning) |
| `FORBIDDEN_TOKEN_DETECTED` | 4.6 | Model response contains a forbidden lint token |
