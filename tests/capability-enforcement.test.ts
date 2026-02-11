/**
 * Capability Enforcement Tests — Phase G
 *
 * Tests for capability validation in execution plans, evidence, and reviewer isolation.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import { lintExecutionPlan } from "../src/session/execution-plan-lint.js";
import { validateRunnerEvidence } from "../src/session/evidence-validation.js";
import { reviewStep } from "../src/session/reviewer-orchestrator.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import {
  CAPABILITY_REGISTRY,
  getAllCapabilityIds,
} from "../src/session/capabilities.js";
import { StepEnvelopeSchema } from "../src/session/step-envelope.js";
import { PatchArtifactSchema } from "../src/session/patch-artifact.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
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
    ],
    createdAt: TS,
    createdBy: { actorId: "u", actorType: "human" },
  } as DefinitionOfDone;
}

function minimalLock(): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    sessionId: SESSION_ID,
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

describe("Execution Plan Capability Validation", () => {
  const dod = minimalDoD();
  const goal = "Test goal";

  it("should accept plan with registered capabilities", () => {
    const registeredCaps = getAllCapabilityIds().slice(0, 2);
    const plan = {
      goal: "Test goal",
      nonExecutableGuarantees: {
        noShellExecution: true,
        noNetworkAccess: true,
        noFilesystemMutation: true,
        noProcessSpawning: true,
        noImplicitIO: true,
      },
      steps: [{ stepId: "step-1", references: ["dod-1"] }],
      allowedCapabilities: registeredCaps,
    };
    expect(() => lintExecutionPlan(plan, dod, goal)).not.toThrow();
  });

  it("should reject plan with unknown capability", () => {
    const plan = {
      goal: "Test goal",
      nonExecutableGuarantees: {
        noShellExecution: true,
        noNetworkAccess: true,
        noFilesystemMutation: true,
        noProcessSpawning: true,
        noImplicitIO: true,
      },
      steps: [{ stepId: "step-1", references: ["dod-1"] }],
      allowedCapabilities: ["unknown_capability_xyz"],
    };
    expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(SessionError);
    expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(/Unknown capability/);
  });

  it("should reject plan with duplicate capabilities", () => {
    const registeredCaps = getAllCapabilityIds();
    if (registeredCaps.length > 0) {
      const plan = {
        goal: "Test goal",
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          noImplicitIO: true,
        },
        steps: [{ stepId: "step-1", references: ["dod-1"] }],
        allowedCapabilities: [registeredCaps[0]!, registeredCaps[0]!],
      };
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(SessionError);
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(/Duplicate capability/);
    }
  });

  it("should reject step with capability not in plan allowedCapabilities", () => {
    const registeredCaps = getAllCapabilityIds();
    if (registeredCaps.length >= 2) {
      const plan = {
        goal: "Test goal",
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          noImplicitIO: true,
        },
        steps: [
          {
            stepId: "step-1",
            references: ["dod-1"],
            requiredCapabilities: [registeredCaps[1]!],
          },
        ],
        allowedCapabilities: [registeredCaps[0]!],
      };
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(SessionError);
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(/not in plan allowedCapabilities/);
    }
  });

  it("should accept step with capability in plan allowedCapabilities", () => {
    const registeredCaps = getAllCapabilityIds();
    if (registeredCaps.length > 0) {
      const plan = {
        goal: "Test goal",
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          noImplicitIO: true,
        },
        steps: [
          {
            stepId: "step-1",
            references: ["dod-1"],
            requiredCapabilities: [registeredCaps[0]!],
          },
        ],
        allowedCapabilities: [registeredCaps[0]!],
      };
      expect(() => lintExecutionPlan(plan, dod, goal)).not.toThrow();
    }
  });

  it("should reject step with duplicate requiredCapabilities", () => {
    const registeredCaps = getAllCapabilityIds();
    if (registeredCaps.length > 0) {
      const plan = {
        goal: "Test goal",
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          noImplicitIO: true,
        },
        steps: [
          {
            stepId: "step-1",
            references: ["dod-1"],
            requiredCapabilities: [registeredCaps[0]!, registeredCaps[0]!],
          },
        ],
        allowedCapabilities: [registeredCaps[0]!],
      };
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(SessionError);
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(/Duplicate capability/);
    }
  });

  it("should reject plan with non-array allowedCapabilities", () => {
    const plan = {
      goal: "Test goal",
      nonExecutableGuarantees: {
        noShellExecution: true,
        noNetworkAccess: true,
        noFilesystemMutation: true,
        noProcessSpawning: true,
        noImplicitIO: true,
      },
      steps: [{ stepId: "step-1", references: ["dod-1"] }],
      allowedCapabilities: "not-an-array",
    };
    expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(SessionError);
  });

  it("should reject step with non-array requiredCapabilities", () => {
    const registeredCaps = getAllCapabilityIds();
    if (registeredCaps.length > 0) {
      const plan = {
        goal: "Test goal",
        nonExecutableGuarantees: {
          noShellExecution: true,
          noNetworkAccess: true,
          noFilesystemMutation: true,
          noProcessSpawning: true,
          noImplicitIO: true,
        },
        steps: [
          {
            stepId: "step-1",
            references: ["dod-1"],
            requiredCapabilities: "not-an-array",
          },
        ],
        allowedCapabilities: [registeredCaps[0]!],
      };
      expect(() => lintExecutionPlan(plan, dod, goal)).toThrow(SessionError);
    }
  });
});

describe("Evidence Capability Enforcement", () => {
  const dod = minimalDoD();
  const registeredCaps = getAllCapabilityIds();
  const planCap = registeredCaps[0]!;

  function minimalPlan(): ExecutionPlanLike {
    return {
      sessionId: SESSION_ID,
      steps: [
        {
          stepId: "step-1",
          references: ["dod-1"],
          requiredCapabilities: [planCap],
        },
      ],
      allowedCapabilities: [planCap],
    };
  }

  function minimalEvidence(capabilityUsed: string): RunnerEvidence {
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      stepId: "step-1",
      evidenceId: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
      timestamp: TS,
      evidenceType: "artifact_recorded",
      artifactHash: HASH,
      verificationMetadata: {},
      capabilityUsed,
      humanConfirmationProof: "confirmed",
    } as RunnerEvidence;
  }

  it("should reject evidence with unregistered capability", () => {
    const plan = minimalPlan();
    const evidence = minimalEvidence("unknown_capability_xyz");
    const result = validateRunnerEvidence(evidence, dod, plan, []);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("not registered"))).toBe(true);
  });

  it("should reject evidence with capability not in plan allowedCapabilities", () => {
    if (registeredCaps.length >= 2) {
      const plan = {
        sessionId: SESSION_ID,
        steps: [{ stepId: "step-1", references: ["dod-1"] }],
        allowedCapabilities: [registeredCaps[0]!],
      };
      const evidence = minimalEvidence(registeredCaps[1]!);
      const result = validateRunnerEvidence(evidence, dod, plan, []);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("not in plan allowedCapabilities"))).toBe(true);
    }
  });

  it("should reject evidence with capability not in step requiredCapabilities", () => {
    if (registeredCaps.length >= 2) {
      const plan = {
        sessionId: SESSION_ID,
        steps: [
          {
            stepId: "step-1",
            references: ["dod-1"],
            requiredCapabilities: [registeredCaps[0]!],
          },
        ],
        allowedCapabilities: [registeredCaps[0]!, registeredCaps[1]!],
      };
      const evidence = minimalEvidence(registeredCaps[1]!);
      const result = validateRunnerEvidence(evidence, dod, plan, []);
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("not in step"))).toBe(true);
    }
  });

  it("should accept evidence with valid capability", () => {
    const plan = minimalPlan();
    const evidence = minimalEvidence(planCap);
    const result = validateRunnerEvidence(evidence, dod, plan, []);
    expect(result.passed).toBe(true);
  });

  it("should reject evidence with capability requiring human confirmation but empty proof", () => {
    // Find a capability requiring human confirmation
    for (const [id, def] of CAPABILITY_REGISTRY) {
      if (def.requiresHumanConfirmation) {
        const plan = {
          sessionId: SESSION_ID,
          steps: [{ stepId: "step-1", references: ["dod-1"] }],
          allowedCapabilities: [id],
        };
        const evidence = {
          ...minimalEvidence(id),
          humanConfirmationProof: "   ", // Whitespace-only should also fail
        };
        const result = validateRunnerEvidence(evidence, dod, plan, []);
        expect(result.passed).toBe(false);
        // The error should mention human confirmation or empty proof
        // Schema validation might catch empty string, so check all errors
        const errorText = result.errors.join(" ").toLowerCase();
        const hasHumanConfError =
          errorText.includes("human") ||
          errorText.includes("confirmation") ||
          errorText.includes("proof") ||
          errorText.includes("required");
        expect(hasHumanConfError).toBe(true);
        break;
      }
    }
  });

  it("should accept evidence with capability requiring human confirmation and valid proof", () => {
    // Find a capability requiring human confirmation
    for (const [id, def] of CAPABILITY_REGISTRY) {
      if (def.requiresHumanConfirmation) {
        const plan = {
          sessionId: SESSION_ID,
          steps: [{ stepId: "step-1", references: ["dod-1"] }],
          allowedCapabilities: [id],
        };
        const evidence = {
          ...minimalEvidence(id),
          humanConfirmationProof: "human-confirmed-123",
        };
        const result = validateRunnerEvidence(evidence, dod, plan, []);
        expect(result.passed).toBe(true);
        break;
      }
    }
  });
});

describe("Reviewer Capability Isolation", () => {
  const dod = minimalDoD();
  const lock = minimalLock();
  const registeredCaps = getAllCapabilityIds();

  it("should reject reviewer role not allowed for capability", () => {
    // Find a capability that doesn't allow "automation" role
    let testCap: string | undefined;
    for (const [id, def] of CAPABILITY_REGISTRY) {
      if (!def.allowedRoles.includes("automation")) {
        testCap = id;
        break;
      }
    }

    if (testCap) {
      const envelope = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        goalExcerpt: "Test goal",
        allowedFiles: {
          create: ["test.ts"], // Add file to allowedFiles to avoid early rejection
          modify: [],
          delete: [],
        },
        referencedDoDItems: ["dod-1"],
        allowedCapabilities: [testCap],
        reviewerSequence: ["static", "security", "automation"], // Need at least 3 reviewers
      };

      const patch = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
        filesChanged: [
          {
            path: "test.ts",
            changeType: "create",
            diff: "+test content",
          },
        ],
        declaredImports: [],
      };

      let caughtError: Error | undefined;
      try {
        reviewStep({
          stepEnvelope: envelope,
          patchArtifact: patch,
          dod,
          decisionLock: lock,
        });
      } catch (e) {
        caughtError = e as Error;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError).toBeInstanceOf(SessionError);
      if (caughtError instanceof SessionError) {
        expect(caughtError.message).toContain("not allowed for capability");
      }
    }
  });

  it("should accept reviewer role allowed for capability", () => {
    if (registeredCaps.length > 0) {
      const cap = CAPABILITY_REGISTRY.get(registeredCaps[0]!);
      if (cap && cap.allowedRoles.length > 0) {
        const allowedRole = cap.allowedRoles[0]!;
        const envelope = {
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          stepId: "step-1",
          goalExcerpt: "Test goal",
          allowedFiles: { create: [], modify: [], delete: [] },
          referencedDoDItems: ["dod-1"],
          allowedCapabilities: [registeredCaps[0]!],
          reviewerSequence: [allowedRole, "static", "security"], // Need at least 3
        };

        const patch = {
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          stepId: "step-1",
          patchId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
          filesChanged: [
            {
              path: "test.ts",
              changeType: "create",
              diff: "+test content",
            },
          ],
          declaredImports: [],
        };

        // Should not throw on capability check (may fail on other checks)
        try {
          reviewStep({
            stepEnvelope: envelope,
            patchArtifact: patch,
            dod,
            decisionLock: lock,
          });
        } catch (e) {
          if (e instanceof SessionError) {
            // Should not fail on capability isolation
            expect(e.code).not.toBe("REVIEWER_FAILED");
            expect(e.message).not.toContain("not allowed for capability");
          }
        }
      }
    }
  });
});
