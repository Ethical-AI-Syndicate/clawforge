/**
 * Sealed Change Package Schema — cryptographically verifiable session envelope.
 *
 * Phase P: Binds all session artifacts into a single sealed package with
 * deterministic hash computation for complete lifecycle integrity verification.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "./crypto.js";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso8601Utc = z
  .string()
  .regex(ISO8601_RE, "Must be ISO 8601 UTC datetime")
  .refine((s) => !isNaN(Date.parse(s)), "Must be parseable datetime");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const sha256HexString = z
  .string()
  .regex(SHA256_HEX_RE, "Must be 64-char lowercase hex SHA-256");

const schemaVersion = z
  .string()
  .refine(
    (v) => v === SESSION_SCHEMA_VERSION,
    `schemaVersion must be exactly "${SESSION_SCHEMA_VERSION}"`,
  );

const actorSchema = z.object({
  actorId: z.string().min(1),
  actorType: z.enum(["human", "system"]),
}).passthrough();

// ---------------------------------------------------------------------------
// Sealed Change Package Schema
// ---------------------------------------------------------------------------

export const SealedChangePackageSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    sealedAt: iso8601Utc,
    sealedBy: actorSchema,
    packageHash: sha256HexString,
    
    // Core artifacts (required)
    decisionLockHash: sha256HexString,
    planHash: sha256HexString,
    capsuleHash: sha256HexString,
    snapshotHash: sha256HexString,
    
    // Policy artifacts (optional)
    policySetHash: sha256HexString.optional(),
    policyEvaluationHash: sha256HexString.optional(),
    
    // Symbol and boundary artifacts (optional)
    symbolIndexHash: sha256HexString.optional(),
    
    // Step packets (required, array of hashes)
    stepPacketHashes: z.array(sha256HexString).min(0),
    
    // Patch artifacts (required, parallel to step packets)
    patchArtifactHashes: z.array(sha256HexString).min(0),
    patchApplyReportHash: sha256HexString.optional(),
    
    // Reviewer artifacts (required, array of hashes)
    reviewerReportHashes: z.array(sha256HexString).min(0),
    
    // Evidence chain (required, array of hashes)
    evidenceChainHashes: z.array(sha256HexString).min(0),
    
    // Runner artifacts (optional)
    runnerIdentityHash: sha256HexString.optional(),
    attestationHash: sha256HexString.optional(),
    
    // Approval artifacts (optional)
    approvalPolicyHash: sha256HexString.optional(),
    approvalBundleHash: sha256HexString.optional(),
    
    // Anchor (optional)
    anchorHash: sha256HexString.optional(),
  })
  .passthrough()
  .refine(
    (pkg) => {
      const computed = computeSealedChangePackageHash(pkg);
      return pkg.packageHash === computed;
    },
    {
      message: "packageHash must equal computed hash",
      path: ["packageHash"],
    },
  );

export type SealedChangePackage = z.infer<typeof SealedChangePackageSchema>;

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute sealed change package hash from normalized package (excluding packageHash field).
 *
 * @param pkg - Sealed change package to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeSealedChangePackageHash(
  pkg: SealedChangePackage,
): string {
  const normalized = normalizeSealedChangePackage(pkg);
  const canonical = canonicalJson(normalized);
  return sha256Hex(canonical);
}

/**
 * Normalize sealed change package for hashing (excludes packageHash field).
 */
function normalizeSealedChangePackage(
  pkg: SealedChangePackage,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    schemaVersion: pkg.schemaVersion,
    sessionId: pkg.sessionId,
    sealedAt: pkg.sealedAt,
    sealedBy: pkg.sealedBy,
    decisionLockHash: pkg.decisionLockHash,
    planHash: pkg.planHash,
    capsuleHash: pkg.capsuleHash,
    snapshotHash: pkg.snapshotHash,
    stepPacketHashes: [...pkg.stepPacketHashes].sort(),
    patchArtifactHashes: [...pkg.patchArtifactHashes].sort(),
    reviewerReportHashes: [...pkg.reviewerReportHashes].sort(),
    evidenceChainHashes: [...pkg.evidenceChainHashes].sort(),
  };

  // Include optional fields if present
  if (pkg.policySetHash) {
    normalized.policySetHash = pkg.policySetHash;
  }
  if (pkg.policyEvaluationHash) {
    normalized.policyEvaluationHash = pkg.policyEvaluationHash;
  }
  if (pkg.symbolIndexHash) {
    normalized.symbolIndexHash = pkg.symbolIndexHash;
  }
  if (pkg.patchApplyReportHash) {
    normalized.patchApplyReportHash = pkg.patchApplyReportHash;
  }
  if (pkg.runnerIdentityHash) {
    normalized.runnerIdentityHash = pkg.runnerIdentityHash;
  }
  if (pkg.attestationHash) {
    normalized.attestationHash = pkg.attestationHash;
  }
  if (pkg.approvalPolicyHash) {
    normalized.approvalPolicyHash = pkg.approvalPolicyHash;
  }
  if (pkg.approvalBundleHash) {
    normalized.approvalBundleHash = pkg.approvalBundleHash;
  }
  if (pkg.anchorHash) {
    normalized.anchorHash = pkg.anchorHash;
  }

  // Include passthrough fields but exclude packageHash
  const allKeys = Object.keys(pkg).sort();
  for (const key of allKeys) {
    if (
      key === "schemaVersion" ||
      key === "sessionId" ||
      key === "sealedAt" ||
      key === "sealedBy" ||
      key === "decisionLockHash" ||
      key === "planHash" ||
      key === "capsuleHash" ||
      key === "snapshotHash" ||
      key === "policySetHash" ||
      key === "policyEvaluationHash" ||
      key === "symbolIndexHash" ||
      key === "stepPacketHashes" ||
      key === "patchArtifactHashes" ||
      key === "patchApplyReportHash" ||
      key === "reviewerReportHashes" ||
      key === "evidenceChainHashes" ||
      key === "runnerIdentityHash" ||
      key === "attestationHash" ||
      key === "approvalPolicyHash" ||
      key === "approvalBundleHash" ||
      key === "anchorHash" ||
      key === "packageHash" // Exclude packageHash
    ) {
      continue;
    }
    normalized[key] = pkg[key as keyof SealedChangePackage];
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Structure validation
// ---------------------------------------------------------------------------

/**
 * Validate sealed change package structure.
 *
 * @param pkg - Package to validate
 * @throws SessionError with code SEAL_INVALID on failure
 */
export function validateSealedChangePackageStructure(
  pkg: SealedChangePackage,
): void {
  // Schema validation
  const result = SealedChangePackageSchema.safeParse(pkg);
  if (!result.success) {
    const errorMessages = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new SessionError(
      `Invalid sealed change package structure: ${errorMessages}`,
      "SEAL_INVALID",
      { sessionId: pkg.sessionId, issues: result.error.issues },
    );
  }

  // Hash validation (already checked by schema refinement, but explicit check for clarity)
  const computedHash = computeSealedChangePackageHash(pkg);
  if (pkg.packageHash !== computedHash) {
    throw new SessionError(
      `Package hash mismatch: expected ${computedHash}, got ${pkg.packageHash}`,
      "SEAL_INVALID",
      { sessionId: pkg.sessionId, expected: computedHash, got: pkg.packageHash },
    );
  }
}
