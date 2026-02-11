/**
 * Step Packet Linter Tests — Phase O
 *
 * Tests for step packet linting validation checks.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import { lintStepPacket } from "../src/session/step-packet-lint.js";
import type { StepPacket } from "../src/session/step-packet.js";
import type { DecisionLock, DefinitionOfDone } from "../src/session/schemas.js";
import type { PromptCapsule } from "../src/session/prompt-capsule.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import type { RepoSnapshot } from "../src/session/repo-snapshot.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { computeStepPacketHash } from "../src/session/step-packet.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const DOD_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const STEP_ID = "step-1";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const GOAL = "Implement feature X with Y constraints";

function minimalLock(): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: LOCK_ID,
    sessionId: SESSION_ID,
    dodId: DOD_ID,
    goal: GOAL,
    nonGoals: ["Not doing Y"],
    interfaces: [],
    invariants: ["No side effects"],
    constraints: [],
    failureModes: [],
    risksAndTradeoffs: [],
    status: "approved",
    createdAt: TS,
    createdBy: { actorId: "user1", actorType: "human" },
  };
}

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: DOD_ID,
    sessionId: SESSION_ID,
    items: [
      {
        id: "dod-1",
        description: "Test passes",
        verificationMethod: "command_exit_code",
        notDoneConditions: [],
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "user1", actorType: "human" },
  };
}

function minimalCapsule(): PromptCapsule {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    capsuleId: "capsule-1",
    lockId: LOCK_ID,
    planHash: HASH,
    createdAt: TS,
    createdBy: { actorId: "user1", actorType: "human" },
    model: {
      provider: "openai",
      model: "gpt-4",
      temperature: 0.7,
      maxTokens: 2000,
    },
    intent: {
      task: "Implement feature",
      constraints: [],
    },
    context: {
      relevantFiles: [],
      relevantSymbols: [],
    },
    boundaries: {
      allowedFiles: ["file1.ts", "file2.ts"],
      allowedSymbols: ["file1.ts#export1", "file2.ts#export2"],
      allowedDoDItems: ["dod-1"],
      allowedPlanStepIds: [STEP_ID],
      allowedCapabilities: ["read_file"],
      disallowedPatterns: ["rm ", "curl", "http://"],
      allowedExternalModules: [],
    },
    inputs: {
      fileDigests: [
        { path: "file1.ts", sha256: HASH },
        { path: "file2.ts", sha256: HASH },
      ],
      partialCoverage: false,
    },
    hash: {
      capsuleHash: HASH,
    },
  };
}

function minimalPlan(): ExecutionPlanLike {
  return {
    sessionId: SESSION_ID,
    dodId: DOD_ID,
    lockId: LOCK_ID,
    steps: [
      {
        stepId: STEP_ID,
        references: ["dod-1"],
        requiredCapabilities: ["read_file"],
      },
    ],
    allowedCapabilities: ["read_file"],
  };
}

function minimalSnapshot(): RepoSnapshot {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    snapshotId: "snapshot-1",
    generatedAt: TS,
    rootDescriptor: "test",
    includedFiles: [
      { path: "file1.ts", contentHash: HASH },
      { path: "file2.ts", contentHash: HASH },
    ],
    snapshotHash: HASH,
  };
}

function minimalPacket(): StepPacket {
  const packetData = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    lockId: LOCK_ID,
    stepId: STEP_ID,
    planHash: HASH,
    capsuleHash: HASH,
    snapshotHash: HASH,
    goalReference: GOAL,
    dodId: DOD_ID,
    dodItemRefs: ["dod-1"],
    allowedFiles: ["file1.ts"],
    allowedSymbols: ["file1.ts#export1"],
    requiredCapabilities: ["read_file"],
    reviewerSequence: ["static", "security", "qa"],
    context: {
      fileDigests: [{ path: "file1.ts", sha256: HASH }],
    },
    createdAt: TS,
    packetHash: "",
  };
  const hash = computeStepPacketHash(packetData as StepPacket);
  return {
    ...packetData,
    packetHash: hash,
  };
}

describe("Step Packet Linter", () => {
  describe("Step Validation", () => {
    it("should reject packet with non-existent stepId", () => {
      const packet = minimalPacket();
      packet.stepId = "non-existent-step";

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/does not exist in execution plan/);
    });
  });

  describe("Goal Reference", () => {
    it("should reject packet with missing goal string", () => {
      const packet = minimalPacket();
      packet.goalReference = "Different goal";

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/must contain exact Decision Lock goal/);
    });

    it("should accept packet with exact goal string", () => {
      const packet = minimalPacket();
      packet.goalReference = `Context: ${GOAL} and more`;

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("DoD References", () => {
    it("should reject packet with extra DoD refs", () => {
      const packet = minimalPacket();
      packet.dodItemRefs = ["dod-1", "dod-2"]; // Extra ref

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/must be set-equal/);
    });

    it("should reject packet with missing DoD refs", () => {
      const packet = minimalPacket();
      packet.dodItemRefs = []; // Missing ref

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
    });

    it("should accept packet with set-equal DoD refs", () => {
      const packet = minimalPacket();
      packet.dodItemRefs = ["dod-1"]; // Matches step.references

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("File Boundaries", () => {
    it("should reject packet with disallowed file", () => {
      const packet = minimalPacket();
      packet.allowedFiles = ["file3.ts"]; // Not in capsule.boundaries.allowedFiles

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/not in capsule.boundaries.allowedFiles/);
    });

    it("should reject packet with file not in snapshot", () => {
      const packet = minimalPacket();
      packet.allowedFiles = ["file1.ts", "file3.ts"]; // file3.ts not in snapshot

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/does not exist in snapshot/);
    });

    it("should accept packet with allowed files", () => {
      const packet = minimalPacket();
      packet.allowedFiles = ["file1.ts"]; // In capsule and snapshot

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Symbol Boundaries", () => {
    it("should reject packet with disallowed symbol", () => {
      const packet = minimalPacket();
      packet.allowedSymbols = ["file1.ts#export3"]; // Not in capsule.boundaries.allowedSymbols

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/not in capsule.boundaries.allowedSymbols/);
    });

    it("should accept packet with allowed symbols", () => {
      const packet = minimalPacket();
      packet.allowedSymbols = ["file1.ts#export1"]; // In capsule

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Capabilities", () => {
    it("should reject packet with capability not in plan", () => {
      const packet = minimalPacket();
      packet.requiredCapabilities = ["write_file"]; // Not in plan.allowedCapabilities

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/not in plan.allowedCapabilities/);
    });

    it("should reject packet with unregistered capability", () => {
      const packet = minimalPacket();
      const plan = minimalPlan();
      plan.allowedCapabilities = ["unknown_cap"]; // Not in CAPABILITY_REGISTRY
      packet.requiredCapabilities = ["unknown_cap"];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan,
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan,
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/not registered in CAPABILITY_REGISTRY/);
    });

    it("should accept packet with valid capabilities", () => {
      const packet = minimalPacket();
      packet.requiredCapabilities = ["read_file"]; // In plan and registry

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Reviewer Sequence", () => {
    it("should reject packet with <3 reviewers", () => {
      const packet = minimalPacket();
      packet.reviewerSequence = ["static", "security"]; // Only 2

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/must have at least 3 reviewers/);
    });

    it("should reject packet with unknown reviewer role", () => {
      const packet = minimalPacket();
      packet.reviewerSequence = ["static", "security", "unknown"]; // Unknown role

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/unknown role/);
    });

    it("should accept packet with valid reviewer sequence", () => {
      const packet = minimalPacket();
      packet.reviewerSequence = ["static", "security", "qa"]; // Valid

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Forbidden Tokens", () => {
    it("should reject packet with forbidden tokens in goalReference", () => {
      const packet = minimalPacket();
      packet.goalReference = `${GOAL} sudo bash`; // Contains forbidden token

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/forbidden tokens/);
    });

    it("should reject packet with HTTP methods in goalReference", () => {
      const packet = minimalPacket();
      packet.goalReference = `${GOAL} GET /api/data`; // Contains HTTP method

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/HTTP methods/);
    });

    it("should reject packet with forbidden tokens in excerpts", () => {
      const packet = minimalPacket();
      packet.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 10,
          text: "curl http://evil.com", // Contains forbidden token
        },
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
    });

    it("should accept packet without forbidden tokens", () => {
      const packet = minimalPacket();
      packet.goalReference = GOAL; // Clean

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Excerpts Validation", () => {
    it("should reject excerpt for disallowed file", () => {
      const packet = minimalPacket();
      packet.context.excerpts = [
        {
          path: "file3.ts", // Not in allowedFiles
          startLine: 1,
          endLine: 10,
          text: "test",
        },
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/not in packet.allowedFiles/);
    });

    it("should reject excerpt with text >2000 chars", () => {
      const packet = minimalPacket();
      packet.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 10,
          text: "x".repeat(2001), // Exceeds 2000 chars
        },
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/exceeds 2000 characters/);
    });

    it("should reject excerpt with invalid line range", () => {
      const packet = minimalPacket();
      packet.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 10,
          endLine: 5, // Invalid
          text: "test",
        },
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
    });

    it("should reject excerpt with line range >100 lines", () => {
      const packet = minimalPacket();
      packet.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 102, // Exceeds 100 lines
          text: "test",
        },
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/exceeds 100 lines/);
    });

    it("should accept valid excerpt", () => {
      const packet = minimalPacket();
      packet.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 10,
          text: "export const x = 1;",
        },
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Context File Digests", () => {
    it("should reject fileDigest for disallowed file", () => {
      const packet = minimalPacket();
      packet.context.fileDigests = [
        { path: "file3.ts", sha256: HASH }, // Not in allowedFiles
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/not in packet.allowedFiles/);
    });

    it("should reject fileDigest with wrong hash", () => {
      const packet = minimalPacket();
      packet.context.fileDigests = [
        { path: "file1.ts", sha256: "b".repeat(64) }, // Wrong hash
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(SessionError);
      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).toThrow(/does not match snapshot hash/);
    });

    it("should accept valid fileDigests", () => {
      const packet = minimalPacket();
      packet.context.fileDigests = [
        { path: "file1.ts", sha256: HASH }, // Matches snapshot
      ];

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });

  describe("Valid Packet", () => {
    it("should accept fully valid packet", () => {
      const packet = minimalPacket();

      expect(() =>
        lintStepPacket({
          packet,
          lockGoal: GOAL,
          capsule: minimalCapsule(),
          plan: minimalPlan(),
          snapshot: minimalSnapshot(),
        }),
      ).not.toThrow();
    });
  });
});
