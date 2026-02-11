import { describe, it, expect } from "vitest";
import { lintExecutionPlan } from "../src/session/execution-plan-lint.js";
import { SessionError } from "../src/session/errors.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone } from "../src/session/schemas.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GOAL = "Build a deterministic audit trail";

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    sessionId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
    title: "Test DoD",
    items: [
      {
        id: "dod-1",
        description: "Unit tests pass with exit code zero",
        verificationMethod: "command_exit_code",
        verificationCommand: "run-tests",
        expectedExitCode: 0,
        notDoneConditions: ["Tests fail"],
      },
      {
        id: "dod-2",
        description: "Artifact recorded in store",
        verificationMethod: "artifact_recorded",
        notDoneConditions: ["No artifact"],
      },
    ],
    createdAt: "2026-02-10T12:00:00.000Z",
    createdBy: { actorId: "test", actorType: "human" },
  };
}

function cleanPlan(goal: string) {
  return {
    decisionLockGoal: goal,
    nonExecutableGuarantees: {
      noShellExecution: true,
      noNetworkAccess: true,
      noFilesystemMutation: true,
      noProcessSpawning: true,
      noImplicitIO: true,
    },
    steps: [
      { stepId: "s1", references: ["dod-1"], title: "Step one" },
      { stepId: "s2", references: ["dod-2"], title: "Step two" },
    ],
    completionCriteria: ["dod-1", "dod-2"],
  };
}

// =======================================================================
// Forbidden patterns
// =======================================================================

describe("lintExecutionPlan", () => {
  describe("forbidden patterns", () => {
    it("rejects plan with npm install", () => {
      const plan = {
        ...cleanPlan(GOAL),
        description: "Run npm install to get deps",
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("npm");
      }
    });

    it("rejects plan with curl https://", () => {
      const plan = {
        ...cleanPlan(GOAL),
        note: "Do not use curl https://example.com",
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toMatch(/curl|https/);
      }
    });

    it("rejects plan with rm -rf", () => {
      const plan = {
        ...cleanPlan(GOAL),
        warning: "Never run rm -rf in production",
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("rm");
      }
    });
  });

  describe("step references", () => {
    it("rejects plan with missing references", () => {
      const plan = {
        ...cleanPlan(GOAL),
        steps: [
          { stepId: "s1", title: "Step one" },
          { stepId: "s2", references: ["dod-2"], title: "Step two" },
        ],
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toMatch(/references/);
      }
    });

    it("rejects plan with empty references array", () => {
      const plan = {
        ...cleanPlan(GOAL),
        steps: [
          { stepId: "s1", references: [], title: "Step one" },
          { stepId: "s2", references: ["dod-2"], title: "Step two" },
        ],
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
    });

    it("rejects plan referencing non-existent DoD id", () => {
      const plan = {
        ...cleanPlan(GOAL),
        steps: [
          { stepId: "s1", references: ["dod-1"], title: "Step one" },
          { stepId: "s2", references: ["dod-nonexistent"], title: "Step two" },
        ],
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("non-existent");
      }
    });
  });

  describe("nonExecutableGuarantees", () => {
    it("rejects plan missing nonExecutableGuarantees", () => {
      const plan = {
        decisionLockGoal: GOAL,
        steps: [
          { stepId: "s1", references: ["dod-1"] },
          { stepId: "s2", references: ["dod-2"] },
        ],
        completionCriteria: ["dod-1", "dod-2"],
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("nonExecutableGuarantees");
      }
    });

    it("rejects plan with false guarantee flag", () => {
      const plan = {
        ...cleanPlan(GOAL),
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: false,
          noImplicitIO: true,
        },
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("must be true");
      }
    });

    it("rejects plan with missing guarantee key", () => {
      const plan = {
        ...cleanPlan(GOAL),
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          // noImplicitIO missing
        },
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("noImplicitIO");
      }
    });
  });

  describe("goal reference", () => {
    it("rejects plan that does not include exact goal string", () => {
      const plan = cleanPlan("Different goal text");
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toContain("goal");
      }
    });
  });

  describe("accepts clean plan", () => {
    it("accepts plan with no forbidden patterns, valid references, and all guarantees true", () => {
      const plan = cleanPlan(GOAL);
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).not.toThrow();
    });

    it("accepts plan when goal appears in plan text", () => {
      const plan = cleanPlan(GOAL);
      lintExecutionPlan(plan, minimalDoD(), GOAL);
    });
  });

  describe("steps and completionCriteria", () => {
    it("rejects plan with no steps", () => {
      const plan = {
        decisionLockGoal: GOAL,
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          noImplicitIO: true,
        },
        steps: [],
        completionCriteria: ["dod-1"],
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
    });

    it("rejects plan with completionCriteria referencing non-DoD id", () => {
      const plan = {
        ...cleanPlan(GOAL),
        completionCriteria: ["dod-1", "not-a-dod-id"],
      };
      expect(() => lintExecutionPlan(plan, minimalDoD(), GOAL)).toThrow(
        SessionError,
      );
      try {
        lintExecutionPlan(plan, minimalDoD(), GOAL);
      } catch (e) {
        expect((e as SessionError).code).toBe("EXECUTION_PLAN_LINT_FAILED");
        expect((e as Error).message).toMatch(/completionCriteria|non-DoD/);
      }
    });
  });

  describe("invalid plan shape", () => {
    it("rejects null plan", () => {
      expect(() =>
        lintExecutionPlan(null, minimalDoD(), GOAL),
      ).toThrow(SessionError);
    });

    it("rejects non-object plan", () => {
      expect(() =>
        lintExecutionPlan("not an object", minimalDoD(), GOAL),
      ).toThrow(SessionError);
    });
  });
});
