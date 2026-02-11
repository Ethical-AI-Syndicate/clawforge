/**
 * Evidence validation — deterministic validation of runner evidence.
 * No execution. Pure validation only.
 */

import type { DefinitionOfDone } from "./schemas.js";
import type { RunnerEvidence } from "./runner-contract.js";
import { RunnerEvidenceSchema } from "./runner-contract.js";
import {
  isCapabilityRegistered,
  requiresHumanConfirmation,
} from "./capabilities.js";

// ---------------------------------------------------------------------------
// Execution plan shape (structural only)
// ---------------------------------------------------------------------------

export interface ExecutionPlanStep {
  stepId: string;
  references?: string[];
  requiredCapabilities?: string[];
  [key: string]: unknown;
}

export interface ExecutionPlanLike {
  sessionId?: string;
  dodId?: string;
  lockId?: string;
  steps?: ExecutionPlanStep[];
  allowedCapabilities?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface EvidenceValidationResult {
  passed: boolean;
  errors: string[];
  derivedCompletionState: boolean;
}

// ---------------------------------------------------------------------------
// validateRunnerEvidence
// ---------------------------------------------------------------------------

/**
 * Validates a single runner evidence artifact against DoD and execution plan.
 * Does not perform execution. Pure validation only.
 *
 * @param evidence - Raw evidence object (will be schema-validated)
 * @param dod - Definition of Done
 * @param executionPlan - Execution plan with steps and allowedCapabilities
 * @param recordedEvidence - Already-recorded evidence (for duplicate evidenceId check)
 */
export function validateRunnerEvidence(
  evidence: unknown,
  dod: DefinitionOfDone,
  executionPlan: ExecutionPlanLike,
  recordedEvidence: RunnerEvidence[] = [],
): EvidenceValidationResult {
  const errors: string[] = [];

  // Schema validation
  const parsed = RunnerEvidenceSchema.safeParse(evidence);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e: { message: string }) => e.message).join("; ");
    errors.push(`Evidence schema invalid: ${msg}`);
    return { passed: false, errors, derivedCompletionState: false };
  }

  const ev = parsed.data;

  // stepId must exist in plan
  const steps = executionPlan.steps ?? [];
  const step = steps.find((s) => s.stepId === ev.stepId);
  if (!step) {
    errors.push(`Evidence stepId "${ev.stepId}" not found in execution plan`);
    return { passed: false, errors, derivedCompletionState: false };
  }

  // sessionId must match plan
  if (executionPlan.sessionId && ev.sessionId !== executionPlan.sessionId) {
    errors.push(
      `Evidence sessionId "${ev.sessionId}" does not match plan sessionId "${executionPlan.sessionId}"`,
    );
    return { passed: false, errors, derivedCompletionState: false };
  }

  // Duplicate evidenceId
  const existingIds = new Set(recordedEvidence.map((e) => e.evidenceId));
  if (existingIds.has(ev.evidenceId)) {
    errors.push(`Duplicate evidenceId: ${ev.evidenceId}`);
    return { passed: false, errors, derivedCompletionState: false };
  }

  // Phase G: Capability validation
  // 1. Capability must be in registry
  if (!isCapabilityRegistered(ev.capabilityUsed)) {
    errors.push(
      `Capability "${ev.capabilityUsed}" is not registered in CAPABILITY_REGISTRY`,
    );
    return { passed: false, errors, derivedCompletionState: false };
  }

  // 2. CapabilityUsed must be allowed by plan (only if plan has allowedCapabilities)
  const allowed = executionPlan.allowedCapabilities ?? [];
  if (allowed.length > 0 && !allowed.includes(ev.capabilityUsed)) {
    errors.push(
      `Capability "${ev.capabilityUsed}" not in plan allowedCapabilities`,
    );
    return { passed: false, errors, derivedCompletionState: false };
  }

  // 3. CapabilityUsed must be in step.requiredCapabilities (if defined)
  const stepRequired = step.requiredCapabilities;
  if (stepRequired !== undefined && Array.isArray(stepRequired)) {
    if (!stepRequired.includes(ev.capabilityUsed)) {
      errors.push(
        `Capability "${ev.capabilityUsed}" not in step ${ev.stepId} requiredCapabilities`,
      );
      return { passed: false, errors, derivedCompletionState: false };
    }
  }

  // 4. Human confirmation required enforcement
  if (requiresHumanConfirmation(ev.capabilityUsed)) {
    if (
      !ev.humanConfirmationProof ||
      ev.humanConfirmationProof.trim().length === 0
    ) {
      errors.push(
        `Capability "${ev.capabilityUsed}" requires human confirmation but humanConfirmationProof is empty`,
      );
      return { passed: false, errors, derivedCompletionState: false };
    }
  }

  // EvidenceType must match one of the step's referenced DoD items' verification method
  const refs = step.references ?? [];
  if (refs.length === 0) {
    errors.push(`Step ${ev.stepId} has no DoD references`);
    return { passed: false, errors, derivedCompletionState: false };
  }

  const dodItems = dod.items;
  const matchedItem = refs.some((refId) => {
    const item = dodItems.find((i) => i.id === refId);
    return item && item.verificationMethod === ev.evidenceType;
  });
  if (!matchedItem) {
    const allowedTypes = refs
      .map((refId) => dodItems.find((i) => i.id === refId)?.verificationMethod)
      .filter(Boolean);
    errors.push(
      `Evidence evidenceType "${ev.evidenceType}" does not match step DoD verification methods: ${allowedTypes.join(", ")}`,
    );
    return { passed: false, errors, derivedCompletionState: false };
  }

  // artifactHash present and non-empty (schema enforces; double-check)
  if (!ev.artifactHash || ev.artifactHash.length !== 64) {
    errors.push("artifactHash must be present and 64-char hex");
    return { passed: false, errors, derivedCompletionState: false };
  }

  // humanConfirmationProof must exist (schema enforces)
  if (!ev.humanConfirmationProof || ev.humanConfirmationProof.length === 0) {
    errors.push("humanConfirmationProof is required");
    return { passed: false, errors, derivedCompletionState: false };
  }

  return { passed: true, errors: [], derivedCompletionState: false };
}

/**
 * Derives completion state: true only if every plan step has at least one
 * validated evidence in the recorded list, and gate remains satisfied.
 * Does not perform execution.
 */
export function deriveCompletionStatus(
  executionPlan: ExecutionPlanLike,
  recordedEvidence: RunnerEvidence[],
  gatePassed: boolean,
): boolean {
  if (!gatePassed) return false;
  const steps = executionPlan.steps ?? [];
  if (steps.length === 0) return false;
  const stepIds = new Set(steps.map((s) => s.stepId));
  const evidencedStepIds = new Set(recordedEvidence.map((e) => e.stepId));
  for (const sid of stepIds) {
    if (!evidencedStepIds.has(sid)) return false;
  }
  return true;
}
