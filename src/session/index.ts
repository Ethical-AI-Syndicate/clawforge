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
  writeSessionAnchorJson,
  readSessionAnchorJson,
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

export { emitRunnerEvidenceTemplate } from "./evidence-template.js";

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

// Phase F: Plan hash and evidence chain validation
export {
  sha256Hex,
} from "./crypto.js";

export {
  canonicalize,
  normalizeExecutionPlan,
  normalizeRunnerEvidence,
} from "./canonical.js";

export {
  computePlanHash,
  validatePlanHashBinding,
} from "./plan-hash.js";

export {
  computeEvidenceHash,
  validateEvidenceChain,
} from "./evidence-chain.js";

export {
  SessionAnchorSchema,
  validateAnchor,
  type SessionAnchor,
} from "./session-anchor.js";

// Phase G: Capability model and authority isolation
export {
  CAPABILITY_REGISTRY,
  getCapability,
  isCapabilityRegistered,
  getAllCapabilityIds,
  isRoleAllowedForCapability,
  requiresHumanConfirmation,
  type CapabilityDefinition,
  type CapabilityCategory,
  type CapabilityRiskLevel,
} from "./capabilities.js";

export {
  validateSessionBoundary,
  type SessionBoundaryInput,
} from "./session-boundary.js";

// Phase H: Runner attestation and identity
export {
  RunnerIdentitySchema,
  validateRunnerIdentity,
  computeIdentityHash,
  type RunnerIdentity,
} from "./runner-identity.js";

export {
  RunnerAttestationSchema,
  validateAttestation,
  verifyAttestationSignature,
  computeAttestationPayloadHash,
  type RunnerAttestation,
  type AttestationValidationInput,
} from "./runner-attestation.js";

export {
  writeRunnerAttestationJson,
  readRunnerAttestationJson,
  writeRunnerIdentityJson,
  readRunnerIdentityJson,
  readUsedNoncesJson,
  writeUsedNoncesJson,
  appendNonce,
} from "./persistence.js";

// Phase I: Policy-as-Code governance
export {
  PolicySchema,
  PolicyRuleSchema,
  PolicyConditionSchema,
  validatePolicy,
  type Policy,
  type PolicyRule,
  type PolicyCondition,
} from "./policy.js";

export {
  evaluatePolicy,
  resolveFieldPath,
  type SessionContext,
  type PolicyEvaluationResult,
  type RuleEvaluationResult,
} from "./policy-engine.js";

export {
  validatePolicies,
  computePolicySetHash,
  computePolicyEvaluationHash,
  type PolicyValidationResult,
} from "./policy-enforcement.js";

export {
  writePolicyJson,
  readPolicyJson,
  readAllPoliciesJson,
  writePolicyEvaluationJson,
  readPolicyEvaluationJson,
} from "./persistence.js";

// Phase J: Deterministic reproducibility
export {
  ArtifactBundleSchema,
  validateBundle,
  computeBundleHash,
  type ArtifactBundle,
} from "./bundle.js";

export {
  replaySession,
  type ReplayResult,
} from "./replay.js";

// Phase K: Prompt Capsules and Model Response Artifacts
export {
  PromptCapsuleSchema,
  computeCapsuleHash,
  type PromptCapsule,
} from "./prompt-capsule.js";

export {
  ModelResponseArtifactSchema,
  ChangeProposalSchema,
  CitationSchema,
  computeResponseHash,
  type ModelResponseArtifact,
  type ChangeProposal,
  type Citation,
} from "./model-response.js";

export {
  lintPromptCapsule,
  lintModelResponse,
} from "./prompt-lint.js";

export {
  extractReferencedFilePathsFromPatch,
  extractSymbolMentions,
} from "./symbol-boundary.js";

export {
  writePromptCapsuleJson,
  readPromptCapsuleJson,
  writeModelResponseJson,
  readModelResponseJson,
} from "./persistence.js";

// Phase L: Symbol Graph Enforcement
export {
  buildSymbolIndex,
  type SymbolIndex,
  type FileSymbolInfo,
  type ExportInfo,
  type ImportInfo,
  type BuildSymbolIndexOptions,
} from "./symbol-index.js";

export {
  validatePatchAgainstSymbols,
  type SymbolValidationResult,
} from "./symbol-validate.js";

export {
  writeSymbolIndexJson,
  readSymbolIndexJson,
  writeSymbolValidationJson,
  readSymbolValidationJson,
} from "./persistence.js";

// Phase M: Repo Snapshot and Patch Applicability Proof
export {
  buildRepoSnapshot,
  computeSnapshotHash,
  findFileSnapshot,
  getFileContentHash,
  type RepoSnapshot,
  type FileSnapshot,
  type BuildRepoSnapshotOptions,
} from "./repo-snapshot.js";

export {
  provePatchApplies,
  type PatchApplyReport,
  type TouchedFile,
  type Conflict,
  type ProvePatchAppliesOptions,
} from "./patch-apply.js";

export {
  writeRepoSnapshotJson,
  readRepoSnapshotJson,
  writePatchApplyReportJson,
  readPatchApplyReportJson,
} from "./persistence.js";

// Phase O: Least-Privilege Work Packets
export {
  StepPacketSchema,
  PacketReceiptSchema,
  FileDigestSchema,
  ExcerptSchema,
  PacketContextSchema,
  computeStepPacketHash,
  type StepPacket,
  type PacketReceipt,
  type FileDigest,
  type Excerpt,
  type PacketContext,
} from "./step-packet.js";

export {
  lintStepPacket,
  type LintStepPacketInput,
} from "./step-packet-lint.js";

export {
  emitStepPackets,
  type EmitStepPacketsInput,
} from "./step-packet-emit.js";

export {
  writeStepPacketJson,
  readStepPacketJson,
  readAllStepPacketsJson,
  writePacketReceiptJson,
  readPacketReceiptJson,
} from "./persistence.js";

// Phase N: Quorum Signatures for Approval Artifacts
export {
  computeDecisionLockHash,
} from "./decision-lock-hash.js";

export {
  ApprovalPolicySchema,
  validateApprovalPolicy,
  type ApprovalPolicy,
  type Approver,
  type ApprovalRule,
} from "./approval-policy.js";

export {
  ApprovalBundleSchema,
  ApprovalSignatureSchema,
  computeSignaturePayloadHash,
  computeBundleHash as computeApprovalBundleHash,
  verifySignature,
  type ApprovalBundle,
  type ApprovalSignature,
} from "./approval-bundle.js";

export {
  enforceApprovals,
  type ApprovalEnforcementResult,
  type SatisfiedRule,
  type EnforceApprovalsInput,
} from "./approval-enforcement.js";

export {
  writeApprovalPolicyJson,
  readApprovalPolicyJson,
  writeApprovalBundleJson,
  readApprovalBundleJson,
  readUsedApprovalNoncesJson,
  writeUsedApprovalNoncesJson,
  appendApprovalNonce,
} from "./persistence.js";
