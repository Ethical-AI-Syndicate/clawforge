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
  type SessionRecord,
} from "./persistence.js";
import {
  validateRunnerEvidence,
  deriveCompletionStatus as deriveCompletionFromEvidence,
  type ExecutionPlanLike,
} from "./evidence-validation.js";
import { RunnerEvidenceSchema, type RunnerEvidence } from "./runner-contract.js";

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

    const recorded = readRunnerEvidenceJson(this.sessionRoot, sessionId) ?? [];
    const planLike: ExecutionPlanLike = {
      sessionId: plan.sessionId as string | undefined,
      dodId: plan.dodId as string | undefined,
      lockId: plan.lockId as string | undefined,
      steps: plan.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: plan.allowedCapabilities as string[] | undefined,
      ...plan,
    };

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
    const next = [...recorded, parsed];
    writeRunnerEvidenceJson(this.sessionRoot, sessionId, next);
    return parsed;
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
