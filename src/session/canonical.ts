/**
 * Canonicalization and normalization utilities.
 *
 * Provides stable stringification and normalization for hashing.
 * Strips volatile fields (timestamps, hashes) and ensures stable ordering.
 */

import { canonicalJson } from "../audit/canonical.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { RunnerEvidence } from "./runner-contract.js";

/**
 * Canonical stringify — uses audit layer canonical JSON.
 */
export function canonicalize(value: unknown): string {
  return canonicalJson(value);
}

/**
 * Normalize execution plan for hashing.
 *
 * Strips volatile fields (timestamps, planHash if present) and ensures
 * stable structure for deterministic hashing.
 */
export function normalizeExecutionPlan(plan: ExecutionPlanLike): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  
  // Core fields (preserve order)
  if (plan.sessionId !== undefined) normalized.sessionId = plan.sessionId;
  if (plan.dodId !== undefined) normalized.dodId = plan.dodId;
  if (plan.lockId !== undefined) normalized.lockId = plan.lockId;
  
  // Steps (normalize each step)
  if (plan.steps !== undefined) {
    normalized.steps = plan.steps.map((step) => {
      const stepNorm: Record<string, unknown> = {};
      const stepKeys = Object.keys(step).sort();
      for (const key of stepKeys) {
        // Skip volatile fields
        if (key === "timestamp" || key === "createdAt" || key === "updatedAt") {
          continue;
        }
        stepNorm[key] = step[key];
      }
      return stepNorm;
    });
  }
  
  // Other fields (preserve but skip volatile)
  const otherKeys = Object.keys(plan).sort();
  for (const key of otherKeys) {
    if (
      key === "sessionId" ||
      key === "dodId" ||
      key === "lockId" ||
      key === "steps" ||
      key === "planHash" || // Skip planHash itself
      key === "timestamp" ||
      key === "createdAt" ||
      key === "updatedAt"
    ) {
      continue;
    }
    normalized[key] = plan[key];
  }
  
  return normalized;
}

/**
 * Normalize runner evidence for hashing.
 *
 * Strips evidenceHash itself and ensures stable structure.
 */
export function normalizeRunnerEvidence(evidence: RunnerEvidence): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  
  // Core fields (preserve order)
  normalized.schemaVersion = evidence.schemaVersion;
  normalized.sessionId = evidence.sessionId;
  normalized.stepId = evidence.stepId;
  normalized.evidenceId = evidence.evidenceId;
  normalized.timestamp = evidence.timestamp;
  normalized.evidenceType = evidence.evidenceType;
  normalized.artifactHash = evidence.artifactHash;
  normalized.verificationMetadata = evidence.verificationMetadata;
  normalized.capabilityUsed = evidence.capabilityUsed;
  normalized.humanConfirmationProof = evidence.humanConfirmationProof;
  
  // Phase F fields (if present)
  if ("planHash" in evidence && evidence.planHash !== undefined) {
    normalized.planHash = evidence.planHash;
  }
  if ("prevEvidenceHash" in evidence && evidence.prevEvidenceHash !== undefined) {
    normalized.prevEvidenceHash = evidence.prevEvidenceHash;
  }
  
  // Skip evidenceHash itself (it's computed from normalized)
  // Include other passthrough fields
  const allKeys = Object.keys(evidence).sort();
  for (const key of allKeys) {
    if (
      key === "schemaVersion" ||
      key === "sessionId" ||
      key === "stepId" ||
      key === "evidenceId" ||
      key === "timestamp" ||
      key === "evidenceType" ||
      key === "artifactHash" ||
      key === "verificationMetadata" ||
      key === "capabilityUsed" ||
      key === "humanConfirmationProof" ||
      key === "planHash" ||
      key === "prevEvidenceHash" ||
      key === "evidenceHash" // Skip evidenceHash
    ) {
      continue;
    }
    normalized[key] = evidence[key];
  }
  
  return normalized;
}
