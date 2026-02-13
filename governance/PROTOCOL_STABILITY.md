# ClawForge Protocol Stability Policy

> Version: 1.0.0
> Status: Adopted
> Date: 2026-02-13

## 1. Core Principle

The ClawForge Change Integrity Protocol is stability-first. The default posture is:

> **No behavioral change without an explicit version change.** If two conformant validators disagree, the protocol is broken.

This policy exists to prevent silent divergence.

---

## 2. Stability Tiers

### Tier 1 — Immutable Core

These MUST NOT change in any 1.x release:

- SHA-256 as hash algorithm
- RFC 8785 canonical JSON + defined extensions
- Fail-closed semantics
- Directed acyclic artifact binding
- Hash exclusion rules (`hash`, `prevHash` stripped)
- Session Anchor binding rules
- Error sorting determinism (code → artifactType → path → message)
- No execution mandate

**Changes to Tier 1 require:**
- Major version bump (2.0.0)
- Public review window (minimum 30 days)
- Updated conformance matrix
- Updated test vectors

> Tier 1 is **constitutional**.

---

### Tier 2 — Constrained Extensible Layer

Includes:
- Artifact definitions
- Extension slot model
- New artifact types
- Optional fields
- New error codes

**Allowed in minor versions (1.x → 1.y) if:**
- Backward compatibility preserved
- No existing artifact becomes invalid
- No existing hash calculation changes
- Conformance suite updated
- CNF schema hash updated intentionally

> Tier 2 is **evolvable but controlled**.

---

### Tier 3 — Informational / Non-Normative

- Examples
- Integration guidance
- Explanatory notes
- Governance documentation
- Reference implementation improvements

**Can change at any time without version bump.**

> Tier 3 is **editorial**.

---

## 3. Versioning Rules

Semantic versioning is mandatory.

### Major (X.0.0) — Required when:
- Hash rules change
- Canonicalization changes
- Signature requirements change
- Fail/pass semantics change
- Any Tier 1 change

### Minor (1.X.0) — Allowed when:
- New artifact types added via extension model
- New optional fields added
- New error codes introduced
- New conformance assertions added (non-breaking)

### Patch (1.0.X) — Allowed when:
- Clarification only
- No normative change
- No conformance assertion changes

> If a validator's behavior changes and version does not, that is **drift**.

---

## 4. Drift Control Mechanisms

The following MUST exist in the repository:

1. **Cross-implementation CNF comparison** — Python ↔ TypeScript equivalence
2. **Deterministic conformance test vectors** — `conformance/vectors/v1/`
3. **Error code registry file** — This policy document
4. **CNF schema hash pinning** — `validator/SPEC_BINDING.md`
5. **Strict-mode CI enforcement** — `cross-impl-conformance.yml`
6. **Protocol version binding in artifacts** — `specVersion` in CNF

If any of these fail in CI, the change **MUST NOT merge**.

---

## 5. Extension Model Governance

All new artifact types MUST:

- Declare unique reverse-domain type identifier
- Define hash inclusion/exclusion rules
- Declare canonical sort behavior
- Specify binding targets
- Provide at least 3 conformance vectors
- Update extension registry section in spec

**Unknown artifacts MUST be rejected unless explicitly enabled.** No "passthrough integrity".

---

## 6. Conformance Requirements

A conformant implementation MUST:

- Pass 100% of mandatory assertions in the conformance matrix
- Produce byte-identical CNF output for published vectors
- Reject unknown `specVersion`
- Fail closed on malformed input
- **Not execute code**
- **Not access network**
- **Not modify session artifacts during validation**

> Conformance claims without published CI evidence are invalid.

---

## 7. Change Proposal Process (Lightweight)

To modify Tier 1 or Tier 2:

1. Open a "Protocol Change Proposal" (PCP) issue
2. Include:
   - Rationale
   - Backward compatibility analysis
   - Conformance impact
   - Test vector additions
   - Migration path
3. Wait minimum **7 days (Tier 2)** or **30 days (Tier 1)**
4. Merge only after:
   - All conformance vectors pass
   - Cross-implementation drift check passes
   - Version bumped appropriately

---

## 8. Error Codes Registry

| Code | Tier | Description |
|------|------|-------------|
| `CANONICAL_INVALID` | 1 | Canonical JSON validation failed |
| `HASH_MISMATCH` | 1 | Computed hash differs from declared |
| `CHAIN_HASH_MISMATCH` | 1 | Event hash does not match |
| `CHAIN_PREVHASH_MISMATCH` | 1 | prevHash does not link to previous |
| `SEQ_GAP` | 1 | Sequence number gap detected |
| `SPEC_VERSION_UNKNOWN` | 1 | Unknown specVersion rejected |
| `MISSING_REQUIRED_FIELD` | 1 | Required field absent |
| `SCHEMA_VIOLATION` | 2 | Artifact schema not met |
| `EXTENSION_UNSUPPORTED` | 2 | Unknown extension type |

---

## 9. Binding Reference

| Document | Location |
|----------|----------|
| CNF Schema | `backend/governance/validator/cnf.py` |
| Spec Binding | `validator/SPEC_BINDING.md` |
| Conformance Vectors | `conformance/vectors/v1/` |
| CI Workflow | `.github/workflows/cross-impl-conformance.yml` |
| This Policy | `governance/PROTOCOL_STABILITY.md` |

---

## 10. Enforcement

This policy is **self-enforcing**:

- CI blocks merge on drift
- CNF comparison catches behavioral changes
- Conformance vectors prevent regression
- Version binding prevents skipped updates

There is no committee to convince. The code enforces the policy.

---

## 11. Reference Implementation Policy

The ClawForge TypeScript implementation is:
- A reference implementation
- Not the protocol authority

**The spec governs behavior.** If reference code and spec diverge: **The spec wins.**

---

## 12. Neutrality & OSS Integrity

- No trademark restrictions on independent implementations
- No CLA required for conformance
- No paywall around test vectors
- Spec remains MIT or Apache licensed
- Governance remains public in repository

**Monetization can exist around tooling, hosting, orchestration, enterprise services — but never around protocol access.**

---

## 13. Deprecation Policy

Artifacts or fields MAY be deprecated but MUST:
- Remain valid for at least one full minor version
- Be clearly marked `DEPRECATED` in spec
- Emit warning-level error code (not fail)
- Have removal version explicitly stated

**Removal requires major version bump.**

---

## 14. Security Response Policy

If a vulnerability affects integrity guarantees:
- Immediate security advisory
- Temporary "validator warning mode" allowed
- Patch release required
- Conformance matrix updated

**Security patches do not require governance delay.**

---

## 15. Stability Promise

The protocol's promise is:

> A Sealed Change Package valid under version 1.0.0 will remain valid under all 1.x versions.

**Breaking that promise requires a major version change.** That is the social contract.

---

## Why This Works

It's **strict** where it matters:
- Hashes
- Canonicalization
- Determinism
- Fail-closed semantics

It's **flexible** where it should be:
- New artifact types
- New error codes
- New extension points

It **avoids bureaucracy** because:
- No committees
- No foundation required
- No voting structures
- No centralized control

But it still prevents entropy.

---

## What This Enables

If you follow this:
- Independent vendors can implement validators safely
- Enterprise adopters can trust backward compatibility
- Drift becomes visible
- Spec rot becomes measurable
- Your OSS remains neutral and credible

**This is how something becomes durable instead of trendy.**
