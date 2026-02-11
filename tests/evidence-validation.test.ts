import { describe, it, expect } from "vitest";
import {
  validateRunnerEvidence,
  deriveCompletionStatus,
  type ExecutionPlanLike,
} from "../src/session/evidence-validation.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone } from "../src/session/schemas.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const EVIDENCE_ID = "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    sessionId: SESSION_ID,
    title: "Test",
    items: [
      {
        id: "dod-1",
        description: "Item one",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
      {
        id: "dod-2",
        description: "Item two",
        verificationMethod: "command_exit_code",
        verificationCommand: "test",
        expectedExitCode: 0,
        notDoneConditions: [],
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "u", actorType: "human" },
  } as DefinitionOfDone;
}

function minimalPlan(): ExecutionPlanLike {
  return {
    sessionId: SESSION_ID,
    steps: [
      { stepId: "step-1", references: ["dod-1"] },
      { stepId: "step-2", references: ["dod-2"] },
    ],
    allowedCapabilities: ["read_only", "validate"],
  };
}

function validEvidence(overrides?: Partial<RunnerEvidence>): RunnerEvidence {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-1",
    evidenceId: EVIDENCE_ID,
    timestamp: TS,
    evidenceType: "artifact_recorded",
    artifactHash: HASH,
    verificationMetadata: {},
    capabilityUsed: "read_only",
    humanConfirmationProof: "confirmed",
    ...overrides,
  } as RunnerEvidence;
}

describe("validateRunnerEvidence", () => {
  describe("negative — rejection cases", () => {
    it("rejects missing humanConfirmationProof (schema)", () => {
      const r = validateRunnerEvidence(
        { ...validEvidence(), humanConfirmationProof: "" },
        minimalDoD(),
        minimalPlan(),
      );
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("humanConfirmationProof") || e.includes("schema"))).toBe(true);
    });

    it("rejects wrong capability when plan has allowedCapabilities", () => {
      const ev = validEvidence({ capabilityUsed: "forbidden_cap" });
      const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
      // Error should mention capability not registered or not in allowedCapabilities
      expect(
        r.errors.some(
          (e) =>
            (e.includes("Capability") && e.includes("allowedCapabilities")) ||
            e.includes("not registered"),
        ),
      ).toBe(true);
    });

    it("rejects step not in plan", () => {
      const ev = validEvidence({ stepId: "nonexistent-step" });
      const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("not found in execution plan"))).toBe(true);
    });

    it("rejects duplicate evidenceId", () => {
      const ev = validEvidence();
      const recorded = [ev];
      const ev2 = validEvidence({
        evidenceId: "e5f6a7b8-c9d0-4e1f-8a2b-3c4d5e6f7a9b",
        humanConfirmationProof: "second",
      });
      const r = validateRunnerEvidence(
        { ...ev2, evidenceId: ev.evidenceId },
        minimalDoD(),
        minimalPlan(),
        recorded,
      );
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("Duplicate evidenceId"))).toBe(true);
    });

    it("rejects mismatched DoD reference (evidenceType not in step refs)", () => {
      const ev = validEvidence({ evidenceType: "command_exit_code" });
      const plan = minimalPlan();
      (plan.steps![0]!).references = ["dod-1"];
      const r = validateRunnerEvidence(ev, minimalDoD(), plan, []);
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("evidenceType") && e.includes("does not match"))).toBe(true);
    });

    it("rejects step with no DoD references", () => {
      const plan = minimalPlan();
      (plan.steps![0]!).references = [];
      const r = validateRunnerEvidence(validEvidence(), minimalDoD(), plan, []);
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("no DoD references"))).toBe(true);
    });

    it("rejects forged sessionId when plan has sessionId", () => {
      const ev = validEvidence({
        sessionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      });
      const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("sessionId") && e.includes("does not match"))).toBe(true);
    });

    it("rejects invalid evidenceType (not matching any ref)", () => {
      const dod = minimalDoD();
      const plan = minimalPlan();
      (plan.steps![0]!).references = ["dod-1"];
      const ev = validEvidence({ evidenceType: "file_exists" });
      const r = validateRunnerEvidence(ev, dod, plan, []);
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("evidenceType"))).toBe(true);
    });

    it("rejects malformed timestamp (schema)", () => {
      const ev = validEvidence({ timestamp: "not-a-date" } as RunnerEvidence);
      const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it("rejects missing artifactHash (schema)", () => {
      const ev = { ...validEvidence(), artifactHash: "" };
      const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
      expect(r.errors.some((e) => e.includes("schema") || e.includes("artifactHash"))).toBe(true);
    });

    it("rejects null evidence", () => {
      const r = validateRunnerEvidence(null, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
    });

    it("rejects non-object evidence", () => {
      const r = validateRunnerEvidence("string", minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
    });

    it("rejects hash not 64 chars (schema)", () => {
      const ev = validEvidence({ artifactHash: "short" } as RunnerEvidence);
      const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
      expect(r.passed).toBe(false);
    });
  });

  describe("positive — acceptance", () => {
    it("accepts valid evidence with matching step and capability", () => {
      const r = validateRunnerEvidence(
        validEvidence(),
        minimalDoD(),
        minimalPlan(),
        [],
      );
      expect(r.passed).toBe(true);
      expect(r.errors).toHaveLength(0);
    });

    it("accepts when allowedCapabilities is empty (no cap check)", () => {
      const plan = minimalPlan();
      plan.allowedCapabilities = [];
      // Use a registered capability since we now require all capabilities to be registered
      const registeredCap = getAllCapabilityIds()[0] || "read_only";
      const r = validateRunnerEvidence(
        validEvidence({ capabilityUsed: registeredCap }),
        minimalDoD(),
        plan,
        [],
      );
      expect(r.passed).toBe(true);
    });

    it("accepts evidence for step referencing multiple DoD items when type matches one", () => {
      const plan = minimalPlan();
      (plan.steps![0]!).references = ["dod-1", "dod-2"];
      const ev = validEvidence({ evidenceType: "artifact_recorded" });
      const r = validateRunnerEvidence(ev, minimalDoD(), plan, []);
      expect(r.passed).toBe(true);
    });

    it("returns derivedCompletionState false when validation passes (single evidence)", () => {
      const r = validateRunnerEvidence(
        validEvidence(),
        minimalDoD(),
        minimalPlan(),
        [],
      );
      expect(r.passed).toBe(true);
      expect(r.derivedCompletionState).toBe(false);
    });

    it("accepts when plan has no sessionId (no sessionId match check)", () => {
      const plan = minimalPlan();
      delete plan.sessionId;
      const r = validateRunnerEvidence(validEvidence(), minimalDoD(), plan, []);
      expect(r.passed).toBe(true);
    });
  });
});

describe("validateRunnerEvidence — additional negative", () => {
  it("rejects invalid evidenceId format (schema)", () => {
    const ev = validEvidence({ evidenceId: "not-a-uuid" } as RunnerEvidence);
    const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
    expect(r.passed).toBe(false);
  });

  it("rejects missing capabilityUsed (schema)", () => {
    const ev = { ...validEvidence(), capabilityUsed: "" };
    const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
    expect(r.passed).toBe(false);
  });

  it("rejects missing stepId (schema)", () => {
    const ev = validEvidence({ stepId: "" } as RunnerEvidence);
    const r = validateRunnerEvidence(ev, minimalDoD(), minimalPlan(), []);
    expect(r.passed).toBe(false);
  });

  it("rejects evidence with wrong evidenceType for step ref", () => {
    const plan = minimalPlan();
    (plan.steps![0]!).references = ["dod-1"];
    const ev = validEvidence({ evidenceType: "command_exit_code" });
    const r = validateRunnerEvidence(ev, minimalDoD(), plan, []);
    expect(r.passed).toBe(false);
    expect(r.errors[0]).toContain("evidenceType");
  });

  it("rejects when DoD has no matching item for reference", () => {
    const plan = minimalPlan();
    (plan.steps![0]!).references = ["dod-nonexistent"];
    const r = validateRunnerEvidence(validEvidence(), minimalDoD(), plan, []);
    expect(r.passed).toBe(false);
  });
});

describe("deriveCompletionStatus", () => {
  it("returns false when gate not passed", () => {
    const plan = minimalPlan();
    const evidence = [validEvidence()];
    expect(deriveCompletionStatus(plan, evidence, false)).toBe(false);
  });

  it("returns false when no steps in plan", () => {
    expect(
      deriveCompletionStatus(
        { steps: [] },
        [],
        true,
      ),
    ).toBe(false);
  });

  it("returns false when not every step has evidence", () => {
    const plan = minimalPlan();
    const evidence = [validEvidence({ stepId: "step-1" })];
    expect(deriveCompletionStatus(plan, evidence, true)).toBe(false);
  });

  it("returns true when gate passed and every step has at least one evidence", () => {
    const plan = minimalPlan();
    const evidence = [
      validEvidence({ stepId: "step-1", evidenceId: "a1b2c3d4-e5f6-4a7b-8c9d-8e1f2a3b4c5d" }),
      validEvidence({
        stepId: "step-2",
        evidenceId: "b2c3d4e5-f6a7-4b8c-9d0e-8f2a3b4c5d6e",
        evidenceType: "command_exit_code",
      }),
    ];
    expect(deriveCompletionStatus(plan, evidence, true)).toBe(true);
  });
});
