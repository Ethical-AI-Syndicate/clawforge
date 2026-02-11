/**
 * Reviewer orchestrator — sequential, fail-closed reviewer pipeline.
 *
 * Parses step envelope and patch artifact, validates cross-references,
 * then runs each reviewer role in sequence. Any failure stops the pipeline.
 *
 * No execution. No cross-reviewer state. No self-approval.
 */

import { SessionError } from "./errors.js";
import { StepEnvelopeSchema, type StepEnvelope } from "./step-envelope.js";
import { PatchArtifactSchema, type PatchArtifact } from "./patch-artifact.js";
import {
  REVIEWER_ROLES,
  type ReviewerReport,
} from "./reviewer-contract.js";
import { getRulesForRole } from "./reviewer-rules.js";
import type { DefinitionOfDone, DecisionLock } from "./schemas.js";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

export interface ReviewStepInput {
  stepEnvelope: unknown;
  patchArtifact: unknown;
  dod: DefinitionOfDone;
  decisionLock: DecisionLock;
}

export interface ReviewStepResult {
  passed: boolean;
  failedAt?: string;
  reports: ReviewerReport[];
}

// ---------------------------------------------------------------------------
// reviewStep
// ---------------------------------------------------------------------------

export function reviewStep(input: ReviewStepInput): ReviewStepResult {
  // 1. Parse step envelope
  const envResult = StepEnvelopeSchema.safeParse(input.stepEnvelope);
  if (!envResult.success) {
    throw new SessionError(
      `StepEnvelope invalid: ${envResult.error.message}`,
      "STEP_ENVELOPE_INVALID",
      { errors: envResult.error.message },
    );
  }
  const envelope: StepEnvelope = envResult.data;

  // 2. Parse patch artifact
  const patchResult = PatchArtifactSchema.safeParse(input.patchArtifact);
  if (!patchResult.success) {
    throw new SessionError(
      `PatchArtifact invalid: ${patchResult.error.message}`,
      "PATCH_ARTIFACT_INVALID",
      { errors: patchResult.error.message },
    );
  }
  const patch: PatchArtifact = patchResult.data;

  // 3. Validate goalExcerpt is substring of decisionLock.goal
  if (!input.decisionLock.goal.includes(envelope.goalExcerpt)) {
    throw new SessionError(
      `goalExcerpt "${envelope.goalExcerpt}" is not a substring of decisionLock.goal`,
      "STEP_ENVELOPE_INVALID",
      { goalExcerpt: envelope.goalExcerpt },
    );
  }

  // 4. Validate each referencedDoDItems exists in dod.items[].id
  const dodItemIds = new Set(input.dod.items.map((i) => i.id));
  for (const ref of envelope.referencedDoDItems) {
    if (!dodItemIds.has(ref)) {
      throw new SessionError(
        `referencedDoDItem "${ref}" not found in DoD items`,
        "STEP_ENVELOPE_INVALID",
        { reference: ref },
      );
    }
  }

  // 5. Validate each filesChanged[].path is in the matching allowedFiles[changeType]
  for (const fc of patch.filesChanged) {
    const allowed =
      envelope.allowedFiles[fc.changeType as keyof typeof envelope.allowedFiles];
    if (!Array.isArray(allowed) || !allowed.includes(fc.path)) {
      throw new SessionError(
        `File "${fc.path}" (${fc.changeType}) not in allowedFiles.${fc.changeType}`,
        "PATCH_ARTIFACT_INVALID",
        { path: fc.path, changeType: fc.changeType },
      );
    }
  }

  // 6. Validate each role in reviewerSequence is a known role
  const knownRoles = new Set<string>(REVIEWER_ROLES);
  for (const role of envelope.reviewerSequence) {
    if (!knownRoles.has(role)) {
      throw new SessionError(
        `Unknown reviewer role: "${role}"`,
        "REVIEWER_FAILED",
        { role },
      );
    }
  }

  // 7. Run each reviewer in sequence
  const reports: ReviewerReport[] = [];

  for (const role of envelope.reviewerSequence) {
    const rules = getRulesForRole(role);
    const violations: Array<{ ruleId: string; message: string }> = [];

    for (const rule of rules) {
      const result = rule.check(envelope, patch, input.dod);
      if (!result.passed) {
        violations.push(...result.violations);
      }
    }

    const passed = violations.length === 0;
    const report: ReviewerReport = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: envelope.sessionId,
      stepId: envelope.stepId,
      reviewerRole: role as typeof REVIEWER_ROLES[number],
      passed,
      violations,
      notes: [],
    };
    reports.push(report);

    if (!passed) {
      return { passed: false, failedAt: role, reports };
    }
  }

  // 8. All passed
  return { passed: true, reports };
}
