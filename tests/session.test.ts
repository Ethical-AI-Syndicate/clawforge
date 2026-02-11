import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventStore } from "../src/audit/store.js";
import { SessionManager } from "../src/session/session.js";
import { SessionError } from "../src/session/errors.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import {
  readSessionJson,
  readDoDJson,
  readDecisionLockJson,
  readGateResultJson,
} from "../src/session/persistence.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ACTOR = { actorId: "test-user", actorType: "human" as const };

function makeDod(sessionId: string, dodId: string): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId,
    sessionId,
    title: "Test DoD",
    items: [
      {
        id: "tests-pass",
        description: "All unit tests pass with exit code 0",
        verificationMethod: "command_exit_code",
        verificationCommand: "pnpm test",
        expectedExitCode: 0,
        notDoneConditions: ["Any test fails"],
      },
    ],
    createdAt: "2026-02-10T12:00:00.000Z",
    createdBy: ACTOR,
  } as DefinitionOfDone;
}

function makeLock(sessionId: string, dodId: string, lockId: string): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId,
    sessionId,
    dodId,
    goal: "Implement the feature correctly",
    nonGoals: ["Performance optimization"],
    interfaces: [
      { name: "API endpoint", description: "POST /api/test", type: "api" },
    ],
    invariants: ["Data integrity maintained"],
    constraints: ["Use existing dependencies"],
    failureModes: [
      { description: "Invalid input", mitigation: "Return 400" },
    ],
    risksAndTradeoffs: [
      { description: "Added complexity", severity: "low", accepted: true },
    ],
    status: "draft",
    createdAt: "2026-02-10T12:00:00.000Z",
    createdBy: ACTOR,
  } as DecisionLock;
}

const DOD_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const LOCK_ID = "c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f";

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SessionManager", () => {
  let store: EventStore;
  let tmpDir: string;
  let sessionDir: string;
  let mgr: SessionManager;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawforge-session-"));
    sessionDir = join(tmpDir, "sessions");
    store = new EventStore(join(tmpDir, "test.sqlite"));
    mgr = new SessionManager(store, sessionDir);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // =================================================================
  // NEGATIVE TESTS FIRST — try to break the system
  // =================================================================

  describe("failure modes", () => {
    it("gate check with missing DoD fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      const result = mgr.evaluateGate(session.sessionId);
      expect(result.passed).toBe(false);
      const dodCheck = result.checks.find((c) => c.checkId === "dod-exists");
      expect(dodCheck?.passed).toBe(false);
    });

    it("lock approval without DoD fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      expect(() =>
        mgr.approveDecisionLock(session.sessionId, {
          approvedBy: "mike",
          approvedAt: "2026-02-10T12:00:00.000Z",
          approvalMethod: "cli-approve",
        }),
      ).toThrow(SessionError);
    });

    it("lock record without DoD fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      expect(() => mgr.recordDecisionLock(session.sessionId, lock, ACTOR)).toThrow(
        SessionError,
      );
      try {
        mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      } catch (e) {
        expect((e as SessionError).code).toBe("DOD_MISSING");
      }
    });

    it("gate pass with mismatched IDs fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });

      // Record DoD
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);

      // Record lock with mismatched dodId
      const lock = makeLock(session.sessionId, "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", LOCK_ID);
      expect(() =>
        mgr.recordDecisionLock(session.sessionId, lock, ACTOR),
      ).toThrow(SessionError);
      try {
        mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      } catch (e) {
        expect((e as SessionError).code).toBe("ID_MISMATCH");
      }
    });

    it("session with missing files fails on status check", () => {
      expect(() =>
        mgr.getSessionStatus("aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee"),
      ).toThrow(SessionError);
      try {
        mgr.getSessionStatus("aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee");
      } catch (e) {
        expect((e as SessionError).code).toBe("SESSION_NOT_FOUND");
      }
    });

    it("DoD with mismatched sessionId fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      const dod = makeDod("aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee", DOD_ID);
      expect(() => mgr.recordDoD(session.sessionId, dod, ACTOR)).toThrow(
        SessionError,
      );
      try {
        mgr.recordDoD(session.sessionId, dod, ACTOR);
      } catch (e) {
        expect((e as SessionError).code).toBe("ID_MISMATCH");
      }
    });

    it("lock record with non-draft status fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);

      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      (lock as Record<string, unknown>).status = "approved";
      (lock as Record<string, unknown>).approvalMetadata = {
        approvedBy: "sneaky",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "bypass",
      };

      expect(() =>
        mgr.recordDecisionLock(session.sessionId, lock, ACTOR),
      ).toThrow(SessionError);
      try {
        mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      } catch (e) {
        expect((e as SessionError).code).toBe("MODE_VIOLATION");
      }
    });

    it("double approval fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);
      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      mgr.approveDecisionLock(session.sessionId, {
        approvedBy: "mike",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "cli-approve",
      });

      // Second approval should fail
      expect(() =>
        mgr.approveDecisionLock(session.sessionId, {
          approvedBy: "mike",
          approvedAt: "2026-02-10T13:00:00.000Z",
          approvalMethod: "cli-approve",
        }),
      ).toThrow(SessionError);
    });

    it("recordDoD after lock approval fails (mode violation)", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Test session",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);
      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      mgr.approveDecisionLock(session.sessionId, {
        approvedBy: "mike",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "cli-approve",
      });

      // Session is now "locked", should reject new DoD
      const newDod = makeDod(session.sessionId, "d4e5f6a7-b8c9-4d0e-af1f-3a4b5c6d7e8f");
      expect(() => mgr.recordDoD(session.sessionId, newDod, ACTOR)).toThrow(
        SessionError,
      );
      try {
        mgr.recordDoD(session.sessionId, newDod, ACTOR);
      } catch (e) {
        expect((e as SessionError).code).toBe("MODE_VIOLATION");
      }
    });
  });

  // =================================================================
  // POSITIVE TESTS — happy path
  // =================================================================

  describe("happy path", () => {
    it("creates a session with exploration run", () => {
      const session = mgr.createSession({
        title: "Test Session",
        description: "A test",
        actor: ACTOR,
      });
      expect(session.sessionId).toBeDefined();
      expect(session.explorationRunId).toBeDefined();
      expect(session.title).toBe("Test Session");
    });

    it("writes session.json to disk", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const read = readSessionJson(sessionDir, session.sessionId);
      expect(read).toBeDefined();
      expect(read!.sessionId).toBe(session.sessionId);
    });

    it("exploration run starts with RunStarted + ExplorationStarted", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const events = store.listEvents(session.explorationRunId);
      expect(events.length).toBe(2);
      expect(events[0]!.type).toBe("RunStarted");
      expect(events[1]!.type).toBe("ExplorationStarted");
    });

    it("records DoD and writes dod.json", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      const event = mgr.recordDoD(session.sessionId, dod, ACTOR);
      expect(event.type).toBe("DoDRecorded");

      const read = readDoDJson(sessionDir, session.sessionId);
      expect(read).toBeDefined();
      expect(read!.dodId).toBe(DOD_ID);
    });

    it("records Decision Lock and writes decision-lock.json", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);

      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      const event = mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      expect(event.type).toBe("DecisionLockRecorded");

      const read = readDecisionLockJson(sessionDir, session.sessionId);
      expect(read).toBeDefined();
      expect(read!.lockId).toBe(LOCK_ID);
      expect(read!.status).toBe("draft");
    });

    it("approves lock and updates decision-lock.json", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);
      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      mgr.recordDecisionLock(session.sessionId, lock, ACTOR);

      const event = mgr.approveDecisionLock(session.sessionId, {
        approvedBy: "mike",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "cli-approve",
      });
      expect(event.type).toBe("DecisionLockApproved");

      const read = readDecisionLockJson(sessionDir, session.sessionId);
      expect(read!.status).toBe("approved");
      expect(read!.approvalMetadata?.approvedBy).toBe("mike");
    });

    it("gate passes for fully valid session", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);
      const lock = makeLock(session.sessionId, DOD_ID, LOCK_ID);
      mgr.recordDecisionLock(session.sessionId, lock, ACTOR);
      mgr.approveDecisionLock(session.sessionId, {
        approvedBy: "mike",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "cli-approve",
      });

      const result = mgr.evaluateGate(session.sessionId);
      expect(result.passed).toBe(true);
    });

    it("writes gate-result.json on evaluation", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      mgr.evaluateGate(session.sessionId);

      const read = readGateResultJson(sessionDir, session.sessionId);
      expect(read).toBeDefined();
      expect(read!.passed).toBe(false); // No DoD yet
    });
  });

  // =================================================================
  // STATUS DERIVATION
  // =================================================================

  describe("status derivation", () => {
    it("returns exploring when no DoD", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      expect(mgr.getSessionStatus(session.sessionId)).toBe("exploring");
    });

    it("returns exploring when DoD exists but no lock", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      mgr.recordDoD(session.sessionId, makeDod(session.sessionId, DOD_ID), ACTOR);
      expect(mgr.getSessionStatus(session.sessionId)).toBe("exploring");
    });

    it("returns exploring when lock is draft", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      mgr.recordDoD(session.sessionId, makeDod(session.sessionId, DOD_ID), ACTOR);
      mgr.recordDecisionLock(
        session.sessionId,
        makeLock(session.sessionId, DOD_ID, LOCK_ID),
        ACTOR,
      );
      expect(mgr.getSessionStatus(session.sessionId)).toBe("exploring");
    });

    it("returns locked when lock is approved", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      mgr.recordDoD(session.sessionId, makeDod(session.sessionId, DOD_ID), ACTOR);
      mgr.recordDecisionLock(
        session.sessionId,
        makeLock(session.sessionId, DOD_ID, LOCK_ID),
        ACTOR,
      );
      mgr.approveDecisionLock(session.sessionId, {
        approvedBy: "mike",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "cli-approve",
      });
      expect(mgr.getSessionStatus(session.sessionId)).toBe("locked");
    });

    it("returns eligible when gate passes", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      mgr.recordDoD(session.sessionId, makeDod(session.sessionId, DOD_ID), ACTOR);
      mgr.recordDecisionLock(
        session.sessionId,
        makeLock(session.sessionId, DOD_ID, LOCK_ID),
        ACTOR,
      );
      mgr.approveDecisionLock(session.sessionId, {
        approvedBy: "mike",
        approvedAt: "2026-02-10T12:00:00.000Z",
        approvalMethod: "cli-approve",
      });
      mgr.evaluateGate(session.sessionId);
      expect(mgr.getSessionStatus(session.sessionId)).toBe("eligible");
    });

    it("returns blocked when gate fails", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      // Evaluate gate without DoD → fails
      mgr.evaluateGate(session.sessionId);
      expect(mgr.getSessionStatus(session.sessionId)).toBe("blocked");
    });
  });

  // =================================================================
  // KERNEL ISOLATION
  // =================================================================

  describe("kernel isolation", () => {
    it("exploration run chain verifies independently", () => {
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });
      const dod = makeDod(session.sessionId, DOD_ID);
      mgr.recordDoD(session.sessionId, dod, ACTOR);

      const result = store.verifyRunChain(session.explorationRunId);
      expect(result.valid).toBe(true);
      expect(result.eventCount).toBe(3); // RunStarted + ExplorationStarted + DoDRecorded
    });

    it("session removal does not affect kernel event store integrity", () => {
      // Create a regular kernel run
      const runId = "d4e5f6a7-b8c9-4d0e-af1f-3a4b5c6d7e8f";
      store.createRun(runId);
      store.appendEvent(runId, {
        eventId: "e5f6a7b8-c9d0-4e1f-a2b3-4c5d6e7f8a9b",
        type: "RunStarted",
        schemaVersion: "1.0.0",
        actor: ACTOR,
        payload: {},
      });

      // Create a session
      const session = mgr.createSession({
        title: "Test",
        description: "Desc",
        actor: ACTOR,
      });

      // Kernel run verifies independently
      const kernelResult = store.verifyRunChain(runId);
      expect(kernelResult.valid).toBe(true);

      // Session run verifies independently
      const sessionResult = store.verifyRunChain(session.explorationRunId);
      expect(sessionResult.valid).toBe(true);

      // Both are separate runs
      expect(runId).not.toBe(session.explorationRunId);
    });
  });
});
