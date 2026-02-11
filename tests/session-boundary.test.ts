/**
 * Session Boundary Tests — Phase G
 *
 * Tests for session boundary validation ensuring all artifacts belong to the same session.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import { validateSessionBoundary } from "../src/session/session-boundary.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type {
  DefinitionOfDone,
  DecisionLock,
} from "../src/session/schemas.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import type { SessionAnchor } from "../src/session/session-anchor.js";
import { computePlanHash } from "../src/session/plan-hash.js";
import { computeEvidenceHash } from "../src/session/evidence-chain.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_SESSION_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

function minimalDoD(sessionId: string = SESSION_ID): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    sessionId,
    title: "Test",
    items: [
      {
        id: "dod-1",
        description: "Item one",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "u", actorType: "human" },
  } as DefinitionOfDone;
}

function minimalLock(sessionId: string = SESSION_ID): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    sessionId,
    dodId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    goal: "Test goal",
    nonGoals: [],
    interfaces: [],
    invariants: [],
    constraints: [],
    failureModes: [],
    risksAndTradeoffs: [],
    status: "approved",
    approvalMetadata: {
      approvedBy: "user",
      approvedAt: TS,
      approvalMethod: "manual",
    },
    createdAt: TS,
    createdBy: { actorId: "u", actorType: "human" },
  } as DecisionLock;
}

function minimalPlan(sessionId: string = SESSION_ID): ExecutionPlanLike {
  const caps = getAllCapabilityIds();
  return {
    sessionId,
    steps: [{ stepId: "step-1", references: ["dod-1"] }],
    allowedCapabilities: caps.length > 0 ? [caps[0]!] : [],
  };
}

function minimalEvidence(
  sessionId: string = SESSION_ID,
  stepId: string = "step-1",
): RunnerEvidence {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    stepId,
    evidenceId: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
    timestamp: TS,
    evidenceType: "artifact_recorded",
    artifactHash: HASH,
    verificationMetadata: {},
    capabilityUsed: getAllCapabilityIds()[0] || "read_file",
    humanConfirmationProof: "confirmed",
  } as RunnerEvidence;
}

describe("Session Boundary Validation", () => {
  describe("sessionId matching", () => {
    it("should accept all artifacts with matching sessionId", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      evidence.planHash = computePlanHash(plan);
      evidence.evidenceHash = computeEvidenceHash(evidence);

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).not.toThrow();
    });

    it("should reject DoD with mismatched sessionId", () => {
      const dod = minimalDoD(OTHER_SESSION_ID);
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence();

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(/DoD sessionId/);
    });

    it("should reject Decision Lock with mismatched sessionId", () => {
      const dod = minimalDoD();
      const lock = minimalLock(OTHER_SESSION_ID);
      const plan = minimalPlan();
      const evidence = minimalEvidence();

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(/Decision Lock sessionId/);
    });

    it("should reject Execution Plan with mismatched sessionId", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan(OTHER_SESSION_ID);
      const evidence = minimalEvidence();

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(/Execution Plan sessionId/);
    });

    it("should reject Runner Evidence with mismatched sessionId", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence(OTHER_SESSION_ID);

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(/Runner Evidence.*sessionId/);
    });
  });

  describe("planHash binding", () => {
    it("should accept lock with matching planHash", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).not.toThrow();
    });

    it("should reject lock with mismatched planHash", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const lock = {
        ...minimalLock(),
        planHash: "b".repeat(64),
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(/planHash/);
    });

    it("should validate evidence planHash matches computed plan hash", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = minimalLock();
      const evidence = {
        ...minimalEvidence(),
        planHash: "b".repeat(64), // Wrong hash
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
        }),
      ).toThrow(/planHash/);
    });
  });

  describe("anchor validation", () => {
    it("should accept anchor with matching bindings", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();
      evidence.planHash = planHash;
      evidence.evidenceHash = computeEvidenceHash(evidence);

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: lock.lockId,
        finalEvidenceHash: evidence.evidenceHash!,
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).not.toThrow();
    });

    it("should reject anchor with mismatched sessionId", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();
      evidence.planHash = planHash;
      evidence.evidenceHash = computeEvidenceHash(evidence);

      const anchor: SessionAnchor = {
        sessionId: OTHER_SESSION_ID,
        planHash,
        lockId: lock.lockId,
        finalEvidenceHash: evidence.evidenceHash!,
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(/Anchor sessionId/);
    });

    it("should reject anchor with mismatched lockId", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();
      evidence.planHash = planHash;
      evidence.evidenceHash = computeEvidenceHash(evidence);

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: "wrong-lock-id",
        finalEvidenceHash: evidence.evidenceHash!,
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(/lockId/);
    });

    it("should reject anchor with mismatched planHash", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();
      evidence.planHash = planHash;
      evidence.evidenceHash = computeEvidenceHash(evidence);

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash: "b".repeat(64),
        lockId: lock.lockId,
        finalEvidenceHash: evidence.evidenceHash!,
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(/planHash/);
    });

    it("should reject anchor with mismatched finalEvidenceHash", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };
      const evidence = minimalEvidence();
      evidence.planHash = planHash;
      evidence.evidenceHash = computeEvidenceHash(evidence);

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: lock.lockId,
        finalEvidenceHash: "b".repeat(64),
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          anchor,
        }),
      ).toThrow(/finalEvidenceHash/);
    });

    it("should reject anchor when no evidence exists", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      const planHash = computePlanHash(plan);
      const lock = {
        ...minimalLock(),
        planHash,
      } as DecisionLock & { planHash: string };

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: lock.lockId,
        finalEvidenceHash: HASH,
      };

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [],
          anchor,
        }),
      ).toThrow(SessionError);
      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [],
          anchor,
        }),
      ).toThrow(/no runner evidence/);
    });
  });

  describe("cross-session artifact reuse prevention", () => {
    it("should detect when evidence from different session is mixed", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence1 = minimalEvidence(SESSION_ID, "step-1");
      const evidence2 = minimalEvidence(OTHER_SESSION_ID, "step-2");

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence1, evidence2],
        }),
      ).toThrow(SessionError);
    });
  });
});
