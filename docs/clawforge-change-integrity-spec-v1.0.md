# ClawForge Change Integrity Specification v1.0 — Draft for Public Review

**Status:** Draft
**Version:** 1.0.0
**Date:** 2026-02-11

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in RFC 2119.

---

## 1. Purpose and Scope

### 1.1 Problem Statement

When software is modified with the assistance of AI models, the resulting
changes lack deterministic verifiability. No standard mechanism exists to
prove that a change was authorized, scoped, reviewed, and cryptographically
bound to the artifacts that produced it.

### 1.2 Protocol Purpose

This specification defines a deterministic, cryptographically bound,
reproducible change validation protocol for AI-assisted software
modification. It specifies:

- A set of typed artifacts representing the lifecycle of a change from
  intent declaration through sealed delivery.
- Cryptographic binding rules forming a directed acyclic graph of artifact
  dependencies.
- A deterministic validation sequence that accepts or rejects a change
  package.
- Fail-closed failure semantics with no silent fallbacks.

### 1.3 Scope Boundary

This protocol governs **validation and integrity only**. It does not
govern:

- AI model invocation or orchestration.
- Change application to repositories.
- Runner execution strategies.
- Artifact transport between systems.
- User interface or workflow design.

### 1.4 Normative Scope

A conformant implementation MUST treat all artifacts as inert data. It
MUST NOT interpret artifact content as executable instructions. Validation
is a pure function from artifacts to a pass/fail verdict with structured
error output.

---

## 2. Terminology

All field constraints use the following notation:

- **string(N)**: UTF-8 string, maximum N characters.
- **string(M..N)**: UTF-8 string, minimum M, maximum N characters.
- **uuid4**: String matching `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`.
- **iso8601utc**: String matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/`, parseable as a UTC timestamp.
- **sha256hex**: String matching `/^[0-9a-f]{64}$/`.
- **actor**: Object `{ actorId: string(1..200), actorType: "human" | "system" }`.
- **pem-public-key**: String beginning with `-----BEGIN PUBLIC KEY-----` or `-----BEGIN RSA PUBLIC KEY-----` or `-----BEGIN EC PUBLIC KEY-----` and ending with the corresponding `-----END ... -----` delimiter.
- **hex-public-key**: String of 64–512 lowercase hexadecimal characters.

### 2.1 Definition of Done (DoD)

An immutable declaration of verifiable completion criteria for a change
session.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | MUST equal the protocol schema version |
| `dodId` | uuid4 | Unique identifier |
| `sessionId` | uuid4 | Owning session |
| `title` | string(1..500) | Human-readable title |
| `items` | array of DoDItem | 1–100 items |
| `createdAt` | iso8601utc | Creation timestamp |
| `createdBy` | actor | Creating entity |

**DoDItem Fields:**

| Field | Type | Condition |
|-------|------|-----------|
| `id` | string(1..100) | Unique within DoD |
| `description` | string(1..2000) | |
| `verificationMethod` | enum | One of: `command_exit_code`, `file_exists`, `file_hash_match`, `command_output_match`, `artifact_recorded`, `custom` |
| `verificationCommand` | string(5000) | REQUIRED when method is `command_exit_code` or `command_output_match` |
| `expectedExitCode` | integer 0–255 | REQUIRED when method is `command_exit_code` |
| `expectedOutput` | string(10000) | REQUIRED when method is `command_output_match` |
| `expectedHash` | sha256hex | REQUIRED when method is `file_hash_match` |
| `targetPath` | string(1000) | REQUIRED when method is `file_exists` or `file_hash_match` |
| `verificationProcedure` | string(20..5000) | REQUIRED when method is `custom` |
| `notDoneConditions` | array of string(1..1000) | 0–20 items |

**Invariants:**
- No item description MUST match `/\b(works?\s+as\s+expected|should\s+be\s+fine|seems?\s+correct|looks?\s+good)\b/i`.
- No field in the serialized DoD MUST contain the tokens `TODO`, `FIXME`, `TBD`, `PLACEHOLDER`, or `XXX`.

### 2.2 Decision Lock

A frozen architectural decision binding intent to constraints. Once
approved, the content hash is immutable.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `lockId` | uuid4 | Unique identifier |
| `sessionId` | uuid4 | Owning session |
| `dodId` | uuid4 | MUST reference an existing DoD |
| `goal` | string(1..5000) | Non-empty statement of intent |
| `nonGoals` | array of string(1..1000) | 1–50 items |
| `interfaces` | array of Interface | 0–50 items |
| `invariants` | array of string(1..1000) | 1–50 items |
| `constraints` | array of string(1..1000) | 0–50 items |
| `failureModes` | array of FailureMode | 0–50 items |
| `risksAndTradeoffs` | array of RiskTradeoff | 0–50 items |
| `status` | enum | `draft`, `approved`, `rejected` |
| `approvalMetadata` | ApprovalMeta | REQUIRED when status is `approved` |
| `createdAt` | iso8601utc | |
| `createdBy` | actor | |

**Interface:** `{ name: string(1..300), description: string(1..2000), type: "api" | "cli" | "file" | "event" | "schema" | "other" }`

**FailureMode:** `{ description: string(1..1000), mitigation: string(1..1000) }`

**RiskTradeoff:** `{ description: string(1..1000), severity: "low" | "medium" | "high", accepted: boolean }`

**ApprovalMeta:** `{ approvedBy: string(1..200), approvedAt: iso8601utc, approvalMethod: string(1..200) }`

**Invariants:**
- If `status` is `approved`, `approvalMetadata` MUST be present.
- Serialized JSON MUST NOT contain tokens `TODO`, `FIXME`, `TBD`, `PLACEHOLDER`, `XXX`.

**Hash Computation:** See Section 3.2.1.

### 2.3 Execution Plan

An ordered set of steps describing the work to be performed. Each step
declares its scope, capabilities, and artifact references.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `sessionId` | uuid4 | OPTIONAL; if present, MUST match session |
| `dodId` | uuid4 | OPTIONAL; if present, MUST reference existing DoD |
| `lockId` | uuid4 | OPTIONAL; if present, MUST reference existing Lock |
| `steps` | array of ExecutionStep | 1 or more |
| `allowedCapabilities` | array of string | OPTIONAL |

**ExecutionStep:** `{ stepId: string, references: array of string (OPTIONAL), requiredCapabilities: array of string (OPTIONAL) }`

Step `references` MUST resolve to DoD item IDs. Step `requiredCapabilities`
MUST be drawn from the Capability Registry (Section 2.17).

**Lint Rules:** An Execution Plan MUST NOT contain any of the following
substrings: `$(`, `` ` ``, `;`, `&&`, `||`, `|`, `sudo`, `chmod`, `chown`,
`bash`, `zsh`, `powershell`, `cmd.exe`, `npm`, `pnpm`, `yarn`, `node`.
HTTP method tokens `POST`, `PUT`, `PATCH`, `DELETE` MUST NOT appear
(case-sensitive). Whole-word matches for `rm`, `mv`, `cp`, `sh`, `go`
MUST NOT appear.

**Hash Computation:** See Section 3.2.2.

### 2.4 Repo Snapshot

A content-addressed inventory of repository files at a point in time.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | Owning session |
| `snapshotId` | uuid4 | Unique identifier |
| `generatedAt` | iso8601utc | |
| `rootDescriptor` | string | Project root description |
| `includedFiles` | array of FileSnapshot | Sorted by `path` |
| `snapshotHash` | sha256hex | Self-referential hash |

**FileSnapshot:** `{ path: repo-relative-path, contentHash: sha256hex }`

**Path Rules:** All paths MUST be POSIX-style (forward slashes), relative
(no leading `/`), contain no `..` segments, and contain no backslashes.

**Hash Computation:** See Section 3.2.3.

### 2.5 Prompt Capsule

A deterministic encapsulation of the prompt sent to an AI model, binding
it to the execution plan and constraining the model's behavior.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `capsuleId` | uuid4 | Unique identifier |
| `lockId` | uuid4 | MUST reference existing Decision Lock |
| `planHash` | sha256hex | MUST match computed Execution Plan hash |
| `createdAt` | iso8601utc | |
| `createdBy` | actor | |
| `model` | ModelConfig | |
| `intent` | Intent | |
| `context` | Context | |
| `boundaries` | Boundaries | |
| `inputs` | Inputs | |
| `hash` | `{ capsuleHash: sha256hex }` | Self-referential hash |

**ModelConfig:** `{ provider: "openai" | "anthropic" | "other", modelId: string(1..200), temperature: 0 (exact), topP: 1 (exact), seed: integer 0–2147483647 }`

Temperature MUST be exactly `0`. TopP MUST be exactly `1`. No other values
are permitted.

**Intent:** `{ goalExcerpt: string(1..5000), taskType: "code_change" | "review" | "design" | "explain" | "test_plan" | "other", forbiddenBehaviors: array of string (minimum 3) }`

**Context:** `{ systemPrompt: string(1..20000), userPrompt: string(1..20000), constraints: array of string (minimum 3) }`

**Boundaries:** `{ allowedFiles: array of repo-relative-path (1–200, no duplicates), allowedSymbols: array of string (0–500), allowedDoDItems: array of string (minimum 1), allowedPlanStepIds: array of string (minimum 1), allowedCapabilities: array of string, disallowedPatterns: array of non-empty string (minimum 5), allowedExternalModules: array of string }`

**Inputs:** `{ fileDigests: array of { path: repo-relative-path, sha256: sha256hex }, partialCoverage: boolean }`

**Invariants:**
- `fileDigests` paths MUST be a subset of `allowedFiles`.
- If `partialCoverage` is `false`, `fileDigests` MUST cover every entry in `allowedFiles`.
- `disallowedPatterns` MUST NOT contain empty strings.

**Hash Computation:** See Section 3.2.4.

### 2.6 Model Response Artifact

The recorded output of an AI model invocation, bound to its originating
Prompt Capsule.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `capsuleId` | uuid4 | MUST reference existing Prompt Capsule |
| `responseId` | uuid4 | Unique identifier |
| `createdAt` | iso8601utc | |
| `model` | `{ provider, modelId, seed }` | |
| `output` | Output | |
| `hash` | `{ responseHash: sha256hex }` | Self-referential hash |

**Output:** `{ summary: string(1..5000), proposedChanges: array of ChangeProposal (minimum 1), citations: array of Citation (minimum 1), refusal: { reason: string(1..5000) } (OPTIONAL) }`

**ChangeProposal:** `{ changeId: string(1..100), changeType: "edit_file" | "add_file" | "delete_file" | "rename_file" | "no_change", targetPath: string(1..1000), patch: string(200000) nullable, referencedDoDItems: array (minimum 1), referencedPlanStepIds: array (minimum 1), referencedSymbols: array, riskNotes: array (0–20) }`

**Invariant:** If `refusal` is present, `proposedChanges` MUST be empty.

**Hash Computation:** See Section 3.2.5.

### 2.7 Symbol Index

A deterministic inventory of exported and imported symbols across the
codebase, enabling boundary enforcement.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `generatedAt` | iso8601utc | |
| `tsVersion` | string | Compiler/parser version used |
| `symbolIndexHash` | sha256hex | Self-referential hash |
| `files` | array of FileSymbolInfo | Sorted by `path` |

**FileSymbolInfo:** `{ path: repo-relative-path, exports: array of ExportInfo (sorted by name, then location), imports: array of ImportInfo (sorted by specifier) }`

**ExportInfo:** `{ name: string, kind: "function" | "class" | "interface" | "type" | "const" | "default", isDefault: boolean, isTypeOnly: boolean, location: { line: integer, col: integer }, signatureHash: sha256hex (OPTIONAL) }`

**ImportInfo:** `{ specifier: string, named: array of string (sorted), defaultImport: string (OPTIONAL), namespaceImport: string (OPTIONAL), typeOnly: boolean }`

**Determinism Rules:** Exports MUST be sorted by `name`, then by `location.line`. Imports MUST be sorted by `specifier`. Named imports MUST be sorted alphabetically. Files MUST be sorted by `path`.

**Hash Computation:** See Section 3.2.6.

### 2.8 Step Packet

A scoped work declaration for a single execution step, binding plan,
capsule, snapshot, and DoD references into an auditable unit.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `lockId` | uuid4 | MUST reference existing Decision Lock |
| `stepId` | string(1..200) | MUST match a plan step |
| `planHash` | sha256hex | MUST match computed Execution Plan hash |
| `capsuleHash` | sha256hex | MUST match computed Prompt Capsule hash |
| `snapshotHash` | sha256hex | MUST match computed Repo Snapshot hash |
| `goalReference` | string(1..5000) | MUST contain the exact Decision Lock goal text |
| `dodId` | uuid4 | MUST reference existing DoD |
| `dodItemRefs` | array of string | References to DoD item IDs |
| `allowedFiles` | array of repo-relative-path | 0–200 items |
| `allowedSymbols` | array of string | 0–500 items |
| `requiredCapabilities` | array of string | OPTIONAL, 0–100 |
| `reviewerSequence` | array of string | Minimum 3 entries |
| `context` | StepContext | |
| `packetHash` | sha256hex | Self-referential hash |
| `createdAt` | iso8601utc | |

**StepContext:** `{ fileDigests: array of { path, sha256 } (OPTIONAL), excerpts: array of Excerpt (OPTIONAL) }`

**Excerpt:** `{ path: repo-relative-path, startLine: integer (≥1), endLine: integer (≥1), text: string(2000) }`. `startLine` MUST be ≤ `endLine`.

**Size Constraint:** Serialized canonical JSON MUST NOT exceed 200 KB.

**Forbidden Field Names:** The serialized JSON MUST NOT contain field names
matching `/("cmd"|"command"|"shell"|"exec"|"curl"|"http"|"https"|"spawn"|"write"|"delete"):/i`.

**Lint Rules:** Step Packet text MUST NOT contain: `rm`, `mv`, `cp`,
`chmod`, `chown`, `sudo`, `bash`, `sh`, `zsh`, `powershell`, `cmd.exe`,
`curl`, `wget`, `http://`, `https://`, `fetch(`, `axios`, `writeFile`,
`unlink`, `rmdir`, `mkdir`, `child_process`, `spawn(`, `exec(`,
`execFile(`, `fork(`, `TODO`, `TBD`, `FIXME`, `PLACEHOLDER`, `XXX`.

**Hash Computation:** See Section 3.2.7.

### 2.9 Runner Evidence

A single item of verifiable evidence produced by a runner during step
execution.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `stepId` | string(1..100) | MUST reference an existing plan step |
| `evidenceId` | uuid4 | MUST be globally unique within session |
| `timestamp` | iso8601utc | |
| `evidenceType` | string(1..100) | |
| `artifactHash` | sha256hex | Hash of the produced artifact |
| `verificationMetadata` | map of string→any | |
| `capabilityUsed` | string(1..200) | MUST be in Capability Registry |
| `humanConfirmationProof` | string(1..2000) | MUST be non-empty |
| `planHash` | sha256hex | OPTIONAL; REQUIRED for chain validation |
| `prevEvidenceHash` | sha256hex nullable | OPTIONAL; REQUIRED for chain validation |
| `evidenceHash` | sha256hex | OPTIONAL; self-referential hash |

**Validation Rules:**
- `stepId` MUST exist in the Execution Plan.
- `capabilityUsed` MUST be in `executionPlan.allowedCapabilities` (if defined).
- `capabilityUsed` MUST be in the step's `requiredCapabilities` (if defined).
- If the capability requires human confirmation, `humanConfirmationProof` MUST be non-empty.
- `evidenceType` MUST match the `verificationMethod` of at least one referenced DoD item.

**Hash Computation:** See Section 3.2.8.

### 2.10 Evidence Chain

An ordered linked list of Runner Evidence items forming a tamper-evident
chronological record.

**Structure Rules:**
1. Each item's `planHash` MUST equal the computed Execution Plan hash.
2. The first item's `prevEvidenceHash` MUST be `null`.
3. Each subsequent item's `prevEvidenceHash` MUST equal the `evidenceHash`
   of the immediately preceding item.
4. Each item's `evidenceHash` MUST equal its computed hash (Section 3.2.8).
5. Timestamps MUST be monotonically non-decreasing.

The Evidence Chain is not a separate artifact with its own schema. It is
the ordered sequence of Runner Evidence items validated by the rules above.

### 2.11 Runner Identity

A declaration of the runner's identity, capabilities, and environment,
used to bind attestations to a specific execution context.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `runnerId` | uuid4 | Unique identifier |
| `runnerVersion` | string(1..100) | |
| `runnerPublicKey` | pem-public-key or hex-public-key | |
| `environmentFingerprint` | sha256hex | |
| `buildHash` | sha256hex | |
| `allowedCapabilitiesSnapshot` | array of string | Sorted for deterministic hashing |
| `attestationTimestamp` | iso8601utc | |

**Hash Computation:** See Section 3.2.9.

### 2.12 Runner Attestation

A cryptographic attestation binding a runner's identity to a plan and
evidence chain, signed by the runner's private key.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `sessionId` | uuid4 | |
| `planHash` | sha256hex | MUST match computed Execution Plan hash |
| `lockId` | uuid4 | MUST reference existing Decision Lock |
| `runnerId` | uuid4 | MUST match `runnerIdentity.runnerId` |
| `identityHash` | sha256hex | MUST match computed Runner Identity hash |
| `evidenceChainTailHash` | sha256hex | MUST match hash of last evidence item |
| `nonce` | uuid4 | MUST be unique per session (replay resistance) |
| `signature` | base64 string | RSA signature over payload hash |
| `signatureAlgorithm` | enum | `sha256`, `sha384`, `sha512` |
| `createdAt` | iso8601utc | MUST be ≥ last evidence timestamp |

**Validation Sequence:**
1. Schema validation.
2. `sessionId` match.
3. `lockId` match.
4. `runnerId` match against Runner Identity.
5. `identityHash` match against computed identity hash.
6. `planHash` match against computed plan hash.
7. `evidenceChainTailHash` match against last evidence item hash.
8. Timestamp ordering: `createdAt` ≥ last evidence `timestamp`.
9. Capability snapshot: plan's `allowedCapabilities` MUST exactly equal
   Runner Identity's `allowedCapabilitiesSnapshot` (set equality).
10. Nonce uniqueness check.
11. Cryptographic signature verification.

**Hash Computation:** See Section 3.2.10.

### 2.13 Approval Policy

A declaration of who may approve artifacts, by what algorithm, and under
what quorum rules.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `policyId` | uuid4 | Unique identifier |
| `allowedAlgorithms` | array of string | MUST contain only `"RSA-SHA256"` |
| `approvers` | array of Approver | Minimum 1 |
| `rules` | array of ApprovalRule | Minimum 1 |
| `createdAt` | iso8601utc | |

**Approver:** `{ approverId: string(1..200), role: string(1..200), publicKeyPem: pem-public-key, active: boolean }`

**ApprovalRule:** `{ artifactType: "decision_lock" | "execution_plan" | "prompt_capsule", requiredRoles: array of string (minimum 1), quorum: { type: "m_of_n", m: integer (≥1), n: integer (≥1) }, requireDistinctApprovers: boolean }`

**Invariants:**
- `allowedAlgorithms` MUST contain only `"RSA-SHA256"`.
- Approver IDs MUST be unique.
- For each rule: `m` MUST be ≤ `n`, both MUST be > 0.
- Each required role MUST have at least one active approver in the policy.
- `n` MUST NOT exceed the total active approvers across required roles.
- `requireDistinctApprovers` MUST be `true`. This is a protocol invariant,
  not a configurable option.

### 2.14 Approval Bundle

A collection of cryptographic approval signatures for session artifacts.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `bundleId` | uuid4 | Unique identifier |
| `signatures` | array of ApprovalSignature | Minimum 1 |
| `bundleHash` | sha256hex | Self-referential hash |

**ApprovalSignature:** `{ signatureId: uuid4, approverId: string(1..200), role: string(1..200), algorithm: "RSA-SHA256" (literal), artifactType: "decision_lock" | "execution_plan" | "prompt_capsule", artifactHash: sha256hex, sessionId: uuid4, timestamp: iso8601utc, nonce: uuid4, signature: base64 string, payloadHash: sha256hex }`

**Enforcement Rules:**
1. `signature.sessionId` MUST match `bundle.sessionId`.
2. Approver MUST exist in the Approval Policy and MUST be active.
3. `signature.role` MUST match the approver's declared role.
4. `signature.algorithm` MUST be in `policy.allowedAlgorithms`.
5. Cryptographic signature MUST verify against the approver's public key.
6. Nonce MUST NOT have been previously used (replay detection).
7. Each approver MUST sign at most once per `artifactType`
   (`requireDistinctApprovers` enforcement).
8. `signature.artifactHash` MUST match the computed hash of the referenced
   artifact.
9. For each approval rule: the count of verified, distinct approvers with
   the required roles MUST be ≥ the quorum `m`.

**Hash Computation:** See Section 3.2.11 and 3.2.12.

### 2.15 Policy Set

An array of Policy objects defining enforceable rules over session
artifacts.

**Policy Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `policyId` | uuid4 | Unique identifier |
| `name` | string(1..200) | |
| `version` | string | Semantic version (MAJOR.MINOR.PATCH) |
| `scope` | enum | `session`, `plan`, `runner`, `capability`, `global` |
| `rules` | array of PolicyRule | 1–1000 items |
| `createdAt` | iso8601utc | |
| `createdBy` | actor | |

**PolicyRule:** `{ ruleId: string(1..100), description: string(1..1000), target: "plan" | "evidence" | "attestation" | "runnerIdentity" | "capability", condition: PolicyCondition, effect: "allow" | "deny" | "require", severity: "info" | "warning" | "critical" }`

**PolicyCondition:** `{ field: string (dot-notation path), operator: enum, value: any }`

**Operators:** `equals`, `not_equals`, `in`, `not_in`, `subset_of`,
`superset_of`, `greater_than`, `less_than`, `exists`, `matches_regex`.

**Regex Safety:** Patterns MUST NOT exceed 200 characters. Input MUST NOT
exceed 1000 characters. Evaluation MUST timeout at 100 ms. Lookahead,
lookbehind, and backreferences MUST be rejected.

**Enforcement Semantics:**
- `deny` + condition passes → FAILURE.
- `require` + condition fails → FAILURE.
- `allow` + condition fails + `severity` is `critical` → FAILURE.
- Evaluation errors MUST cause the rule to fail (fail-closed).
- A session passes policy enforcement only if zero blocking failures exist.

**Hash Computation:** See Section 3.2.13.

### 2.16 Sealed Change Package (SCP)

The terminal artifact of the protocol. A Sealed Change Package binds all
session artifacts into a single, hash-verified envelope.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `schemaVersion` | string | Protocol schema version |
| `sessionId` | uuid4 | |
| `sealedAt` | iso8601utc | |
| `sealedBy` | actor | |
| `packageHash` | sha256hex | Self-referential hash |
| `decisionLockHash` | sha256hex | REQUIRED |
| `planHash` | sha256hex | REQUIRED |
| `capsuleHash` | sha256hex | REQUIRED |
| `snapshotHash` | sha256hex | REQUIRED |
| `stepPacketHashes` | array of sha256hex | REQUIRED (may be empty) |
| `patchArtifactHashes` | array of sha256hex | REQUIRED (may be empty) |
| `reviewerReportHashes` | array of sha256hex | REQUIRED (may be empty) |
| `evidenceChainHashes` | array of sha256hex | REQUIRED (may be empty) |

**Optional Fields:**

| Field | Type |
|-------|------|
| `policySetHash` | sha256hex |
| `policyEvaluationHash` | sha256hex |
| `symbolIndexHash` | sha256hex |
| `patchApplyReportHash` | sha256hex |
| `runnerIdentityHash` | sha256hex |
| `attestationHash` | sha256hex |
| `approvalPolicyHash` | sha256hex |
| `approvalBundleHash` | sha256hex |
| `anchorHash` | sha256hex |

**Invariant:** `packageHash` MUST equal the computed hash of the SCP
(Section 3.2.14). This is a self-referential integrity check: the SCP
authenticates itself.

**Hash Computation:** See Section 3.2.14.

### 2.17 Capability Registry

A closed, static set of declared capabilities. Each capability has:

| Field | Type |
|-------|------|
| `id` | string, unique |
| `description` | string |
| `category` | `filesystem`, `validation`, `computation`, `transformation`, `verification`, `metadata` |
| `riskLevel` | `low`, `medium`, `high`, `critical` |
| `allowedRoles` | array of reviewer roles |
| `requiresHumanConfirmation` | boolean |

No dynamic capability creation is permitted. All capabilities MUST be
declared at protocol definition time. Implementations MUST reject any
`capabilityUsed` value not present in the registry.

### 2.18 Session Anchor

A binding artifact that ties together the final state of all session
components for replay verification.

**Required Fields:**

| Field | Type | Constraint |
|-------|------|------------|
| `sessionId` | uuid4 | |
| `planHash` | sha256hex | MUST match computed plan hash |
| `lockId` | uuid4 | MUST reference existing Decision Lock |
| `finalEvidenceHash` | sha256hex | MUST match last evidence item hash |

**Optional Fields:** `finalAttestationHash`, `runnerIdentityHash`,
`policySetHash`, `policyEvaluationHash` — each sha256hex.

**Validation:** Each field present in the anchor MUST match the
corresponding computed hash from the referenced artifact. Missing expected
fields that are provided MUST cause validation failure.

### 2.19 Reviewer Roles

A closed set of reviewer types: `static`, `security`, `qa`, `e2e`,
`automation`. Step Packets MUST declare a `reviewerSequence` with a
minimum of 3 entries drawn from this set.

**Reviewer Report:** `{ schemaVersion, sessionId, stepId, reviewerRole, passed: boolean, violations: array of string, notes: array of string }`

**Invariant:** If `passed` is `false`, `violations` MUST be non-empty.
If `passed` is `true`, `violations` MUST be empty.

---

## 3. Cryptographic Primitives

### 3.1 Canonical JSON Normalization

All hash computations in this protocol operate on the canonical JSON
representation of the input data.

Canonical JSON is defined as a profile of RFC 8785 (JSON Canonicalization
Scheme) with the following protocol-specific rules:

1. Object keys MUST be sorted lexicographically (Unicode code point order)
   at every nesting level.
2. Values of datetime type MUST be serialized as ISO 8601 UTC strings
   with `Z` suffix (e.g., `"2026-02-11T12:00:00.000Z"`).
3. Undefined/absent values MUST be omitted entirely. They MUST NOT be
   serialized as `null`.
4. Explicit `null` values MUST be preserved as JSON `null`.
5. Array element order MUST be preserved unless the artifact definition
   (Section 2) specifies a canonical sort for that array.
6. String, number, and boolean values MUST pass through unchanged.
7. The output MUST be a single UTF-8 encoded string with no trailing
   newline.

**Pseudocode:**

```
function canonicalJson(value):
  return jsonSerialize(normalize(value))

function normalize(value):
  if value is undefined: return OMIT
  if value is null: return null
  if value is datetime: return value.toIso8601Utc()
  if value is array: return [normalize(v) for v in value if v is not OMIT]
  if value is object:
    result = ordered_map()
    for key in lexicographicSort(keys(value)):
      normalized = normalize(value[key])
      if normalized is not OMIT:
        result[key] = normalized
    return result
  return value
```

### 3.2 Hash Algorithm

All hashes in this protocol MUST be computed as SHA-256 over the UTF-8
encoding of the canonical JSON representation of the normalized input.

Hash values MUST be represented as 64-character lowercase hexadecimal
strings.

```
hash(artifact) = lowercase_hex(SHA-256(utf8_encode(canonicalJson(normalized_artifact))))
```

#### 3.2.1 Decision Lock Hash

**Excluded fields:** `approvalMetadata`.

**Sorted arrays:** `nonGoals`, `invariants`, `constraints` (lexicographic).
Object keys within `interfaces`, `failureModes`, `risksAndTradeoffs`
items are sorted by canonical JSON rules.

**Included fields:** `schemaVersion`, `lockId`, `sessionId`, `dodId`,
`goal`, `nonGoals`, `interfaces`, `invariants`, `constraints`,
`failureModes`, `risksAndTradeoffs`, `status`, `createdAt`, `createdBy`.

#### 3.2.2 Execution Plan Hash

**Excluded fields:** `planHash` (if present as self-referential field).

**Sorted arrays:** `steps` sorted by `stepId`. `allowedCapabilities`
sorted lexicographically. Object keys within steps sorted by canonical
JSON rules.

**Included fields:** `sessionId` (if present), `dodId` (if present),
`lockId` (if present), `steps`, `allowedCapabilities` (if present).

#### 3.2.3 Repo Snapshot Hash

**Excluded fields:** `snapshotHash`.

**Sorted arrays:** `includedFiles` sorted by `path`.

**Included fields:** `schemaVersion`, `sessionId`, `snapshotId`,
`generatedAt`, `rootDescriptor`, `includedFiles`.

#### 3.2.4 Prompt Capsule Hash

**Excluded fields:** The entire `hash` sub-object (containing
`capsuleHash`).

**Sorted arrays:** `boundaries.allowedFiles`,
`boundaries.allowedSymbols`, `boundaries.allowedDoDItems`,
`boundaries.allowedPlanStepIds`, `boundaries.allowedCapabilities`,
`boundaries.disallowedPatterns`, `boundaries.allowedExternalModules`,
`inputs.fileDigests` (by `path`).

**Included fields:** All fields except the `hash` sub-object.

#### 3.2.5 Model Response Hash

**Excluded fields:** The entire `hash` sub-object (containing
`responseHash`).

**Included fields:** All fields except the `hash` sub-object.

#### 3.2.6 Symbol Index Hash

**Excluded fields:** `symbolIndexHash`.

**Deterministic ordering:** Files sorted by `path`. Exports sorted by
`name`, then `location.line`. Imports sorted by `specifier`. Named
imports sorted alphabetically.

**Included fields:** All fields except `symbolIndexHash`.

#### 3.2.7 Step Packet Hash

**Excluded fields:** `packetHash`.

**Sorted arrays:** `dodItemRefs`, `allowedFiles`, `allowedSymbols`,
`requiredCapabilities` (all lexicographic). `context.fileDigests` sorted
by `path`. `context.excerpts` sorted by `path`, then `startLine`.
`reviewerSequence` preserves declared order (not sorted).

**Included fields:** All fields except `packetHash`, including
`createdAt`.

#### 3.2.8 Runner Evidence Hash

**Excluded fields:** `evidenceHash`.

**Included fields:** `schemaVersion`, `sessionId`, `stepId`, `evidenceId`,
`timestamp`, `evidenceType`, `artifactHash`, `verificationMetadata`,
`capabilityUsed`, `humanConfirmationProof`, `planHash` (if present),
`prevEvidenceHash` (if present).

#### 3.2.9 Runner Identity Hash

**Excluded fields:** `attestationTimestamp`.

**Sorted arrays:** `allowedCapabilitiesSnapshot` (lexicographic).

**Included fields:** `runnerId`, `runnerVersion`, `runnerPublicKey`,
`environmentFingerprint`, `buildHash`, `allowedCapabilitiesSnapshot`.

#### 3.2.10 Attestation Payload Hash

**Excluded fields:** `signature`.

**Included fields:** `sessionId`, `planHash`, `lockId`, `runnerId`,
`identityHash`, `evidenceChainTailHash`, `nonce`, `signatureAlgorithm`,
`createdAt`.

#### 3.2.11 Approval Signature Payload Hash

**Excluded fields:** `signature`, `payloadHash`.

**Included fields:** `signatureId`, `approverId`, `role`, `algorithm`,
`artifactType`, `artifactHash`, `sessionId`, `timestamp`, `nonce`.

#### 3.2.12 Approval Bundle Hash

**Excluded fields:** `bundleHash`.

**Sorted arrays:** `signatures` sorted by `signatureId`. Each signature
is normalized to its payload fields (excluding `signature` and
`payloadHash`).

**Included fields:** `schemaVersion`, `sessionId`, `bundleId`,
`signatures` (sorted and normalized).

#### 3.2.13 Policy Set Hash

Policies MUST be sorted by `policyId`. The hash is computed over the
sorted array of normalized policies.

#### 3.2.14 Sealed Change Package Hash

**Excluded fields:** `packageHash`.

**Sorted arrays:** `stepPacketHashes`, `patchArtifactHashes`,
`reviewerReportHashes`, `evidenceChainHashes` (all lexicographic).

**Optional field handling:** Optional fields MUST be included in the hash
input only if present. Absent optional fields MUST be omitted (not set
to `null`).

**Included fields:** `schemaVersion`, `sessionId`, `sealedAt`, `sealedBy`,
`decisionLockHash`, `planHash`, `capsuleHash`, `snapshotHash`,
`stepPacketHashes`, `patchArtifactHashes`, `reviewerReportHashes`,
`evidenceChainHashes`, and all present optional fields.

### 3.3 Signature Algorithms

The REQUIRED signature algorithm is RSA-SHA256. Implementations MUST
support RSA-SHA256. Implementations MAY support RSA-SHA384 and RSA-SHA512.
No other signature algorithms are permitted.

The `signatureAlgorithm` field values map as follows:

| Field Value | Algorithm |
|-------------|-----------|
| `sha256` | RSA-SHA256 |
| `sha384` | RSA-SHA384 |
| `sha512` | RSA-SHA512 |

**Signing:** The signer computes the payload hash (per Section 3.2.10 or
3.2.11), then signs the hex-encoded hash string using the RSA private key
with the specified digest algorithm. The result is base64-encoded.

**Verification:** The verifier recomputes the payload hash, then verifies
the base64-decoded signature against the hex-encoded payload hash using the
signer's public key.

**Public Key Formats:** Implementations MUST accept PEM-encoded public
keys. Implementations MUST accept hex-encoded public keys (64–512
characters) and convert them to PEM format before verification.

### 3.4 Format Constraints

| Type | Pattern | Description |
|------|---------|-------------|
| UUID v4 | `/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i` | Universally unique identifier, version 4 |
| ISO 8601 UTC | `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/` | UTC timestamp with Z suffix |
| SHA-256 hex | `/^[0-9a-f]{64}$/` | Lowercase hexadecimal hash |
| Repo-relative path | No `..`, no leading `/`, no `\`, POSIX forward slashes | Safe file path |

---

## 4. Artifact Binding Graph

### 4.1 Required Bindings

The following directed acyclic graph defines the REQUIRED hash bindings
between artifacts. Each arrow represents a field in the source artifact
that MUST contain the computed hash of the target artifact.

```
DoD.dodId ←────────────────── DecisionLock.dodId
                               StepPacket.dodId

DecisionLock ──hash──────────→ SCP.decisionLockHash
                               ApprovalSignature.artifactHash
                                 (when artifactType = "decision_lock")

ExecutionPlan ──hash─────────→ DecisionLock.planHash (when present)
                               PromptCapsule.planHash
                               StepPacket.planHash
                               RunnerAttestation.planHash
                               SessionAnchor.planHash
                               Evidence[*].planHash
                               SCP.planHash

PromptCapsule ──hash─────────→ StepPacket.capsuleHash
                               SCP.capsuleHash

RepoSnapshot ──hash──────────→ StepPacket.snapshotHash
                               PatchApplyReport.baseSnapshotHash
                               SCP.snapshotHash

Evidence[i] ──hash───────────→ Evidence[i+1].prevEvidenceHash
Evidence[last] ──hash────────→ RunnerAttestation.evidenceChainTailHash
                               SessionAnchor.finalEvidenceHash

RunnerIdentity ──hash────────→ RunnerAttestation.identityHash
                               SCP.runnerIdentityHash

RunnerAttestation ──hash─────→ SessionAnchor.finalAttestationHash
                               SCP.attestationHash

PolicySet ──hash─────────────→ SessionAnchor.policySetHash
                               SCP.policySetHash

PolicyEvaluation ──hash──────→ SessionAnchor.policyEvaluationHash
                               SCP.policyEvaluationHash

StepPacket[*] ──hash─────────→ SCP.stepPacketHashes[]
PatchArtifact[*] ──hash──────→ SCP.patchArtifactHashes[]
ReviewerReport[*] ──hash─────→ SCP.reviewerReportHashes[]
Evidence[*] ──hash───────────→ SCP.evidenceChainHashes[]
ApprovalPolicy ──hash────────→ SCP.approvalPolicyHash
ApprovalBundle ──hash────────→ SCP.approvalBundleHash
SymbolIndex ──hash───────────→ SCP.symbolIndexHash
PatchApplyReport ──hash──────→ SCP.patchApplyReportHash
SessionAnchor ──hash─────────→ SCP.anchorHash
SCP ──hash───────────────────→ SCP.packageHash (self-referential)
```

### 4.2 Optional Bindings

The SCP optional fields (`policySetHash`, `policyEvaluationHash`,
`symbolIndexHash`, `patchApplyReportHash`, `runnerIdentityHash`,
`attestationHash`, `approvalPolicyHash`, `approvalBundleHash`,
`anchorHash`) are OPTIONAL. When present, the corresponding artifact
MUST exist and its computed hash MUST match. When absent, the
corresponding artifact is not part of the sealed package and MUST NOT
be validated.

### 4.3 Cross-Artifact Validation Rules

1. **Session binding:** Every artifact that contains a `sessionId` field
   MUST have its value equal to the session's canonical `sessionId`.
2. **Plan hash consistency:** Every artifact that references `planHash`
   MUST reference the same computed hash value.
3. **Lock ID consistency:** Every artifact that references `lockId` MUST
   reference the same Decision Lock.
4. **DoD ID consistency:** Every artifact that references `dodId` MUST
   reference the same Definition of Done.
5. **No cross-session reuse:** No artifact produced for session A MAY
   appear in the sealed package of session B.

### 4.4 Replay Detection

**Attestation nonces:** Each `RunnerAttestation.nonce` MUST be a valid
UUID v4. The validator MUST maintain a set of used nonces per session.
Duplicate nonces MUST cause validation failure with error code
`ATTESTATION_INVALID`.

**Approval nonces:** Each `ApprovalSignature.nonce` MUST be a valid
UUID v4. Duplicate nonces MUST cause validation failure with error code
`APPROVAL_REPLAY_DETECTED`.

**Replay verification mode:** During deterministic replay (Section 5.11),
nonce uniqueness checks MAY be skipped, but nonce format validation
MUST still be enforced.

---

## 5. Validation Order

Validation MUST proceed in the following strict sequence. Each step MUST
complete before the next begins. Failure at any step MUST be recorded.
All steps MUST execute; there is no short-circuit termination. The final
verdict is the conjunction of all step results.

### 5.1 Schema Validation

**Inputs:** Raw artifact data.

**Checks:**
- Every artifact MUST conform to its schema (Section 2).
- All required fields MUST be present with correct types.
- All field constraints (length, range, pattern) MUST be satisfied.
- Self-referential hashes (`packageHash`, `packetHash`, `capsuleHash`,
  `responseHash`, `snapshotHash`, `symbolIndexHash`, `bundleHash`) MUST
  match their computed values.
- Unknown fields MUST be preserved (forward compatibility). They MUST NOT
  cause validation failure.

**Failure code:** `SCHEMA_INVALID`

### 5.2 Gate Evaluation

**Inputs:** DoD, Decision Lock.

**Checks (all evaluated, no short-circuit):**
1. DoD MUST exist and contain at least one item.
2. Each DoD item MUST have the structural fields required by its
   `verificationMethod`.
3. Decision Lock MUST exist with `status` = `approved` and
   `approvalMetadata` present.
4. Decision Lock `dodId` MUST reference the DoD's `dodId`.
5. Decision Lock `goal` MUST be non-empty.
6. Decision Lock MUST have at least one `nonGoal` and one `invariant`.
7. Neither DoD nor Decision Lock serialized JSON MUST contain tokens
   `TODO`, `FIXME`, `TBD`, `PLACEHOLDER`, `XXX`.
8. All DoD items MUST be structurally re-verifiable.

**Invariant:** No execution path is permissible unless the gate passes.
This invariant is non-overridable by session state, user intent, or
configuration.

**Failure code:** `GATE_FAILED`

### 5.3 Execution Plan Lint

**Inputs:** Execution Plan, DoD.

**Checks:**
- Plan text MUST NOT contain forbidden substrings (Section 2.3 lint rules).
- Step `references` MUST resolve to DoD item IDs.
- Step `requiredCapabilities` MUST be in the Capability Registry.

**Failure code:** `EXECUTION_PLAN_LINT_FAILED`

### 5.4 Snapshot Validation

**Inputs:** Repo Snapshot.

**Checks:**
- Schema validity.
- `snapshotHash` MUST match computed hash (Section 3.2.3).
- All file paths MUST satisfy path safety rules (Section 3.4).
- Files MUST be sorted by `path`.

**Failure code:** `REPO_SNAPSHOT_INVALID`, `SNAPSHOT_HASH_MISMATCH`

### 5.5 Patch Applicability Proof

**Inputs:** Patch Apply Report, Repo Snapshot.

**Checks:**
- `baseSnapshotHash` MUST equal `RepoSnapshot.snapshotHash`.
- `reportHash` MUST match computed hash.
- All touched file paths MUST satisfy path safety rules.
- If `allowedFiles` is specified, all touched files MUST be within bounds.

**Failure code:** `PATCH_APPLY_FAILED`, `PATCH_BASE_MISMATCH`

### 5.6 Symbol Validation

**Inputs:** Symbol Index, Prompt Capsule boundaries, Model Response.

**Checks:**
- `symbolIndexHash` MUST match computed hash (Section 3.2.6).
- All symbols referenced in the Model Response MUST exist in the Symbol
  Index.
- Import boundaries declared in the Prompt Capsule MUST NOT be violated
  by the Model Response.

**Failure code:** `SYMBOL_INDEX_INVALID`, `SYMBOL_VALIDATION_FAILED`,
`SYMBOL_EXPORT_VIOLATION`, `IMPORT_BOUNDARY_VIOLATION`

### 5.7 Capability Validation

**Inputs:** Runner Evidence, Execution Plan, Capability Registry.

**Checks:**
- Each evidence item's `capabilityUsed` MUST be in the Capability Registry.
- Each evidence item's `capabilityUsed` MUST be in
  `executionPlan.allowedCapabilities` (if defined).
- Each evidence item's `capabilityUsed` MUST be in the step's
  `requiredCapabilities` (if defined).
- If a capability `requiresHumanConfirmation`, the evidence item's
  `humanConfirmationProof` MUST be non-empty.

**Failure code:** `EVIDENCE_VALIDATION_FAILED`

### 5.8 Policy Enforcement

**Inputs:** Policy Set, session context (all artifacts).

**Checks:**
- Each policy rule condition is evaluated against the session context.
- `deny` rules where condition passes → blocking failure.
- `require` rules where condition fails → blocking failure.
- `allow` rules where condition fails and severity is `critical` →
  blocking failure.
- Evaluation errors MUST cause the rule to fail (fail-closed).

**Failure code:** `POLICY_DENIED`, `POLICY_REQUIREMENT_FAILED`,
`POLICY_EVALUATION_FAILED`

### 5.9 Approval Quorum Enforcement

**Inputs:** Approval Bundle, Approval Policy.

**Checks:**
- `bundle.sessionId` MUST equal `policy.sessionId`.
- Each signature MUST pass all enforcement rules (Section 2.14).
- For each approval rule: verified distinct approver count MUST be ≥
  quorum `m`.

**Failure code:** `APPROVAL_QUORUM_NOT_MET`, `APPROVAL_SIGNATURE_INVALID`,
`APPROVAL_REPLAY_DETECTED`

### 5.10 Evidence Chain Validation

**Inputs:** Evidence Chain (ordered array of Runner Evidence), Execution
Plan.

**Checks:**
- Chain structure rules (Section 2.10) MUST hold.
- Each evidence item's hash MUST match its computed value.
- Plan hash binding MUST be consistent across all items.
- Timestamp monotonicity MUST hold.
- Every plan step MUST have at least one evidence item.

**Failure code:** `EVIDENCE_CHAIN_INVALID`, `PLAN_HASH_MISMATCH`

### 5.11 Attestation Verification

**Inputs:** Runner Attestation, Runner Identity, Execution Plan, Evidence
Chain.

**Checks:**
- Full attestation validation sequence (Section 2.12).
- Cryptographic signature verification (Section 3.3).
- Nonce uniqueness (Section 4.4).

**Failure code:** `ATTESTATION_INVALID`, `ATTESTATION_SIGNATURE_INVALID`

### 5.12 Seal Validation

**Inputs:** Sealed Change Package, all referenced artifacts.

**Checks:**
1. `packageHash` MUST match computed SCP hash (Section 3.2.14).
2. For each required hash field: load the referenced artifact, compute
   its hash, and verify equality.
3. For each optional hash field that is present: load the referenced
   artifact, compute its hash, and verify equality.
4. For each array hash field: load all referenced artifacts, compute
   their hashes, sort, and verify set equality.
5. All session boundary checks (Section 4.3) MUST pass.

**Failure code:** `SEAL_INVALID`, `SEAL_MISSING_DEPENDENCY`,
`SEAL_HASH_MISMATCH`, `SEAL_BINDING_VIOLATION`

---

## 6. Failure Semantics

### 6.1 Fail-Closed Requirement

Every validation step MUST be fail-closed. If a check cannot be
evaluated (due to missing data, computation error, or ambiguous state),
the check MUST fail. There is no "inconclusive" state.

### 6.2 No Silent Fallback

A validator MUST NOT silently skip a validation step. If a step cannot
be performed, the validator MUST emit an explicit error.

### 6.3 No Implicit Approval

The absence of a denial is not an approval. Approval requires explicit
cryptographic evidence (signed approval in an Approval Bundle) or
explicit gate passage.

### 6.4 No Inferred Intent

A validator MUST NOT infer intent from artifact content. A Prompt
Capsule that "looks safe" is not a substitute for passing all validation
steps. A Decision Lock that "seems approved" is not approved unless
`status` is `approved` and `approvalMetadata` is present.

### 6.5 Error Reporting

Every validation failure MUST produce a structured error containing:

| Field | Type | Description |
|-------|------|-------------|
| `code` | string | Error code from the defined set |
| `message` | string | Human-readable description |
| `artifactType` | string | The artifact type that failed |
| `field` | string | The specific field that failed (if applicable) |

All errors MUST be collected. The validator MUST NOT terminate at the
first failure. The final result MUST contain the complete set of errors.

### 6.6 Error Code Registry

The following error codes are defined:

**Schema errors:** `SCHEMA_INVALID`

**Gate errors:** `DOD_MISSING`, `LOCK_MISSING`, `LOCK_NOT_APPROVED`,
`GATE_FAILED`

**Lint errors:** `EXECUTION_PLAN_LINT_FAILED`, `STEP_PACKET_LINT_FAILED`,
`PROMPT_CAPSULE_LINT_FAILED`, `MODEL_RESPONSE_LINT_FAILED`,
`FORBIDDEN_TOKEN_DETECTED`

**Hash errors:** `PLAN_HASH_MISMATCH`, `CAPSULE_HASH_MISMATCH`,
`RESPONSE_HASH_MISMATCH`, `SNAPSHOT_HASH_MISMATCH`

**Evidence errors:** `EVIDENCE_VALIDATION_FAILED`,
`EVIDENCE_CHAIN_INVALID`, `EVIDENCE_REQUIRED`

**Attestation errors:** `ATTESTATION_INVALID`,
`ATTESTATION_SIGNATURE_INVALID`, `RUNNER_IDENTITY_INVALID`

**Approval errors:** `APPROVAL_POLICY_INVALID`,
`APPROVAL_BUNDLE_INVALID`, `APPROVAL_SIGNATURE_INVALID`,
`APPROVAL_QUORUM_NOT_MET`, `APPROVAL_REPLAY_DETECTED`

**Policy errors:** `POLICY_INVALID`, `POLICY_EVALUATION_FAILED`,
`POLICY_DENIED`, `POLICY_REQUIREMENT_FAILED`,
`POLICY_FIELD_PATH_INVALID`, `POLICY_OPERATOR_UNSUPPORTED`

**Boundary errors:** `BOUNDARY_VIOLATION`,
`IMPORT_BOUNDARY_VIOLATION`, `SESSION_BOUNDARY_INVALID`

**Symbol errors:** `SYMBOL_INDEX_INVALID`, `SYMBOL_VALIDATION_FAILED`,
`SYMBOL_RESOLUTION_FAILED`, `SYMBOL_EXPORT_VIOLATION`

**Snapshot errors:** `REPO_SNAPSHOT_INVALID`, `SNAPSHOT_HASH_MISSING`

**Patch errors:** `PATCH_APPLY_FAILED`, `PATCH_BASE_MISMATCH`,
`PATCH_ARTIFACT_INVALID`

**Packet errors:** `STEP_PACKET_INVALID`, `STEP_PACKET_EMIT_FAILED`,
`PACKET_RECEIPT_INVALID`

**Seal errors:** `SEAL_INVALID`, `SEAL_MISSING_DEPENDENCY`,
`SEAL_HASH_MISMATCH`, `SEAL_BINDING_VIOLATION`

**Session errors:** `SESSION_NOT_FOUND`, `ID_MISMATCH`,
`MODE_VIOLATION`

**Capsule/Response errors:** `PROMPT_CAPSULE_INVALID`,
`MODEL_RESPONSE_INVALID`

**Replay errors:** `REPLAY_HASH_MISMATCH`, `REPLAY_VALIDATION_FAILED`,
`REPLAY_BUNDLE_INVALID`, `REPLAY_NON_DETERMINISTIC`

**Anchor errors:** `ANCHOR_INVALID`

---

## 7. Non-Execution Guarantee

### 7.1 Core Prohibition

A conformant implementation MUST NOT:

1. Execute shell commands.
2. Spawn child processes.
3. Perform network calls (HTTP, DNS, socket, or otherwise).
4. Mutate the filesystem outside a defined, isolated persistence layer.
5. Interpret any artifact field as an executable instruction.
6. Evaluate artifact content as code in any language runtime.

### 7.2 Data-Only Treatment

All artifacts MUST be treated as structured data. A `verificationCommand`
field in a DoD item is a string value to be recorded, compared, and
hashed — not a command to be executed. A `systemPrompt` in a Prompt
Capsule is a string to be validated against lint rules — not a prompt to
be sent to a model.

### 7.3 Cryptographic Operations

The only computational operations a validator MAY perform are:

1. SHA-256 hash computation over byte strings.
2. RSA signature verification using public keys.
3. JSON parsing, serialization, and canonical normalization.
4. String comparison, pattern matching, and set operations.

No other computation is required or permitted for validation.

### 7.4 Persistence Boundary

If a conformant implementation persists artifacts, it MUST do so in an
isolated directory hierarchy. Artifact paths MUST be derived from
content-addressed identifiers (SHA-256 hashes or UUIDs), never from
user-supplied path strings.

---

## 8. Versioning

### 8.1 Schema Version

Every artifact that contains a `schemaVersion` field MUST set it to the
protocol's current schema version string. The current schema version is
`"1.0.0"`.

Validators MUST reject artifacts whose `schemaVersion` does not match
the validator's supported version, unless the validator implements
version migration (Section 8.4).

### 8.2 Protocol Version

The protocol version follows semantic versioning (MAJOR.MINOR.PATCH).

- **MAJOR:** Incremented for breaking changes to hash computation,
  validation order, or artifact schemas that alter hash output.
- **MINOR:** Incremented for new optional artifacts, new optional fields
  on existing artifacts, or new error codes.
- **PATCH:** Incremented for clarifications that do not alter validation
  behavior.

### 8.3 Backward Compatibility

A MINOR version increment MUST NOT:
- Change the hash computation of any existing artifact.
- Remove any existing required field.
- Change the validation order.
- Alter the semantics of any existing error code.

A MINOR version increment MAY:
- Add new optional fields to existing artifacts.
- Add new optional artifacts.
- Add new error codes.
- Add new capability registry entries.

### 8.4 Migration

Implementations MAY support version migration by registering migration
functions keyed by `(artifactType, fromVersion, toVersion)`. Each
migration MUST be a pure function. Duplicate registrations MUST be
rejected.

### 8.5 Forward Compatibility

All artifact schemas MUST preserve unknown fields. A validator MUST NOT
reject an artifact solely because it contains fields not defined in the
validator's schema version. Unknown fields MUST NOT participate in hash
computation unless explicitly specified by a future schema version.

---

## 9. Conformance Requirements

### 9.1 ClawForge Protocol Conformant

An implementation is **Protocol Conformant** if it:

1. Implements all artifact schemas defined in Section 2.
2. Implements all hash computations defined in Section 3.
3. Implements canonical JSON normalization per Section 3.1.
4. Produces identical hash values for identical canonical JSON input.
5. Preserves unknown fields in all artifact schemas.

### 9.2 ClawForge Validator Conformant

An implementation is **Validator Conformant** if it is Protocol
Conformant and additionally:

1. Implements all 12 validation steps in Section 5, in the specified
   order.
2. Implements fail-closed semantics per Section 6.
3. Implements all error codes defined in Section 6.6.
4. Collects all errors (no short-circuit termination).
5. Satisfies the non-execution guarantee (Section 7).
6. Correctly validates all required and optional artifact bindings
   (Section 4).
7. Enforces replay detection per Section 4.4.

**Mandatory features:** All validation steps, all error codes, fail-closed
semantics, non-execution guarantee.

**Optional features:** Version migration (Section 8.4), extension artifact
validation (Section 11).

### 9.3 ClawForge Runner Conformant

An implementation is **Runner Conformant** if it:

1. Produces valid Runner Evidence items that conform to Section 2.9.
2. Produces a valid Evidence Chain per Section 2.10.
3. Produces a valid Runner Identity per Section 2.11.
4. Produces a valid Runner Attestation per Section 2.12 with a
   cryptographically valid signature.
5. Uses only capabilities declared in the Capability Registry.
6. Binds all evidence items to the correct `planHash`.
7. Maintains evidence chain integrity (correct `prevEvidenceHash`
   linkage and timestamp monotonicity).

A Runner Conformant implementation is NOT required to implement
validation. Runners produce artifacts; validators verify them.

---

## 10. Security Model

### 10.1 Threat Assumptions

This protocol assumes the following threat model:

1. **Untrusted artifacts:** Any artifact MAY have been tampered with
   between production and validation.
2. **Untrusted transport:** The channel between artifact producer and
   validator provides no integrity guarantees.
3. **Trusted validator:** The validator implementation itself is assumed
   to be correct. Validator integrity is outside this protocol's scope.
4. **Trusted public keys:** Public keys in Approval Policies and Runner
   Identities are assumed to be authentic. Key distribution is outside
   this protocol's scope.

### 10.2 Tampering Model

**Content tampering:** Detected by hash mismatch. Every artifact's
content is bound to its hash. Modifying any included field changes the
hash.

**Self-referential integrity:** Artifacts with self-referential hashes
(`packageHash`, `packetHash`, `capsuleHash`, `responseHash`,
`snapshotHash`, `symbolIndexHash`, `bundleHash`) authenticate themselves.
The hash is computed over all fields except the hash field itself.

**Excluded-field semantics:** Fields excluded from hash computation
(e.g., `approvalMetadata` in Decision Lock, `signature` in Attestation)
are explicitly defined per artifact. Modifications to excluded fields
do not affect the hash. This is by design: `approvalMetadata` is added
after the lock content is committed to; `signature` is the cryptographic
output, not input.

### 10.3 Replay Resistance

**Attestation replay:** Each Runner Attestation contains a `nonce`
(UUID v4). Validators MUST track used nonces per session and reject
duplicates.

**Approval replay:** Each Approval Signature contains a `nonce`
(UUID v4). Validators MUST track used nonces and reject duplicates.

**Cross-session replay:** Session ID binding (Section 4.3) prevents
artifacts produced for one session from being accepted in another.

### 10.4 Identity Spoofing Protection

Runner Identity is bound to the Attestation via `identityHash`. The
attestation is signed with the runner's private key. An attacker cannot
substitute a different Runner Identity without invalidating the
attestation signature.

Approver identity is bound to the Approval Signature via the approver's
public key in the Approval Policy. An attacker cannot forge a signature
without the approver's private key.

### 10.5 Artifact Substitution Attack Prevention

**Within-session substitution:** Each artifact's hash is bound into the
SCP. Replacing artifact A with artifact A' changes A's hash, which
mismatches the SCP's recorded hash for A.

**Cross-session substitution:** Session ID binding prevents artifacts
from session X from being inserted into session Y's SCP.

**Plan substitution:** The Execution Plan hash is bound into the
Decision Lock, Prompt Capsule, Step Packets, Runner Attestation,
Session Anchor, and all evidence items. Substituting a different plan
breaks multiple independent bindings simultaneously.

### 10.6 Plan Drift Detection

Plan drift occurs when execution deviates from the declared plan.
Detection mechanisms:

1. Evidence items bind to `planHash` — a changed plan invalidates all
   evidence.
2. Step Packets bind to `planHash`, `capsuleHash`, and `snapshotHash` —
   drift in any input artifact is detected.
3. The evidence chain ensures chronological ordering — retroactive
   insertion of evidence is detectable via chain linkage and timestamp
   monotonicity.

### 10.7 Model Drift Detection

Model drift occurs when the AI model's behavior changes between
invocations. Detection mechanisms:

1. Prompt Capsule binds `temperature: 0` and `topP: 1` — non-deterministic
   model parameters are prohibited.
2. Prompt Capsule records `model.seed` — deterministic seeding is required.
3. Model Response Artifact records `model.provider`, `model.modelId`, and
   `model.seed` — the exact model invocation context is preserved.
4. The Model Response hash binds the output to the recorded model
   configuration — substituting output from a different model or
   configuration changes the hash.

### 10.8 Redaction

Implementations that persist or transmit artifacts MUST redact sensitive
values. The following patterns identify sensitive content:

**Key patterns (case-insensitive):** `password`, `secret`, `token`,
`api_key`, `apikey`, `api-key`, `authorization`.

**Value prefixes:** `sk-`, `pk-`, `token-`, `key-`, `bearer `, `ghp_`,
`gho_`, `AKIA`.

**Base64 heuristic:** Strings of 40+ characters matching
`[A-Za-z0-9+/=_-]{40,}` with mixed case and digits.

Sensitive values MUST be replaced with `"[REDACTED]"`. Redaction MUST
be recursive and non-mutating (the original artifact is not modified;
a redacted copy is produced).

---

## 11. Extension Mechanism

### 11.1 Extension Artifact Registration

New artifact types MAY be introduced without modifying the core protocol.
An extension artifact MUST declare:

| Field | Type | Description |
|-------|------|-------------|
| `extensionId` | string | Globally unique type identifier |
| `schemaVersion` | string | Extension schema version |
| `hashAlgorithm` | string | MUST be `SHA-256` |
| `hashExclusions` | array of string | Fields excluded from hash computation |
| `bindingTargets` | array of BindingTarget | Artifacts this extension binds to |

**BindingTarget:** `{ artifactType: string, fieldName: string }` — declares
that this extension's hash MUST appear in the specified field of the
specified artifact type.

### 11.2 SCP Extension Slot

The Sealed Change Package MUST support an `extensions` map for extension
artifact hashes:

```
"extensions": {
  "<extensionId>": {
    "hash": sha256hex,
    "schemaVersion": string
  }
}
```

The `extensions` field is OPTIONAL. When present, its contents MUST
participate in the SCP hash computation. Extensions MUST be sorted by
`extensionId` for deterministic hashing.

### 11.3 Core Guarantee Preservation

Extension artifacts:

1. MUST NOT alter the hash computation of any core artifact.
2. MUST NOT change the validation order of core steps (Section 5).
3. MUST NOT weaken fail-closed semantics.
4. MUST NOT introduce execution surfaces.
5. MUST use SHA-256 as their hash algorithm.
6. MUST follow canonical JSON normalization (Section 3.1).
7. MUST declare all hash exclusions explicitly.

Extension validation, if performed, MUST occur after all 12 core
validation steps complete.

### 11.4 Unknown Extension Handling

A validator that encounters an extension it does not recognize MUST:

1. Preserve the extension data (forward compatibility).
2. Record a warning (not an error).
3. NOT fail validation solely due to unrecognized extensions.
4. NOT attempt to validate the extension's hash binding.

A validator that implements a recognized extension MUST validate it with
the same rigor as core artifacts: hash verification, binding validation,
and fail-closed semantics.

---

## 12. Formal Invariants

The following invariants MUST hold for any valid Sealed Change Package.
Violation of any invariant MUST cause validation failure.

**INV-1: Hash Binding.** Every artifact MUST be hash-bound to its
dependencies as defined in Section 4.1. A hash mismatch between an
artifact's recorded hash and its computed hash MUST cause failure.

**INV-2: Chain Integrity.** Every evidence item MUST be chain-bound.
The first item's `prevEvidenceHash` MUST be `null`. Each subsequent
item's `prevEvidenceHash` MUST equal the preceding item's computed
`evidenceHash`.

**INV-3: Attestation Binding.** Every Runner Attestation MUST bind
`planHash` (Execution Plan hash), `identityHash` (Runner Identity hash),
and `evidenceChainTailHash` (last evidence item's hash). All three
bindings MUST verify.

**INV-4: Seal Completeness.** Every Sealed Change Package MUST bind all
required artifacts (Section 2.16). The `packageHash` MUST equal the
computed hash of the SCP itself.

**INV-5: Deterministic Verification.** No artifact MAY be accepted
without deterministic verification. Verification MUST be a pure function
from artifacts to verdict. Given identical input artifacts, the verdict
MUST be identical.

**INV-6: Gate Authority.** No execution is permissible unless the
Execution Gate passes. Session state, user intent, configuration, and
external signals MUST NOT override a failed gate.

**INV-7: Session Isolation.** No artifact from session A MAY participate
in the validation of session B. Session ID binding MUST be enforced on
every artifact that contains a `sessionId` field.

**INV-8: Capability Closure.** Every `capabilityUsed` value in Runner
Evidence MUST exist in the Capability Registry. No dynamic capability
creation is permitted.

**INV-9: Approval Distinctness.** Approval rules MUST require distinct
approvers (`requireDistinctApprovers` MUST be `true`). A single approver
MUST NOT satisfy multiple slots in a quorum.

**INV-10: Timestamp Monotonicity.** Evidence chain timestamps MUST be
monotonically non-decreasing. Attestation `createdAt` MUST be ≥ the
last evidence item's `timestamp`.

**INV-11: Non-Execution.** A conformant validator MUST NOT execute code,
spawn processes, or perform network calls. All artifacts are data.

**INV-12: Fail-Closed.** Every ambiguous, missing, or error state MUST
resolve to failure. There is no "pass by default" path.

---

## Appendix A — Deterministic Replay

### A.1 Purpose

Deterministic replay allows an independent party to re-derive the
validation verdict from a complete artifact set without access to the
original validator's state.

### A.2 Replay Procedure

1. Recompute `planHash` from the Execution Plan. Compare with stored
   plan hash references.
2. For each evidence item: recompute `evidenceHash`. Compare with stored
   value. Validate `planHash` binding. Validate chain linkage.
3. If Runner Identity is present: recompute `identityHash`. Compare with
   attestation's `identityHash`.
4. If Runner Attestation is present: recompute attestation payload hash.
   Verify signature. Validate `planHash` and `evidenceChainTailHash`
   bindings. Skip nonce uniqueness (replay mode).
5. If policies are present: re-evaluate all policies against the artifact
   context. Recompute `policySetHash` and `policyEvaluationHash`.
6. If Session Anchor is present: validate all anchor fields against
   computed hashes.

### A.3 Replay Verdict

`deterministicReplayPassed` = `mismatches.length === 0` AND
`attestationValid` AND `anchorValid` AND (`policyVerdict` is absent OR
`policyVerdict.passed`).

---

## Appendix B — Audit Event Store

### B.1 Purpose

The audit event store provides an append-only, hash-chained log of all
session events. It is an implementation-level component, not a protocol
artifact, but conformant implementations that persist audit logs MUST
follow these rules.

### B.2 Event Schema

| Field | Type | Description |
|-------|------|-------------|
| `runId` | string | Run identifier |
| `seq` | integer | Sequence number (starts at 1, increments by 1) |
| `eventId` | string | Globally unique event identifier |
| `ts` | iso8601utc | Event timestamp |
| `type` | string | Event type |
| `schemaVersion` | string | Event schema version |
| `actor` | actor | Event producer |
| `payload` | object | Event-specific data |
| `prevHash` | sha256hex nullable | Hash of preceding event (null for seq=1) |
| `hash` | sha256hex | Hash of this event |

### B.3 Append Invariants

1. `seq` MUST increment by exactly 1. No gaps, no reuse.
2. `prevHash` MUST equal the `hash` of the event at `seq - 1`. For
   `seq = 1`, `prevHash` MUST be `null`.
3. `hash` MUST equal SHA-256 of canonical JSON of the event excluding
   `hash` and `prevHash`.
4. The first event (`seq = 1`) MUST have `type = "RunStarted"`.
5. `eventId` MUST be globally unique.
6. No UPDATE or DELETE operations are permitted on the event store.

### B.4 Chain Verification

For each event in ascending `seq` order:
1. Recompute hash. Compare to stored `hash`.
2. Check `prevHash`: `null` for first event, matching previous `hash`
   for all others.
3. Check `seq` = expected (no gaps).

**Error codes:** `hash_mismatch`, `prevHash_mismatch`,
`first_event_prevHash_not_null`, `seq_gap`.

---

*End of Specification*
