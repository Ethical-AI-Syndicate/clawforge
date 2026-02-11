/**
 * Artifact Bundle — Phase J
 *
 * Defines bundle schema for bundling all session artifacts together.
 * Enables deterministic hashing of entire session state.
 */

import { z } from "zod";
import { SessionError } from "./errors.js";
import type { DefinitionOfDone, DecisionLock } from "./schemas.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { RunnerIdentity } from "./runner-identity.js";
import type { RunnerAttestation } from "./runner-attestation.js";
import type { SessionAnchor } from "./session-anchor.js";
import type { Policy } from "./policy.js";
import type { PolicyValidationResult } from "./policy-enforcement.js";
import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
const semver = z.string().regex(SEMVER_RE, "Must be semantic version format");

// ---------------------------------------------------------------------------
// Artifact Bundle Schema
// ---------------------------------------------------------------------------

export const ArtifactBundleSchema = z
  .object({
    bundleVersion: semver,
    artifacts: z
      .object({
        dod: z.unknown().refine((val) => val !== undefined, "dod is required"), // DefinitionOfDone - validated separately
        decisionLock: z.unknown().refine((val) => val !== undefined, "decisionLock is required"), // DecisionLock - validated separately
        executionPlan: z.unknown().refine((val) => val !== undefined, "executionPlan is required"), // ExecutionPlanLike - validated separately
        runnerIdentity: z.unknown().optional(), // RunnerIdentity - validated separately
        runnerEvidence: z.array(z.unknown()).min(0), // RunnerEvidence[] - validated separately
        runnerAttestation: z.unknown().optional(), // RunnerAttestation - validated separately
        sessionAnchor: z.unknown().optional(), // SessionAnchor - validated separately
        policies: z.array(z.unknown()).optional(), // Policy[] - validated separately
        policyEvaluation: z.unknown().optional(), // PolicyValidationResult - validated separately
      })
      .passthrough(),
  })
  .passthrough();

export type ArtifactBundle = z.infer<typeof ArtifactBundleSchema> & {
  artifacts: {
    dod: DefinitionOfDone;
    decisionLock: DecisionLock;
    executionPlan: ExecutionPlanLike;
    runnerIdentity?: RunnerIdentity;
    runnerEvidence: RunnerEvidence[];
    runnerAttestation?: RunnerAttestation;
    sessionAnchor?: SessionAnchor;
    policies?: Policy[];
    policyEvaluation?: PolicyValidationResult;
  };
};

// ---------------------------------------------------------------------------
// Bundle Hash Computation
// ---------------------------------------------------------------------------

/**
 * Normalize bundle for deterministic hashing.
 * Sorts arrays deterministically where order doesn't matter.
 * Preserves order for arrays where order matters (evidence chain).
 */
function normalizeBundle(bundle: ArtifactBundle): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    bundleVersion: bundle.bundleVersion,
    artifacts: {},
  };

  const artifacts = bundle.artifacts;

  // Core artifacts (order matters for canonicalization)
  normalized.artifacts = {
    dod: artifacts.dod,
    decisionLock: artifacts.decisionLock,
    executionPlan: artifacts.executionPlan,
  };

  // Runner identity (if present)
  if (artifacts.runnerIdentity !== undefined) {
    (normalized.artifacts as Record<string, unknown>).runnerIdentity =
      artifacts.runnerIdentity;
  }

  // Evidence chain (order matters - maintain order)
  (normalized.artifacts as Record<string, unknown>).runnerEvidence =
    artifacts.runnerEvidence;

  // Attestation (if present)
  if (artifacts.runnerAttestation !== undefined) {
    (normalized.artifacts as Record<string, unknown>).runnerAttestation =
      artifacts.runnerAttestation;
  }

  // Anchor (if present)
  if (artifacts.sessionAnchor !== undefined) {
    (normalized.artifacts as Record<string, unknown>).sessionAnchor =
      artifacts.sessionAnchor;
  }

  // Policies (sort by policyId for deterministic hashing)
  if (artifacts.policies !== undefined && artifacts.policies.length > 0) {
    const sortedPolicies = [...artifacts.policies].sort((a, b) =>
      a.policyId.localeCompare(b.policyId),
    );
    (normalized.artifacts as Record<string, unknown>).policies =
      sortedPolicies;
  }

  // Policy evaluation (if present)
  if (artifacts.policyEvaluation !== undefined) {
    (normalized.artifacts as Record<string, unknown>).policyEvaluation =
      artifacts.policyEvaluation;
  }

  return normalized;
}

/**
 * Compute bundle hash from normalized bundle.
 * Deterministic: same bundle produces same hash.
 * Order-independent for policies (sorted by policyId).
 * Order-dependent for evidence chain (order matters).
 *
 * @param bundle - Artifact bundle to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeBundleHash(bundle: ArtifactBundle): string {
  const normalized = normalizeBundle(bundle);
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}

/**
 * Validate artifact bundle schema.
 *
 * @param bundle - Raw bundle object to validate
 * @throws SessionError with code REPLAY_BUNDLE_INVALID on failure
 */
export function validateBundle(bundle: unknown): ArtifactBundle {
  const parseResult = ArtifactBundleSchema.safeParse(bundle);
  if (!parseResult.success) {
    throw new SessionError(
      `Bundle schema invalid: ${parseResult.error.message}`,
      "REPLAY_BUNDLE_INVALID",
      { errors: parseResult.error.message },
    );
  }
  return parseResult.data as ArtifactBundle;
}
