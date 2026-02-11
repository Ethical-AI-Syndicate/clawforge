import { describe, it, expect } from "vitest";
import { computePlanHash, validatePlanHashBinding } from "../src/session/plan-hash.js";
import { SessionError } from "../src/session/errors.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import type { DecisionLock } from "../src/session/schemas.js";

describe("plan-hash", () => {
  const mockPlan: ExecutionPlanLike = {
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
    dodId: "223e4567-e89b-12d3-a456-426614174000",
    lockId: "323e4567-e89b-12d3-a456-426614174000",
    steps: [
      {
        stepId: "step1",
        goal: "Test step",
      },
    ],
    allowedCapabilities: ["read"],
  };

  const createMockLock = (planHash: string): DecisionLock => ({
    schemaVersion: "1.0.0",
    lockId: "323e4567-e89b-12d3-a456-426614174000",
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
    dodId: "223e4567-e89b-12d3-a456-426614174000",
    goal: "Test goal",
    nonGoals: ["Not this"],
    interfaces: [],
    invariants: ["Must work"],
    constraints: [],
    failureModes: [],
    risksAndTradeoffs: [],
    status: "approved",
    approvalMetadata: {
      approvedBy: "test",
      approvedAt: "2024-01-01T00:00:00.000Z",
      approvalMethod: "test",
    },
    createdAt: "2024-01-01T00:00:00.000Z",
    createdBy: {
      actorId: "test",
      actorType: "human",
    },
    planHash,
  });

  it("computes stable plan hash", () => {
    const hash1 = computePlanHash(mockPlan);
    const hash2 = computePlanHash(mockPlan);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("plan hash changes when plan changes", () => {
    const hash1 = computePlanHash(mockPlan);
    const modifiedPlan = {
      ...mockPlan,
      steps: [
        {
          stepId: "step1",
          goal: "Different goal",
        },
      ],
    };
    const hash2 = computePlanHash(modifiedPlan);
    expect(hash1).not.toBe(hash2);
  });

  it("validates plan hash binding when match", () => {
    const hash = computePlanHash(mockPlan);
    const lock = createMockLock(hash);
    expect(() => validatePlanHashBinding(mockPlan, lock)).not.toThrow();
  });

  it("throws PLAN_HASH_MISSING when lock missing planHash", () => {
    const lock = createMockLock("dummy");
    delete (lock as Record<string, unknown>).planHash;
    expect(() => validatePlanHashBinding(mockPlan, lock)).toThrow(SessionError);
    try {
      validatePlanHashBinding(mockPlan, lock);
    } catch (e) {
      expect((e as SessionError).code).toBe("PLAN_HASH_MISSING");
    }
  });

  it("throws PLAN_HASH_MISMATCH when hash mismatch", () => {
    const lock = createMockLock("a".repeat(64));
    expect(() => validatePlanHashBinding(mockPlan, lock)).toThrow(SessionError);
    try {
      validatePlanHashBinding(mockPlan, lock);
    } catch (e) {
      expect((e as SessionError).code).toBe("PLAN_HASH_MISMATCH");
      expect((e as SessionError).details.expected).toBe(computePlanHash(mockPlan));
      expect((e as SessionError).details.got).toBe("a".repeat(64));
    }
  });
});
