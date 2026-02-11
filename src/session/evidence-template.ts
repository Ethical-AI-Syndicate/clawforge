/**
 * Runner evidence template emitter — generates a NON-AUTHORITATIVE skeleton
 * showing runners exactly what evidence fields are required per plan step.
 *
 * Template presence NEVER affects completion status.
 * Writes go through persistence.ts (writeEvidenceTemplateJson).
 */

import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { DefinitionOfDone } from "./schemas.js";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { writeEvidenceTemplateJson } from "./persistence.js";

/**
 * Emit a `runner-evidence.template.json` skeleton for the given execution plan.
 *
 * @param sessionDir - Resolved session directory path
 * @param executionPlan - Locked execution plan with steps
 * @param _dod - Definition of Done (reserved for future per-step hints)
 * @returns The file path of the written template
 */
export function emitRunnerEvidenceTemplate(
  sessionDir: string,
  executionPlan: ExecutionPlanLike,
  _dod: DefinitionOfDone,
): string {
  const steps = executionPlan.steps ?? [];

  const entries = steps.map((step) => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: executionPlan.sessionId ?? "<REPLACE_WITH_SESSION_ID>",
    stepId: step.stepId,
    evidenceId: "<REPLACE_WITH_UUID>",
    timestamp: "<REPLACE_WITH_ISO_TIMESTAMP>",
    evidenceType: "<REPLACE_WITH_VALID_TYPE>",
    capabilityUsed: "<REPLACE_WITH_ALLOWED_CAPABILITY>",
    humanConfirmationProof: "<REPLACE_WITH_CONFIRMATION>",
    artifactHash: "<REPLACE_IF_APPLICABLE>",
    verificationMetadata: {},
    __template: true,
  }));

  const template = {
    __notice:
      "THIS IS A NON-AUTHORITATIVE TEMPLATE. Replace placeholders with real runner-generated evidence.",
    generatedAt: new Date().toISOString(),
    entries,
  };

  return writeEvidenceTemplateJson(sessionDir, template);
}
