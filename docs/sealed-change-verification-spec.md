# Sealed Change Package Verification Specification

## Overview

This document specifies the deterministic verification algorithm for Sealed Change Packages (SCP). The specification enables independent reimplementation of the verification logic without dependencies on ClawForge's session management layer.

## Canonical JSON

All hash computations use canonical JSON serialization as defined in `src/audit/canonical.ts`. The algorithm guarantees:

1. **Key Sorting**: Object keys are sorted lexicographically at every nesting level
2. **Undefined Handling**: `undefined` values are omitted (never serialized as `null`)
3. **Date Serialization**: Dates are serialized as ISO 8601 UTC strings (`YYYY-MM-DDTHH:mm:ss.sssZ`)
4. **Null Preservation**: `null` values are preserved as `null`
5. **Array Ordering**: Array element order is preserved
6. **Determinism**: Identical logical input produces byte-identical output

### Pseudocode

```
function canonicalJson(value):
  return JSON.stringify(toSortedValue(value))

function toSortedValue(value):
  if value is null or undefined:
    return value (undefined will be dropped by JSON.stringify)
  
  if value is Date:
    return value.toISOString()
  
  if value is Array:
    return value.map(toSortedValue)
  
  if value is Object:
    sorted = {}
    for each key in sorted(Object.keys(value)):
      if value[key] !== undefined:
        sorted[key] = toSortedValue(value[key])
    return sorted
  
  return value (string, number, boolean)
```

## Hash Computation

All hashes are computed as SHA-256 of the canonical JSON representation of the normalized artifact.

### SHA-256 Algorithm

```
hash = SHA256(canonicalJson(normalize(artifact)))
```

The hash is represented as a 64-character lowercase hexadecimal string.

## Artifact Hash Computation Rules

### Decision Lock Hash

**Source**: `src/session/decision-lock-hash.ts`

**Normalization Rules**:
- Exclude `approvalMetadata` field
- Sort arrays: `nonGoals`, `invariants`, `constraints`
- Sort object keys within `interfaces` and `failureModes` arrays
- Sort `risksAndTradeoffs` array

**Fields Included**:
- `schemaVersion`
- `lockId`
- `sessionId`
- `dodId`
- `goal`
- `nonGoals` (sorted)
- `interfaces` (keys sorted)
- `invariants` (sorted)
- `constraints` (sorted)
- `failureModes` (keys sorted)
- `risksAndTradeoffs` (sorted)
- `status`
- `createdAt`
- `createdBy`

**Test Vector**:
```json
{
  "schemaVersion": "1.0.0",
  "lockId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "sessionId": "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  "dodId": "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
  "goal": "Implement feature X",
  "nonGoals": [],
  "interfaces": [],
  "invariants": [],
  "constraints": [],
  "failureModes": [],
  "risksAndTradeoffs": [],
  "status": "approved",
  "createdAt": "2026-02-11T12:00:00.000Z",
  "createdBy": {"actorId": "user1", "actorType": "human"}
}
```

### Execution Plan Hash

**Source**: `src/session/plan-hash.ts`

**Normalization Rules**:
- Exclude `planHash` field if present
- Sort `steps` array by `stepId`
- Sort `allowedCapabilities` array
- Sort object keys within step objects

**Fields Included**:
- `sessionId` (if present)
- `dodId` (if present)
- `lockId` (if present)
- `steps` (sorted by stepId)
- `allowedCapabilities` (sorted, if present)

### Prompt Capsule Hash

**Source**: `src/session/prompt-capsule.ts`

**Normalization Rules**:
- Exclude `hash.capsuleHash` field
- Sort arrays: `boundaries.allowedFiles`, `boundaries.allowedSymbols`, `boundaries.allowedDoDItems`, `boundaries.allowedPlanStepIds`, `boundaries.allowedCapabilities`, `boundaries.disallowedPatterns`, `boundaries.allowedExternalModules`
- Sort `inputs.fileDigests` by `path`

**Fields Included**:
- All fields except `hash.capsuleHash`
- Arrays sorted as specified above

### Repo Snapshot Hash

**Source**: `src/session/repo-snapshot.ts`

**Normalization Rules**:
- Exclude `snapshotHash` field
- Sort `includedFiles` array by `path`

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `snapshotId`
- `generatedAt`
- `rootDescriptor`
- `includedFiles` (sorted by path)

### Step Packet Hash

**Source**: `src/session/step-packet.ts`

**Normalization Rules**:
- Exclude `packetHash` field
- Sort arrays: `dodItemRefs`, `allowedFiles`, `allowedSymbols`, `requiredCapabilities`, `reviewerSequence`
- Sort `context.fileDigests` by `path`
- Sort `context.excerpts` by `path`, then `startLine`

**Fields Included**:
- All fields except `packetHash`
- Arrays sorted as specified above

### Evidence Chain Hash

**Source**: `src/session/evidence-chain.ts`

**Normalization Rules**:
- Exclude `evidenceHash` field
- Sort object keys within evidence objects

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `stepId`
- `evidenceId`
- `timestamp`
- `evidenceType`
- `artifactHash`
- `verificationMetadata` (keys sorted)
- `capabilityUsed`
- `humanConfirmationProof`
- `planHash` (if present)
- `prevEvidenceHash` (if present)

### Patch Artifact Hash

**Normalization Rules**:
- Sort `filesChanged` array by `path`
- Sort `declaredImports` array
- Sort `declaredNewDependencies` array

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `stepId`
- `patchId`
- `filesChanged` (sorted by path)
- `declaredImports` (sorted)
- `declaredNewDependencies` (sorted)

### Patch Apply Report Hash

**Normalization Rules**:
- Exclude `reportHash` field
- Sort `touchedFiles` array by `path`
- Sort `conflicts` array by `filePath`, then `hunkIndex`

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `patchId`
- `baseSnapshotHash`
- `applied`
- `touchedFiles` (sorted by path)
- `conflicts` (sorted by filePath, then hunkIndex)

### Reviewer Report Hash

**Normalization Rules**:
- Sort `violations` array
- Sort `notes` array

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `stepId`
- `reviewerRole`
- `passed`
- `violations` (sorted)
- `notes` (sorted)

### Attestation Payload Hash

**Source**: `src/session/runner-attestation.ts`

**Normalization Rules**:
- Exclude `signature` field
- Exclude `attestationHash` field if present

**Fields Included**:
- `sessionId`
- `planHash`
- `lockId`
- `runnerId`
- `identityHash`
- `evidenceChainTailHash`
- `nonce`
- `signatureAlgorithm`
- `createdAt`

### Approval Signature Payload Hash

**Source**: `src/session/approval-bundle.ts`

**Normalization Rules**:
- Exclude `signature` field
- Exclude `payloadHash` field

**Fields Included**:
- `signatureId`
- `approverId`
- `role`
- `algorithm`
- `artifactType`
- `artifactHash`
- `sessionId`
- `timestamp`
- `nonce`

### Approval Bundle Hash

**Source**: `src/session/approval-bundle.ts`

**Normalization Rules**:
- Exclude `bundleHash` field
- Sort `signatures` array by `signatureId`

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `bundleId`
- `signatures` (sorted by signatureId)

### Symbol Index Hash

**Normalization Rules**:
- Sort `exports` array by `filePath`, then `symbolName`
- Sort `imports` array by `filePath`, then `symbolName`

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `generatedAt`
- `exports` (sorted)
- `imports` (sorted)

### Policy Evaluation Hash

**Normalization Rules**:
- Sort `ruleResults` array by `ruleId`

**Fields Included**:
- All fields from PolicyEvaluationResult
- `ruleResults` sorted by `ruleId`

### Policy Set Hash

**Normalization Rules**:
- Sort policies array by `policyId`

**Fields Included**:
- Array of policies, sorted by `policyId`
- Each policy normalized according to Policy schema

### Runner Identity Hash

**Normalization Rules**:
- Sort object keys

**Fields Included**:
- All fields from RunnerIdentity schema

### Session Anchor Hash

**Normalization Rules**:
- Sort `evidenceHashes` array

**Fields Included**:
- `schemaVersion`
- `sessionId`
- `anchorId`
- `createdAt`
- `createdBy`
- `evidenceHashes` (sorted)
- `planHash`

## Sealed Change Package Hash

**Source**: `src/session/sealed-change-package.ts`

**Normalization Rules**:
- Exclude `packageHash` field
- Sort all hash arrays lexicographically:
  - `stepPacketHashes`
  - `patchArtifactHashes`
  - `reviewerReportHashes`
  - `evidenceChainHashes`
- Include optional fields only if present (don't include `undefined`)

**Fields Included** (in order):
- `schemaVersion`
- `sessionId`
- `sealedAt`
- `sealedBy`
- `decisionLockHash`
- `planHash`
- `capsuleHash`
- `snapshotHash`
- `stepPacketHashes` (sorted)
- `patchArtifactHashes` (sorted)
- `reviewerReportHashes` (sorted)
- `evidenceChainHashes` (sorted)
- Optional fields (if present):
  - `policySetHash`
  - `policyEvaluationHash`
  - `symbolIndexHash`
  - `patchApplyReportHash`
  - `runnerIdentityHash`
  - `attestationHash`
  - `approvalPolicyHash`
  - `approvalBundleHash`
  - `anchorHash`

**Algorithm**:
```
function computeSealedChangePackageHash(scp):
  normalized = {
    schemaVersion: scp.schemaVersion,
    sessionId: scp.sessionId,
    sealedAt: scp.sealedAt,
    sealedBy: scp.sealedBy,
    decisionLockHash: scp.decisionLockHash,
    planHash: scp.planHash,
    capsuleHash: scp.capsuleHash,
    snapshotHash: scp.snapshotHash,
    stepPacketHashes: sorted(scp.stepPacketHashes),
    patchArtifactHashes: sorted(scp.patchArtifactHashes),
    reviewerReportHashes: sorted(scp.reviewerReportHashes),
    evidenceChainHashes: sorted(scp.evidenceChainHashes)
  }
  
  // Add optional fields if present
  if scp.policySetHash:
    normalized.policySetHash = scp.policySetHash
  if scp.policyEvaluationHash:
    normalized.policyEvaluationHash = scp.policyEvaluationHash
  // ... (repeat for all optional fields)
  
  return SHA256(canonicalJson(normalized))
```

## Evidence Chain Linking

### Chain Structure

Evidence items form a linked list via `prevEvidenceHash`:

- First item: `prevEvidenceHash` must be `null`
- Subsequent items: `prevEvidenceHash` must equal the `evidenceHash` of the previous item
- All items: `planHash` must match the Execution Plan hash

### Validation Algorithm

```
function validateEvidenceChain(evidenceList, plan):
  planHash = computePlanHash(plan)
  prevHash = null
  
  for i = 0 to evidenceList.length - 1:
    evidence = evidenceList[i]
    
    // Check planHash matches
    if evidence.planHash !== planHash:
      error("planHash mismatch")
    
    // Check prevEvidenceHash links correctly
    if i === 0:
      if evidence.prevEvidenceHash !== null:
        error("first evidence must have null prevEvidenceHash")
    else:
      computedPrevHash = computeEvidenceHash(evidenceList[i-1])
      if evidence.prevEvidenceHash !== computedPrevHash:
        error("prevEvidenceHash mismatch")
    
    // Check evidenceHash matches computed hash
    computedHash = computeEvidenceHash(evidence)
    if evidence.evidenceHash !== computedHash:
      error("evidenceHash mismatch")
    
    // Check timestamp monotonicity
    if i > 0 and evidence.timestamp < evidenceList[i-1].timestamp:
      error("timestamp not monotonic")
    
    prevHash = computedHash
```

## Patch Apply Proof

### Base Snapshot Binding

The `PatchApplyReport.baseSnapshotHash` must match the `RepoSnapshot.snapshotHash` referenced in the SCP.

### Hash Computation

The `PatchApplyReport.reportHash` is computed from the report excluding the `reportHash` field itself.

## Attestation Signature Verification

### Payload Hash

The attestation signature signs the payload hash computed from normalized attestation (excluding signature).

### Signature Verification

```
function verifyAttestationSignature(attestation, runnerIdentity):
  payloadHash = computeAttestationPayloadHash(attestation)
  signature = base64Decode(attestation.signature)
  publicKey = parsePublicKey(runnerIdentity.runnerPublicKey)
  
  algorithm = mapSignatureAlgorithm(attestation.signatureAlgorithm)
  // algorithm: "sha256" -> "RSA-SHA256", etc.
  
  verify = createVerify(algorithm)
  verify.update(payloadHash, "hex")
  
  if not verify.verify(publicKey, signature):
    error("signature invalid")
```

### Identity Hash Binding

The `attestation.identityHash` must match the hash of the `RunnerIdentity` artifact.

## Approval Signature Verification

### Payload Hash

Each approval signature signs a payload hash computed from normalized signature (excluding signature and payloadHash).

### Signature Verification

```
function verifyApprovalSignature(signature, approverPublicKey):
  payloadHash = computeSignaturePayloadHash(signature)
  signatureBytes = base64Decode(signature.signature)
  publicKey = parsePublicKey(approverPublicKey)
  
  algorithm = mapSignatureAlgorithm(signature.algorithm)
  verify = createVerify(algorithm)
  verify.update(payloadHash, "hex")
  
  if not verify.verify(publicKey, signatureBytes):
    error("signature invalid")
```

### Artifact Hash Binding

Each signature's `artifactHash` must match the hash of the artifact it approves (e.g., DecisionLock hash for `artifactType: "decision_lock"`).

## File Path Normalization

All file paths in artifacts must be normalized:

1. No path traversal (`..`)
2. No absolute paths (must be relative)
3. No backslashes (use forward slashes)
4. POSIX-style paths

## Verification Algorithm

### High-Level Flow

```
function verifySealedChangePackage(sessionDir):
  1. Load sealed-change-package.json
  2. Validate SCP structure (schema validation)
  3. Verify packageHash matches computed hash
  4. Load and verify each required artifact:
     - DecisionLock
     - ExecutionPlan
     - PromptCapsule
     - RepoSnapshot
     - StepPackets (from packets/step-*.json)
     - PatchArtifacts (from patch-step-*.json or patch-*.json)
     - ReviewerReports (from reviewer-*-*.json)
     - EvidenceChain (from runner-evidence.json)
  5. Load and verify optional artifacts (if hash present in SCP):
     - PolicySet, PolicyEvaluation, SymbolIndex, etc.
  6. Cross-validate bindings:
     - Evidence chain linking
     - Attestation signature (if present)
     - Approval signatures (if present)
     - Patch apply report binding
  7. Return verification result
```

### Error Collection

All validation errors are collected (non-fail-fast) and returned in a structured report.

## Test Vectors

### Minimal Valid SCP

```json
{
  "schemaVersion": "1.0.0",
  "sessionId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "sealedAt": "2026-02-11T12:00:00.000Z",
  "sealedBy": {"actorId": "user1", "actorType": "human"},
  "packageHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "decisionLockHash": "1111111111111111111111111111111111111111111111111111111111111111",
  "planHash": "2222222222222222222222222222222222222222222222222222222222222222",
  "capsuleHash": "3333333333333333333333333333333333333333333333333333333333333333",
  "snapshotHash": "4444444444444444444444444444444444444444444444444444444444444444",
  "stepPacketHashes": [],
  "patchArtifactHashes": [],
  "reviewerReportHashes": [],
  "evidenceChainHashes": []
}
```

Note: Actual hashes would be computed from artifact contents.

## Implementation Notes

- All hash computations must be deterministic
- Arrays must be sorted consistently
- Optional fields must be handled correctly (present vs. absent)
- File paths must be normalized
- Timestamps must be ISO 8601 UTC
- All validation must be read-only (no mutations)

## References

- `src/audit/canonical.ts` - Canonical JSON implementation
- `src/session/crypto.ts` - SHA-256 hashing
- `src/session/sealed-change-package.ts` - SCP schema and hash computation
- `src/session/decision-lock-hash.ts` - Decision Lock hash computation
- `src/session/plan-hash.ts` - Execution Plan hash computation
- `src/session/prompt-capsule.ts` - Prompt Capsule hash computation
- `src/session/repo-snapshot.ts` - Repo Snapshot hash computation
- `src/session/step-packet.ts` - Step Packet hash computation
- `src/session/evidence-chain.ts` - Evidence hash computation
- `src/session/runner-attestation.ts` - Attestation payload hash computation
- `src/session/approval-bundle.ts` - Approval bundle hash computation
