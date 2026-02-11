/**
 * Session module — public API.
 */

export {
  SESSION_SCHEMA_VERSION,
  DoDItemSchema,
  DefinitionOfDoneSchema,
  DecisionLockSchema,
  GateCheckSchema,
  ExecutionGateResultSchema,
  type DoDItem,
  type DefinitionOfDone,
  type DecisionLock,
  type GateCheck,
  type ExecutionGateResult,
} from "./schemas.js";

export { evaluateExecutionGate } from "./gate.js";

export { SessionError, type SessionErrorCode } from "./errors.js";

export {
  writeSessionJson,
  readSessionJson,
  writeDoDJson,
  readDoDJson,
  writeDecisionLockJson,
  readDecisionLockJson,
  writeGateResultJson,
  readGateResultJson,
  writeRunnerEvidenceJson,
  readRunnerEvidenceJson,
  readExecutionPlanJson,
  writeReviewerReportJson,
  readReviewerReports,
  type SessionRecord,
} from "./persistence.js";

export { SessionManager, type SessionStatus } from "./session.js";

export { lintExecutionPlan } from "./execution-plan-lint.js";

export {
  RunnerRequestSchema,
  RunnerEvidenceSchema,
  type RunnerRequest,
  type RunnerEvidence,
} from "./runner-contract.js";

export {
  validateRunnerEvidence,
  deriveCompletionStatus as deriveEvidenceCompletionStatus,
  type EvidenceValidationResult,
  type ExecutionPlanStep,
  type ExecutionPlanLike,
} from "./evidence-validation.js";

export {
  StepEnvelopeSchema,
  type StepEnvelope,
} from "./step-envelope.js";

export {
  FileChangeSchema,
  PatchArtifactSchema,
  type PatchArtifact,
} from "./patch-artifact.js";

export {
  REVIEWER_ROLES,
  ReviewerRoleSchema,
  ReviewerReportSchema,
  ViolationSchema,
  type ReviewerRole,
  type ReviewerReport,
  type Violation,
} from "./reviewer-contract.js";

export {
  getRulesForRole,
  RULE_REGISTRY,
  type ReviewerRule,
  type RuleCheckResult,
} from "./reviewer-rules.js";

export {
  reviewStep,
  type ReviewStepInput,
  type ReviewStepResult,
} from "./reviewer-orchestrator.js";
