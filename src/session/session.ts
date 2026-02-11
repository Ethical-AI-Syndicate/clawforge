/**
 * SessionManager — clerical orchestration around proven constraints.
 *
 * This module does NOT add execution capability.
 * This module does NOT modify kernel behavior.
 * This module does NOT introduce inference, automation, or heuristics.
 *
 * Session status is DERIVED from artifact presence, never stored.
 * Execution authority is NEVER granted by session state.
 * Only evaluateExecutionGate().passed === true matters.
 */

import { v4 as uuidv4 } from "uuid";
import type { EventStore, StoredEvent } from "../audit/store.js";
import {
  DefinitionOfDoneSchema,
  DecisionLockSchema,
  SESSION_SCHEMA_VERSION,
  type DefinitionOfDone,
  type DecisionLock,
  type ExecutionGateResult,
} from "./schemas.js";
import { evaluateExecutionGate } from "./gate.js";
import { SessionError } from "./errors.js";
import {
  writeSessionJson,
  readSessionJson,
  writeDoDJson,
  readDoDJson,
  writeDecisionLockJson,
  readDecisionLockJson,
  writeGateResultJson,
  readGateResultJson,
  readRunnerEvidenceJson,
  writeRunnerEvidenceJson,
  readExecutionPlanJson,
  writePromptCapsuleJson,
  readPromptCapsuleJson,
  writeModelResponseJson,
  readModelResponseJson,
  writeSymbolIndexJson,
  readSymbolIndexJson,
  writeSymbolValidationJson,
  writeRepoSnapshotJson,
  readRepoSnapshotJson,
  writePatchApplyReportJson,
  writeApprovalPolicyJson,
  readApprovalPolicyJson,
  writeApprovalBundleJson,
  readApprovalBundleJson,
  readUsedApprovalNoncesJson,
  appendApprovalNonce,
  type SessionRecord,
} from "./persistence.js";
import {
  validateRunnerEvidence,
  deriveCompletionStatus as deriveCompletionFromEvidence,
  type ExecutionPlanLike,
} from "./evidence-validation.js";
import { RunnerEvidenceSchema, type RunnerEvidence } from "./runner-contract.js";
import { validatePlanHashBinding, computePlanHash } from "./plan-hash.js";
import {
  computeEvidenceHash,
  validateEvidenceChain,
} from "./evidence-chain.js";
import { validateSessionBoundary } from "./session-boundary.js";
import {
  readSessionAnchorJson,
  readRunnerIdentityJson,
  readRunnerAttestationJson,
} from "./persistence.js";
import type { Policy } from "./policy.js";
import type { SessionContext } from "./policy-engine.js";
import { validatePolicies, type PolicyValidationResult } from "./policy-enforcement.js";
import type { PromptCapsule } from "./prompt-capsule.js";
import type { ModelResponseArtifact } from "./model-response.js";
import { lintPromptCapsule, lintModelResponse } from "./prompt-lint.js";
import {
  buildSymbolIndex,
  type SymbolIndex,
  type BuildSymbolIndexOptions,
} from "./symbol-index.js";
import {
  validatePatchAgainstSymbols,
  type SymbolValidationResult,
} from "./symbol-validate.js";
import type { PatchArtifact } from "./patch-artifact.js";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import {
  buildRepoSnapshot,
  type RepoSnapshot,
  type BuildRepoSnapshotOptions,
} from "./repo-snapshot.js";
import {
  provePatchApplies,
  type PatchApplyReport,
  type ProvePatchAppliesOptions,
} from "./patch-apply.js";
import {
  validateApprovalPolicy,
  type ApprovalPolicy,
} from "./approval-policy.js";
import {
  verifySignature,
  type ApprovalBundle,
  computeBundleHash,
} from "./approval-bundle.js";
import {
  enforceApprovals,
  type ApprovalEnforcementResult,
} from "./approval-enforcement.js";
import { computeDecisionLockHash } from "./decision-lock-hash.js";
import { computeCapsuleHash } from "./prompt-capsule.js";

// ---------------------------------------------------------------------------
// Derived session status
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "exploring"
  | "locked"
  | "eligible"
  | "blocked";

// ---------------------------------------------------------------------------
// Actor type used by SessionManager methods
// ---------------------------------------------------------------------------

interface Actor {
  actorId: string;
  actorType: "human" | "system";
}

// ---------------------------------------------------------------------------
// SessionManager
// ---------------------------------------------------------------------------

export class SessionManager {
  private readonly eventStore: EventStore;
  private readonly sessionRoot: string;

  constructor(eventStore: EventStore, sessionRoot: string) {
    this.eventStore = eventStore;
    this.sessionRoot = sessionRoot;
  }

  // -----------------------------------------------------------------------
  // createSession
  // -----------------------------------------------------------------------

  createSession(opts: {
    sessionId?: string;
    title: string;
    description: string;
    actor: Actor;
  }): SessionRecord {
    const sessionId = opts.sessionId ?? uuidv4();
    const explorationRunId = uuidv4();

    // Create exploration run in event store
    this.eventStore.createRun(explorationRunId, {
      sessionType: "exploration",
      sessionId,
    });

    // Append RunStarted (required first event)
    this.eventStore.appendEvent(explorationRunId, {
      eventId: uuidv4(),
      type: "RunStarted",
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor: opts.actor,
      payload: {
        mode: "exploration",
        sessionId,
      },
    });

    // Append ExplorationStarted
    this.eventStore.appendEvent(explorationRunId, {
      eventId: uuidv4(),
      type: "ExplorationStarted",
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor: opts.actor,
      payload: {
        sessionId,
        title: opts.title,
        description: opts.description,
      },
    });

    const record: SessionRecord = {
      sessionId,
      title: opts.title,
      description: opts.description,
      explorationRunId,
      createdAt: new Date().toISOString(),
      createdBy: opts.actor,
    };

    writeSessionJson(this.sessionRoot, sessionId, record);
    return record;
  }

  // -----------------------------------------------------------------------
  // recordDoD
  // -----------------------------------------------------------------------

  recordDoD(
    sessionId: string,
    dod: DefinitionOfDone,
    actor: Actor,
  ): StoredEvent {
    const session = this.requireSession(sessionId);
    const status = this.getSessionStatus(sessionId);

    if (status !== "exploring") {
      throw new SessionError(
        `Cannot record DoD: session is "${status}", must be "exploring"`,
        "MODE_VIOLATION",
        { sessionId, status },
      );
    }

    // Validate schema (hard failure on invalid)
    const parseResult = DefinitionOfDoneSchema.safeParse(dod);
    if (!parseResult.success) {
      throw new SessionError(
        `Invalid Definition of Done: ${parseResult.error.message}`,
        "SCHEMA_INVALID",
        { sessionId, errors: parseResult.error.message },
      );
    }

    // Validate sessionId match
    if (dod.sessionId !== sessionId) {
      throw new SessionError(
        `DoD sessionId "${dod.sessionId}" does not match session "${sessionId}"`,
        "ID_MISMATCH",
        { dodSessionId: dod.sessionId, sessionId },
      );
    }

    // Append DoDRecorded event to exploration run
    const event = this.eventStore.appendEvent(session.explorationRunId, {
      eventId: uuidv4(),
      type: "DoDRecorded",
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor,
      payload: {
        dodId: dod.dodId,
        definitionOfDone: dod as unknown as Record<string, unknown>,
      },
    });

    writeDoDJson(this.sessionRoot, sessionId, dod);
    return event;
  }

  // -----------------------------------------------------------------------
  // recordDecisionLock
  // -----------------------------------------------------------------------

  recordDecisionLock(
    sessionId: string,
    lock: DecisionLock,
    actor: Actor,
  ): StoredEvent {
    const session = this.requireSession(sessionId);
    const status = this.getSessionStatus(sessionId);

    if (status !== "exploring") {
      throw new SessionError(
        `Cannot record Decision Lock: session is "${status}", must be "exploring"`,
        "MODE_VIOLATION",
        { sessionId, status },
      );
    }

    // DoD must exist
    const dod = readDoDJson(this.sessionRoot, sessionId);
    if (!dod) {
      throw new SessionError(
        "Cannot record Decision Lock: no Definition of Done exists",
        "DOD_MISSING",
        { sessionId },
      );
    }

    // Validate schema (hard failure)
    const parseResult = DecisionLockSchema.safeParse(lock);
    if (!parseResult.success) {
      throw new SessionError(
        `Invalid Decision Lock: ${parseResult.error.message}`,
        "SCHEMA_INVALID",
        { sessionId, errors: parseResult.error.message },
      );
    }

    // Validate sessionId match
    if (lock.sessionId !== sessionId) {
      throw new SessionError(
        `Lock sessionId "${lock.sessionId}" does not match session "${sessionId}"`,
        "ID_MISMATCH",
        { lockSessionId: lock.sessionId, sessionId },
      );
    }

    // Validate dodId match
    if (lock.dodId !== dod.dodId) {
      throw new SessionError(
        `Lock dodId "${lock.dodId}" does not match session DoD "${dod.dodId}"`,
        "ID_MISMATCH",
        { lockDodId: lock.dodId, dodId: dod.dodId },
      );
    }

    // Lock must be in draft status when recording
    if (lock.status !== "draft") {
      throw new SessionError(
        `Decision Lock must be recorded in "draft" status, got "${lock.status}"`,
        "MODE_VIOLATION",
        { sessionId, status: lock.status },
      );
    }

    // Append DecisionLockRecorded event
    const event = this.eventStore.appendEvent(session.explorationRunId, {
      eventId: uuidv4(),
      type: "DecisionLockRecorded",
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor,
      payload: {
        lockId: lock.lockId,
        decisionLock: lock as unknown as Record<string, unknown>,
      },
    });

    writeDecisionLockJson(this.sessionRoot, sessionId, lock);
    return event;
  }

  // -----------------------------------------------------------------------
  // approveDecisionLock
  // -----------------------------------------------------------------------

  approveDecisionLock(
    sessionId: string,
    approvalMetadata: {
      approvedBy: string;
      approvedAt: string;
      approvalMethod: string;
    },
  ): StoredEvent {
    const session = this.requireSession(sessionId);

    // DoD must exist
    const dod = readDoDJson(this.sessionRoot, sessionId);
    if (!dod) {
      throw new SessionError(
        "Cannot approve lock: no Definition of Done exists",
        "DOD_MISSING",
        { sessionId },
      );
    }

    // Lock must exist
    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    if (!lock) {
      throw new SessionError(
        "Cannot approve lock: no Decision Lock exists",
        "LOCK_MISSING",
        { sessionId },
      );
    }

    // Lock must be in draft status
    if (lock.status === "approved") {
      throw new SessionError(
        "Decision Lock is already approved",
        "MODE_VIOLATION",
        { sessionId, lockId: lock.lockId },
      );
    }

    if (lock.status === "rejected") {
      throw new SessionError(
        "Decision Lock has been rejected, cannot approve",
        "MODE_VIOLATION",
        { sessionId, lockId: lock.lockId },
      );
    }

    // Update lock with approval metadata
    const approvedLock: DecisionLock = {
      ...lock,
      status: "approved",
      approvalMetadata,
    };

    // Append DecisionLockApproved event
    const event = this.eventStore.appendEvent(session.explorationRunId, {
      eventId: uuidv4(),
      type: "DecisionLockApproved",
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor: { actorId: approvalMetadata.approvedBy, actorType: "human" },
      payload: {
        lockId: lock.lockId,
        dodId: lock.dodId,
        approvedBy: approvalMetadata.approvedBy,
        approvedAt: approvalMetadata.approvedAt,
        approvalMethod: approvalMetadata.approvalMethod,
      },
    });

    writeDecisionLockJson(this.sessionRoot, sessionId, approvedLock);
    return event;
  }

  // -----------------------------------------------------------------------
  // evaluateGate
  // -----------------------------------------------------------------------

  evaluateGate(sessionId: string): ExecutionGateResult {
    this.requireSession(sessionId);

    const dod = readDoDJson(this.sessionRoot, sessionId) ?? null;
    const lock = readDecisionLockJson(this.sessionRoot, sessionId) ?? null;

    const result = evaluateExecutionGate(dod, lock);
    writeGateResultJson(this.sessionRoot, sessionId, result);
    return result;
  }

  // -----------------------------------------------------------------------
  // getSessionStatus (derived, not stored)
  // -----------------------------------------------------------------------

  getSessionStatus(sessionId: string): SessionStatus {
    this.requireSession(sessionId);

    const dod = readDoDJson(this.sessionRoot, sessionId);
    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    const gateResult = readGateResultJson(this.sessionRoot, sessionId);

    // Gate result takes priority — if evaluated, it is definitive
    if (gateResult) {
      return gateResult.passed ? "eligible" : "blocked";
    }

    // No DoD → exploring
    if (!dod) return "exploring";

    // DoD exists, no lock or lock in draft → exploring
    if (!lock || lock.status === "draft") return "exploring";

    // Lock rejected → exploring (must start over)
    if (lock.status === "rejected") return "exploring";

    // Lock approved, no gate result yet → locked
    if (lock.status === "approved") return "locked";

    return "exploring";
  }

  // -----------------------------------------------------------------------
  // recordRunnerEvidence
  // -----------------------------------------------------------------------

  recordRunnerEvidence(sessionId: string, evidence: unknown): RunnerEvidence {
    this.requireSession(sessionId);

    const dod = readDoDJson(this.sessionRoot, sessionId);
    if (!dod) {
      throw new SessionError(
        "Cannot record evidence: no Definition of Done",
        "DOD_MISSING",
        { sessionId },
      );
    }

    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new SessionError(
        "Cannot record evidence: no execution plan or plan has no steps",
        "EXECUTION_PLAN_LINT_FAILED",
        { sessionId },
      );
    }

    const gateResult = readGateResultJson(this.sessionRoot, sessionId);
    if (!gateResult || !gateResult.passed) {
      throw new SessionError(
        "Cannot record evidence: gate has not passed",
        "GATE_FAILED",
        { sessionId },
      );
    }

    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    if (!lock) {
      throw new SessionError(
        "Cannot record evidence: no Decision Lock exists",
        "LOCK_MISSING",
        { sessionId },
      );
    }

    const recorded = readRunnerEvidenceJson(this.sessionRoot, sessionId) ?? [];
    const planLike: ExecutionPlanLike = {
      sessionId: plan.sessionId as string | undefined,
      dodId: plan.dodId as string | undefined,
      lockId: plan.lockId as string | undefined,
      steps: plan.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
      ...plan,
    };

    // Phase F: Validate plan hash binding
    validatePlanHashBinding(planLike, lock);

    const result = validateRunnerEvidence(
      evidence,
      dod,
      planLike,
      recorded,
    );

    if (!result.passed) {
      throw new SessionError(
        `Evidence validation failed: ${result.errors.join("; ")}`,
        "EVIDENCE_VALIDATION_FAILED",
        { sessionId, errors: result.errors },
      );
    }

    const parsed = RunnerEvidenceSchema.parse(evidence) as RunnerEvidence;
    
    // Phase F: Compute and attach chain fields if not present
    const planHash = computePlanHash(planLike);
    const lastEvidence = recorded.length > 0 ? recorded[recorded.length - 1] : null;
    const prevHash =
      lastEvidence && (lastEvidence as Record<string, unknown>).evidenceHash
        ? (lastEvidence as Record<string, unknown>).evidenceHash as string
        : null;
    
    // Ensure planHash is set
    const evidenceWithPlanHash: RunnerEvidence = {
      ...parsed,
      planHash: parsed.planHash ?? planHash,
      prevEvidenceHash: parsed.prevEvidenceHash ?? prevHash,
    };
    
    // Compute evidenceHash
    const evidenceHash = computeEvidenceHash(evidenceWithPlanHash);
    const evidenceWithHash: RunnerEvidence = {
      ...evidenceWithPlanHash,
      evidenceHash,
    };
    
    const next = [...recorded, evidenceWithHash];
    
    // Phase F: Validate chain after append
    validateEvidenceChain(next, planLike);
    
    // Phase G: Validate session boundary
    const anchor = readSessionAnchorJson(this.sessionRoot, sessionId) ?? undefined;
    validateSessionBoundary({
      sessionId,
      dod,
      decisionLock: lock,
      executionPlan: planLike,
      runnerEvidence: next,
      anchor,
    });
    
    writeRunnerEvidenceJson(this.sessionRoot, sessionId, next);
    return evidenceWithHash;
  }

  // -----------------------------------------------------------------------
  // deriveCompletionStatus
  // -----------------------------------------------------------------------

  deriveCompletionStatus(sessionId: string): boolean {
    this.requireSession(sessionId);

    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    if (!plan || !Array.isArray(plan.steps)) return false;

    const recorded = readRunnerEvidenceJson(this.sessionRoot, sessionId) ?? [];
    const gateResult = readGateResultJson(this.sessionRoot, sessionId);
    const gatePassed = gateResult?.passed ?? false;

    const planLike: ExecutionPlanLike = {
      sessionId: plan.sessionId as string | undefined,
      dodId: plan.dodId as string | undefined,
      lockId: plan.lockId as string | undefined,
      steps: plan.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
      ...plan,
    };

    return deriveCompletionFromEvidence(
      planLike,
      recorded,
      gatePassed,
    );
  }

  // -----------------------------------------------------------------------
  // validateSessionPolicies
  // -----------------------------------------------------------------------

  /**
   * Validate session against policies.
   *
   * @param sessionId - Session ID
   * @param policies - Policies to evaluate
   * @returns Policy validation result
   */
  validateSessionPolicies(
    sessionId: string,
    policies: Policy[],
  ): PolicyValidationResult {
    this.requireSession(sessionId);

    // Build session context from persisted artifacts
    const dod = readDoDJson(this.sessionRoot, sessionId);
    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    const evidence = readRunnerEvidenceJson(this.sessionRoot, sessionId) ?? [];
    const identity = readRunnerIdentityJson(this.sessionRoot, sessionId);
    const attestation = readRunnerAttestationJson(this.sessionRoot, sessionId);
    const anchor = readSessionAnchorJson(this.sessionRoot, sessionId);

    const planLike: ExecutionPlanLike | undefined = plan
      ? {
          sessionId: plan.sessionId as string | undefined,
          dodId: plan.dodId as string | undefined,
          lockId: plan.lockId as string | undefined,
          steps: plan.steps as ExecutionPlanLike["steps"],
          allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
          ...plan,
        }
      : undefined;

    const context: SessionContext = {
      dod: dod ?? undefined,
      decisionLock: lock ?? undefined,
      executionPlan: planLike,
      evidenceChain: evidence.length > 0 ? evidence : undefined,
      runnerIdentity: identity ?? undefined,
      runnerAttestation: attestation ?? undefined,
      anchor: anchor ?? undefined,
    };

    return validatePolicies(context, policies);
  }

  // -----------------------------------------------------------------------
  // Phase K: Prompt Capsule recording
  // -----------------------------------------------------------------------

  /**
   * Record a prompt capsule after validation.
   * This is validation-only; no execution authority changes.
   *
   * @param sessionId - Session ID
   * @param capsule - Prompt capsule to record
   * @param actor - Actor creating the capsule
   * @returns The recorded capsule
   */
  recordPromptCapsule(
    sessionId: string,
    capsule: PromptCapsule,
    actor: Actor,
  ): PromptCapsule {
    this.requireSession(sessionId);

    // Load required artifacts for linting
    const dod = readDoDJson(this.sessionRoot, sessionId);
    if (!dod) {
      throw new SessionError(
        "Cannot record prompt capsule: no Definition of Done exists",
        "DOD_MISSING",
        { sessionId },
      );
    }

    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    if (!lock) {
      throw new SessionError(
        "Cannot record prompt capsule: no Decision Lock exists",
        "LOCK_MISSING",
        { sessionId },
      );
    }

    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    if (!plan) {
      throw new SessionError(
        "Cannot record prompt capsule: no execution plan exists",
        "EXECUTION_PLAN_LINT_FAILED",
        { sessionId },
      );
    }

    const planLike: ExecutionPlanLike = {
      sessionId: plan.sessionId as string | undefined,
      dodId: plan.dodId as string | undefined,
      lockId: plan.lockId as string | undefined,
      steps: plan.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
      ...plan,
    };

    // Lint the capsule
    lintPromptCapsule(capsule, dod, lock, planLike);

    // Write capsule
    writePromptCapsuleJson(this.sessionRoot, sessionId, capsule);

    return capsule;
  }

  // -----------------------------------------------------------------------
  // Phase K: Model Response recording
  // -----------------------------------------------------------------------

  /**
   * Record a model response after validation against capsule boundaries.
   * This is validation-only; no execution authority changes.
   *
   * @param sessionId - Session ID
   * @param response - Model response artifact to record
   * @param actor - Actor creating the response
   * @returns The recorded response
   */
  recordModelResponse(
    sessionId: string,
    response: ModelResponseArtifact,
    actor: Actor,
  ): ModelResponseArtifact {
    this.requireSession(sessionId);

    // Load capsule
    const capsule = readPromptCapsuleJson(this.sessionRoot, sessionId);
    if (!capsule) {
      throw new SessionError(
        "Cannot record model response: no prompt capsule exists",
        "PROMPT_CAPSULE_INVALID",
        { sessionId },
      );
    }

    // Load required artifacts for linting
    const dod = readDoDJson(this.sessionRoot, sessionId);
    if (!dod) {
      throw new SessionError(
        "Cannot record model response: no Definition of Done exists",
        "DOD_MISSING",
        { sessionId },
      );
    }

    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    if (!lock) {
      throw new SessionError(
        "Cannot record model response: no Decision Lock exists",
        "LOCK_MISSING",
        { sessionId },
      );
    }

    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    if (!plan) {
      throw new SessionError(
        "Cannot record model response: no execution plan exists",
        "EXECUTION_PLAN_LINT_FAILED",
        { sessionId },
      );
    }

    const planLike: ExecutionPlanLike = {
      sessionId: plan.sessionId as string | undefined,
      dodId: plan.dodId as string | undefined,
      lockId: plan.lockId as string | undefined,
      steps: plan.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
      ...plan,
    };

    // Lint the response
    lintModelResponse(response, capsule, dod, lock, planLike);

    // Write response
    writeModelResponseJson(this.sessionRoot, sessionId, response);

    return response;
  }

  // -----------------------------------------------------------------------
  // Phase L: Symbol Index building and validation
  // -----------------------------------------------------------------------

  /**
   * Build and record symbol index for a session.
   *
   * @param sessionId - Session ID
   * @param options - Build options
   * @returns The built symbol index
   */
  buildAndRecordSymbolIndex(
    sessionId: string,
    options: BuildSymbolIndexOptions,
  ): SymbolIndex {
    this.requireSession(sessionId);

    const index = buildSymbolIndex(options);
    writeSymbolIndexJson(this.sessionRoot, sessionId, index);

    return index;
  }

  /**
   * Validate patch against symbol index.
   *
   * @param sessionId - Session ID
   * @param patchArtifact - Patch artifact to validate (can be path or object)
   * @param projectRoot - Project root directory
   * @returns Validation result
   */
  validatePatchAgainstSymbolIndex(
    sessionId: string,
    patchArtifact: PatchArtifact | string,
    projectRoot: string,
  ): SymbolValidationResult {
    this.requireSession(sessionId);

    // Load required artifacts
    const capsule = readPromptCapsuleJson(this.sessionRoot, sessionId);
    if (!capsule) {
      throw new SessionError(
        "Cannot validate patch: no prompt capsule exists",
        "PROMPT_CAPSULE_INVALID",
        { sessionId },
      );
    }

    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    if (!lock) {
      throw new SessionError(
        "Cannot validate patch: no Decision Lock exists",
        "LOCK_MISSING",
        { sessionId },
      );
    }

    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    if (!plan) {
      throw new SessionError(
        "Cannot validate patch: no execution plan exists",
        "EXECUTION_PLAN_LINT_FAILED",
        { sessionId },
      );
    }

    const symbolIndex = readSymbolIndexJson(this.sessionRoot, sessionId);
    if (!symbolIndex) {
      throw new SessionError(
        "Cannot validate patch: no symbol index exists",
        "SYMBOL_INDEX_INVALID",
        { sessionId },
      );
    }

    // Load patch artifact if it's a path
    let patch: PatchArtifact;
    if (typeof patchArtifact === "string") {
      const patchContent = readFileSync(patchArtifact, "utf8");
      patch = JSON.parse(patchContent) as PatchArtifact;
    } else {
      patch = patchArtifact;
    }

    const planLike: ExecutionPlanLike = {
      sessionId: plan.sessionId as string | undefined,
      dodId: plan.dodId as string | undefined,
      lockId: plan.lockId as string | undefined,
      steps: plan.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
      ...plan,
    };

    // Validate patch
    const result = validatePatchAgainstSymbols(
      patch,
      capsule,
      lock,
      planLike,
      symbolIndex,
      projectRoot,
    );

    // Write validation result
    writeSymbolValidationJson(this.sessionRoot, sessionId, result);

    // Throw if validation failed
    if (!result.passed) {
      throw new SessionError(
        `Symbol validation failed: ${result.errors.join("; ")}`,
        "SYMBOL_VALIDATION_FAILED",
        { sessionId, errors: result.errors },
      );
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Phase M: Repo Snapshot and Patch Applicability Proof
  // -----------------------------------------------------------------------

  /**
   * Record repo snapshot for a session.
   *
   * @param sessionId - Session ID
   * @param options - Build options
   * @returns The recorded snapshot
   */
  recordRepoSnapshot(
    sessionId: string,
    options: BuildRepoSnapshotOptions,
  ): RepoSnapshot {
    this.requireSession(sessionId);

    const snapshot = buildRepoSnapshot(options);
    writeRepoSnapshotJson(this.sessionRoot, sessionId, snapshot);

    return snapshot;
  }

  /**
   * Prove patch applies to snapshot.
   *
   * @param sessionId - Session ID
   * @param patchArtifact - Patch artifact to prove
   * @param projectRoot - Project root directory
   * @param options - Optional prove options
   * @returns Patch apply report
   */
  provePatchAppliesToSnapshot(
    sessionId: string,
    patchArtifact: PatchArtifact | string,
    projectRoot: string,
    options?: Partial<ProvePatchAppliesOptions>,
  ): PatchApplyReport {
    this.requireSession(sessionId);

    // Load required artifacts
    const snapshot = readRepoSnapshotJson(this.sessionRoot, sessionId);
    if (!snapshot) {
      throw new SessionError(
        "Cannot prove patch: no repo snapshot exists",
        "SNAPSHOT_HASH_MISSING",
        { sessionId },
      );
    }

    const capsule = readPromptCapsuleJson(this.sessionRoot, sessionId);
    if (!capsule) {
      throw new SessionError(
        "Cannot prove patch: no prompt capsule exists",
        "PROMPT_CAPSULE_INVALID",
        { sessionId },
      );
    }

    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    if (!lock) {
      throw new SessionError(
        "Cannot prove patch: no Decision Lock exists",
        "LOCK_MISSING",
        { sessionId },
      );
    }

    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    if (!plan) {
      throw new SessionError(
        "Cannot prove patch: no execution plan exists",
        "EXECUTION_PLAN_LINT_FAILED",
        { sessionId },
      );
    }

    // Load patch artifact if it's a path
    let patch: PatchArtifact;
    if (typeof patchArtifact === "string") {
      const patchContent = readFileSync(patchArtifact, "utf8");
      patch = JSON.parse(patchContent) as PatchArtifact;
    } else {
      patch = patchArtifact;
    }

    // Validate patch files are in allowedFiles
    const allowedFilesSet = new Set(capsule.boundaries.allowedFiles);
    for (const fileChange of patch.filesChanged) {
      if (!allowedFilesSet.has(fileChange.path)) {
        throw new SessionError(
          `Patch file "${fileChange.path}" is not in allowedFiles`,
          "BOUNDARY_VIOLATION",
          { sessionId, filePath: fileChange.path },
        );
      }
    }

    // Build prove options
    const proveOptions: ProvePatchAppliesOptions = {
      projectRoot,
      allowDeletes: options?.allowDeletes ?? false,
      allowedFiles: capsule.boundaries.allowedFiles,
      ...options,
    };

    // Prove patch applies
    const report = provePatchApplies(patch, snapshot, proveOptions);

    // Write report
    writePatchApplyReportJson(this.sessionRoot, sessionId, report);

    // Throw if patch doesn't apply
    if (!report.applied) {
      throw new SessionError(
        `Patch application proof failed: ${report.conflicts.map((c) => c.reason).join("; ")}`,
        "PATCH_APPLY_FAILED",
        { sessionId, conflicts: report.conflicts },
      );
    }

    return report;
  }

  // -----------------------------------------------------------------------
  // Phase N: Approval Policy and Bundle
  // -----------------------------------------------------------------------

  /**
   * Record approval policy for a session.
   *
   * @param sessionId - Session ID
   * @param policy - Approval policy to record
   * @returns The recorded policy
   */
  recordApprovalPolicy(
    sessionId: string,
    policy: ApprovalPolicy,
  ): ApprovalPolicy {
    this.requireSession(sessionId);

    // Validate policy
    validateApprovalPolicy(policy);

    // Verify sessionId matches
    if (policy.sessionId !== sessionId) {
      throw new SessionError(
        `Policy sessionId "${policy.sessionId}" does not match session "${sessionId}"`,
        "ID_MISMATCH",
        { policySessionId: policy.sessionId, sessionId },
      );
    }

    writeApprovalPolicyJson(this.sessionRoot, sessionId, policy);

    return policy;
  }

  /**
   * Record approval bundle for a session.
   *
   * @param sessionId - Session ID
   * @param bundle - Approval bundle to record
   * @returns The recorded bundle
   */
  recordApprovalBundle(
    sessionId: string,
    bundle: ApprovalBundle,
  ): ApprovalBundle {
    this.requireSession(sessionId);

    // Load policy
    const policy = readApprovalPolicyJson(this.sessionRoot, sessionId);
    if (!policy) {
      throw new SessionError(
        "Cannot record approval bundle: no approval policy exists",
        "APPROVAL_POLICY_INVALID",
        { sessionId },
      );
    }

    // Verify sessionId matches
    if (bundle.sessionId !== sessionId) {
      throw new SessionError(
        `Bundle sessionId "${bundle.sessionId}" does not match session "${sessionId}"`,
        "ID_MISMATCH",
        { bundleSessionId: bundle.sessionId, sessionId },
      );
    }

    if (bundle.sessionId !== policy.sessionId) {
      throw new SessionError(
        `Bundle sessionId "${bundle.sessionId}" does not match policy sessionId "${policy.sessionId}"`,
        "ID_MISMATCH",
        { bundleSessionId: bundle.sessionId, policySessionId: policy.sessionId },
      );
    }

    // Build approver map
    const approverMap = new Map<string, typeof policy.approvers[0]>();
    for (const approver of policy.approvers) {
      approverMap.set(approver.approverId, approver);
    }

    // Validate and verify each signature
    for (const signature of bundle.signatures) {
      // Verify approver exists
      const approver = approverMap.get(signature.approverId);
      if (!approver) {
        throw new SessionError(
          `Signature ${signature.signatureId} references unknown approver "${signature.approverId}"`,
          "APPROVAL_BUNDLE_INVALID",
          { sessionId, signatureId: signature.signatureId },
        );
      }

      // Verify signature cryptographically
      try {
        verifySignature(signature, approver.publicKeyPem);
      } catch (error) {
        if (error instanceof SessionError) {
          throw error;
        }
        throw new SessionError(
          `Signature ${signature.signatureId} verification failed: ${String(error)}`,
          "APPROVAL_SIGNATURE_INVALID",
          { sessionId, signatureId: signature.signatureId },
        );
      }

      // Check nonce not reused
      try {
        appendApprovalNonce(this.sessionRoot, sessionId, signature.nonce);
      } catch (error) {
        if (error instanceof SessionError && error.code === "APPROVAL_REPLAY_DETECTED") {
          throw error;
        }
        throw new SessionError(
          `Failed to record approval nonce: ${String(error)}`,
          "APPROVAL_BUNDLE_INVALID",
          { sessionId, signatureId: signature.signatureId },
        );
      }
    }

    // Verify bundle hash
    const computedHash = computeBundleHash(bundle);
    if (bundle.bundleHash !== computedHash) {
      throw new SessionError(
        `Bundle hash mismatch: expected ${computedHash}, got ${bundle.bundleHash}`,
        "APPROVAL_BUNDLE_INVALID",
        { sessionId, expected: computedHash, got: bundle.bundleHash },
      );
    }

    writeApprovalBundleJson(this.sessionRoot, sessionId, bundle);

    return bundle;
  }

  /**
   * Verify session approvals against policy and artifacts.
   *
   * @param sessionId - Session ID
   * @returns Approval enforcement result
   */
  verifySessionApprovals(sessionId: string): ApprovalEnforcementResult {
    this.requireSession(sessionId);

    // Load policy and bundle
    const policy = readApprovalPolicyJson(this.sessionRoot, sessionId);
    if (!policy) {
      throw new SessionError(
        "Cannot verify approvals: no approval policy exists",
        "APPROVAL_POLICY_INVALID",
        { sessionId },
      );
    }

    const bundle = readApprovalBundleJson(this.sessionRoot, sessionId);
    if (!bundle) {
      throw new SessionError(
        "Cannot verify approvals: no approval bundle exists",
        "APPROVAL_BUNDLE_INVALID",
        { sessionId },
      );
    }

    // Load artifacts and compute hashes
    const lock = readDecisionLockJson(this.sessionRoot, sessionId);
    const plan = readExecutionPlanJson(this.sessionRoot, sessionId);
    const capsule = readPromptCapsuleJson(this.sessionRoot, sessionId);

    const artifacts: {
      decisionLockHash?: string;
      planHash?: string;
      capsuleHash?: string;
    } = {};

    if (lock) {
      artifacts.decisionLockHash = computeDecisionLockHash(lock);
    }

    if (plan) {
      const planLike: ExecutionPlanLike = {
        sessionId: plan.sessionId as string | undefined,
        dodId: plan.dodId as string | undefined,
        lockId: plan.lockId as string | undefined,
        steps: plan.steps as ExecutionPlanLike["steps"],
        allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
        ...plan,
      };
      artifacts.planHash = computePlanHash(planLike);
    }

    if (capsule) {
      artifacts.capsuleHash = computeCapsuleHash(capsule);
    }

    // Load used approval nonces
    const usedNonces = readUsedApprovalNoncesJson(this.sessionRoot, sessionId);

    // Enforce approvals
    const result = enforceApprovals({
      policy,
      bundle,
      artifacts,
      usedNonces,
    });

    // Throw if enforcement failed
    if (!result.passed) {
      throw new SessionError(
        `Approval enforcement failed: ${result.errors.join("; ")}`,
        "APPROVAL_QUORUM_NOT_MET",
        { sessionId, errors: result.errors },
      );
    }

    return result;
  }

  // -----------------------------------------------------------------------
  // Internal: require session exists
  // -----------------------------------------------------------------------

  private requireSession(sessionId: string): SessionRecord {
    const session = readSessionJson(this.sessionRoot, sessionId);
    if (!session) {
      throw new SessionError(
        `Session not found: ${sessionId}`,
        "SESSION_NOT_FOUND",
        { sessionId },
      );
    }
    return session;
  }
}
