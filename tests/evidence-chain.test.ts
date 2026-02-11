import { describe, it, expect } from "vitest";
import {
  computeEvidenceHash,
  validateEvidenceChain,
} from "../src/session/evidence-chain.js";
import { SessionError } from "../src/session/errors.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import { computePlanHash } from "../src/session/plan-hash.js";

describe("evidence-chain", () => {
  const mockPlan: ExecutionPlanLike = {
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
    dodId: "223e4567-e89b-12d3-a456-426614174000",
    lockId: "323e4567-e89b-12d3-a456-426614174000",
    steps: [
      {
        stepId: "step1",
      },
    ],
    allowedCapabilities: ["read"],
  };

  const planHash = computePlanHash(mockPlan);

  const createEvidence = (
    stepId: string,
    evidenceId: string,
    timestamp: string,
    planHash: string,
    prevEvidenceHash: string | null = null,
  ): RunnerEvidence => {
    const evidence: RunnerEvidence = {
      schemaVersion: "1.0.0",
      sessionId: "123e4567-e89b-12d3-a456-426614174000",
      stepId,
      evidenceId,
      timestamp,
      evidenceType: "artifact_recorded",
      artifactHash: "a".repeat(64),
      verificationMetadata: {},
      capabilityUsed: "read",
      humanConfirmationProof: "test",
      planHash,
      prevEvidenceHash,
    };
    const hash = computeEvidenceHash(evidence);
    return {
      ...evidence,
      evidenceHash: hash,
    };
  };

  it("computes evidence hash", () => {
    const evidence = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      null,
    );
    expect(evidence.evidenceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("validates valid chain", () => {
    const ev1 = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      null,
    );
    const ev2 = createEvidence(
      "step1",
      "e2",
      "2024-01-01T00:01:00.000Z",
      planHash,
      ev1.evidenceHash!,
    );
    expect(() => validateEvidenceChain([ev1, ev2], mockPlan)).not.toThrow();
  });

  it("throws EVIDENCE_CHAIN_INVALID when planHash missing", () => {
    const evidence = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      null,
    );
    delete (evidence as Record<string, unknown>).planHash;
    expect(() => validateEvidenceChain([evidence], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([evidence], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("planHash");
    }
  });

  it("throws EVIDENCE_CHAIN_INVALID when planHash mismatch", () => {
    const evidence = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      "wrong".padEnd(64, "0"),
      null,
    );
    expect(() => validateEvidenceChain([evidence], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([evidence], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("planHash");
    }
  });

  it("throws EVIDENCE_CHAIN_INVALID when evidenceHash missing", () => {
    const evidence = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      null,
    );
    delete (evidence as Record<string, unknown>).evidenceHash;
    expect(() => validateEvidenceChain([evidence], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([evidence], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("evidenceHash");
    }
  });

  it("throws EVIDENCE_CHAIN_INVALID when evidenceHash mismatch", () => {
    const evidence = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      null,
    );
    (evidence as Record<string, unknown>).evidenceHash = "wrong".padEnd(64, "0");
    expect(() => validateEvidenceChain([evidence], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([evidence], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("evidenceHash");
    }
  });

  it("throws EVIDENCE_CHAIN_INVALID when first item has non-null prevEvidenceHash", () => {
    const evidence = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      "a".repeat(64),
    );
    expect(() => validateEvidenceChain([evidence], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([evidence], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("prevEvidenceHash");
    }
  });

  it("throws EVIDENCE_CHAIN_INVALID when prevEvidenceHash mismatch", () => {
    const ev1 = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:00:00.000Z",
      planHash,
      null,
    );
    const ev2 = createEvidence(
      "step1",
      "e2",
      "2024-01-01T00:01:00.000Z",
      planHash,
      "wrong".padEnd(64, "0"),
    );
    expect(() => validateEvidenceChain([ev1, ev2], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([ev1, ev2], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("prevEvidenceHash");
    }
  });

  it("throws EVIDENCE_CHAIN_INVALID when timestamps non-monotonic", () => {
    const ev1 = createEvidence(
      "step1",
      "e1",
      "2024-01-01T00:01:00.000Z",
      planHash,
      null,
    );
    const ev2 = createEvidence(
      "step1",
      "e2",
      "2024-01-01T00:00:00.000Z",
      planHash,
      ev1.evidenceHash!,
    );
    expect(() => validateEvidenceChain([ev1, ev2], mockPlan)).toThrow(SessionError);
    try {
      validateEvidenceChain([ev1, ev2], mockPlan);
    } catch (e) {
      expect((e as SessionError).code).toBe("EVIDENCE_CHAIN_INVALID");
      expect((e as SessionError).details.field).toBe("timestamp");
    }
  });
});
