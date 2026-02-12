import { describe, it, expect } from "vitest";
import { lintPromptCapsule, lintModelResponse } from "../src/session/prompt-lint.js";
import { SessionError } from "../src/session/errors.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import type { PromptCapsule } from "../src/session/prompt-capsule.js";
import type { ModelResponseArtifact } from "../src/session/model-response.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import { computeCapsuleHash } from "../src/session/prompt-capsule.js";
import { computeResponseHash } from "../src/session/model-response.js";
import { computePlanHash } from "../src/session/plan-hash.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "123e4567-e89b-4123-a456-426614174000";
const DOD_ID = "223e4567-e89b-4123-a456-426614174000";
const LOCK_ID = "323e4567-e89b-4123-a456-426614174000";

function createDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: DOD_ID,
    sessionId: SESSION_ID,
    title: "Test DoD",
    items: [
      {
        id: "dod-item-1",
        description: "Item 1",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
      {
        id: "dod-item-2",
        description: "Item 2",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
    ],
    createdAt: "2024-01-01T00:00:00.000Z",
    createdBy: { actorId: "test", actorType: "human" },
  };
}

function createLock(): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: LOCK_ID,
    sessionId: SESSION_ID,
    dodId: DOD_ID,
    goal: "Test goal for Phase K",
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
    createdBy: { actorId: "test", actorType: "human" },
  };
}

function createPlan(): ExecutionPlanLike {
  return {
    sessionId: SESSION_ID,
    dodId: DOD_ID,
    lockId: LOCK_ID,
    steps: [
      { stepId: "step-1", references: ["dod-item-1"] },
      { stepId: "step-2", references: ["dod-item-2"] },
    ],
    allowedCapabilities: ["read_file", "validate_schema"],
  };
}

function createCapsule(): PromptCapsule {
  const plan = createPlan();
  const planHash = computePlanHash(plan);
  const capsule: PromptCapsule = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    capsuleId: "423e4567-e89b-4123-a456-426614174000",
    lockId: LOCK_ID,
    planHash,
    createdAt: "2024-01-01T00:00:00.000Z",
    createdBy: { actorId: "test", actorType: "human" },
    model: {
      provider: "openai",
      modelId: "gpt-4",
      temperature: 0,
      topP: 1,
      seed: 42,
    },
    intent: {
      goalExcerpt: "Test goal for Phase K",
      taskType: "code_change",
      forbiddenBehaviors: ["no new files", "no execution", "no network"],
    },
    context: {
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "Please make changes.",
      constraints: ["constraint1", "constraint2", "constraint3"],
    },
    boundaries: {
      allowedFiles: ["src/file1.ts", "src/file2.ts"],
      allowedSymbols: ["src/file1.ts#export1"],
      allowedDoDItems: ["dod-item-1"],
      allowedPlanStepIds: ["step-1"],
      allowedCapabilities: ["read_file"],
      disallowedPatterns: ["TODO", "FIXME", "TBD", "PLACEHOLDER", "XXX"],
      allowedExternalModules: ["lodash"],
    },
    inputs: {
      fileDigests: [
        { path: "src/file1.ts", sha256: "a".repeat(64) },
        { path: "src/file2.ts", sha256: "b".repeat(64) },
      ],
      partialCoverage: false,
    },
    hash: {
      capsuleHash: "",
    },
  };
  capsule.hash.capsuleHash = computeCapsuleHash(capsule);
  return capsule;
}

function createResponse(capsule: PromptCapsule): ModelResponseArtifact {
  const response: ModelResponseArtifact = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    capsuleId: capsule.capsuleId,
    responseId: "523e4567-e89b-4123-a456-426614174000",
    createdAt: "2024-01-01T00:00:00.000Z",
    model: {
      provider: capsule.model.provider,
      modelId: capsule.model.modelId,
      seed: capsule.model.seed,
    },
    output: {
      summary: "This is a test summary",
      proposedChanges: [
        {
          changeId: "change-1",
          changeType: "edit_file",
          targetPath: "src/file1.ts",
          patch: "--- a/src/file1.ts\n+++ b/src/file1.ts\n@@ -1,1 +1,2 @@\n line1\n+line2",
          referencedDoDItems: ["dod-item-1"],
          referencedPlanStepIds: ["step-1"],
          referencedSymbols: [],
          riskNotes: [],
        },
      ],
      citations: [
        {
          type: "file",
          ref: "src/file1.ts",
          note: "Referenced file",
        },
      ],
    },
    hash: {
      responseHash: "",
    },
  };
  response.hash.responseHash = computeResponseHash(response);
  return response;
}

// ---------------------------------------------------------------------------
// lintPromptCapsule tests
// ---------------------------------------------------------------------------

describe("lintPromptCapsule", () => {
  it("validates valid capsule", () => {
    const capsule = createCapsule();
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).not.toThrow();
  });

  it("rejects capsule with mismatched sessionId", () => {
    const capsule = createCapsule();
    capsule.sessionId = "different-session-id";
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with mismatched lockId", () => {
    const capsule = createCapsule();
    capsule.lockId = "different-lock-id";
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with mismatched planHash", () => {
    const capsule = createCapsule();
    capsule.planHash = "different".repeat(8).slice(0, 64);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with goalExcerpt not containing lock.goal", () => {
    const capsule = createCapsule();
    capsule.intent.goalExcerpt = "Different goal";
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with capability not in registry", () => {
    const capsule = createCapsule();
    capsule.boundaries.allowedCapabilities.push("invalid_capability");
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with capability not in plan.allowedCapabilities", () => {
    const capsule = createCapsule();
    capsule.boundaries.allowedCapabilities.push("validate_schema");
    capsule.hash.capsuleHash = computeCapsuleHash(capsule);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    // This should pass because validate_schema is in plan.allowedCapabilities
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).not.toThrow();
    
    // But if we use a capability not in plan
    capsule.boundaries.allowedCapabilities = ["compute_hash"];
    capsule.hash.capsuleHash = computeCapsuleHash(capsule);
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
  });

  it("rejects capsule with DoD item not in DoD", () => {
    const capsule = createCapsule();
    capsule.boundaries.allowedDoDItems.push("dod-item-invalid");
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with plan step not in plan", () => {
    const capsule = createCapsule();
    capsule.boundaries.allowedPlanStepIds.push("step-invalid");
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("PROMPT_CAPSULE_LINT_FAILED");
    }
  });

  it("rejects capsule with hash mismatch", () => {
    const capsule = createCapsule();
    capsule.hash.capsuleHash = "different".repeat(8).slice(0, 64);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintPromptCapsule(capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintPromptCapsule(capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("CAPSULE_HASH_MISMATCH");
    }
  });
});

// ---------------------------------------------------------------------------
// lintModelResponse tests
// ---------------------------------------------------------------------------

describe("lintModelResponse", () => {
  it("validates valid response", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).not.toThrow();
  });

  it("rejects response with mismatched sessionId", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.sessionId = "different-session-id";
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("MODEL_RESPONSE_LINT_FAILED");
    }
  });

  it("rejects response with mismatched capsuleId", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.capsuleId = "different-capsule-id";
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("MODEL_RESPONSE_LINT_FAILED");
    }
  });

  it("rejects response with mismatched seed", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.model.seed = 99;
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("MODEL_RESPONSE_LINT_FAILED");
    }
  });

  it("rejects response with hash mismatch", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.hash.responseHash = "different".repeat(8).slice(0, 64);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("RESPONSE_HASH_MISMATCH");
    }
  });

  it("rejects change with targetPath not in allowedFiles", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].targetPath = "src/unknown.ts";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("BOUNDARY_VIOLATION");
    }
  });

  it("rejects add_file when file not pre-approved", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].changeType = "add_file";
    response.output.proposedChanges[0].targetPath = "src/new-file.ts";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("BOUNDARY_VIOLATION");
    }
  });

  it("allows add_file when file is pre-approved", () => {
    const capsule = createCapsule();
    capsule.boundaries.allowedFiles.push("src/new-file.ts");
    capsule.hash.capsuleHash = computeCapsuleHash(capsule);
    const response = createResponse(capsule);
    response.output.proposedChanges[0].changeType = "add_file";
    response.output.proposedChanges[0].targetPath = "src/new-file.ts";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).not.toThrow();
  });

  it("rejects change referencing DoD item not in allowedDoDItems", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].referencedDoDItems.push("dod-item-2");
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("BOUNDARY_VIOLATION");
    }
  });

  it("rejects change referencing plan step not in allowedPlanStepIds", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].referencedPlanStepIds.push("step-2");
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("BOUNDARY_VIOLATION");
    }
  });

  it("rejects citation referencing file not in allowedFiles", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.citations.push({
      type: "file",
      ref: "src/unknown.ts",
      note: "Unknown file",
    });
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("BOUNDARY_VIOLATION");
    }
  });

  it("rejects response containing TODO", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.summary = "This contains TODO";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("FORBIDDEN_TOKEN_DETECTED");
    }
  });

  it("rejects response containing shell command", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.summary = "Run sudo bash to install";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("FORBIDDEN_TOKEN_DETECTED");
    }
  });

  it("rejects response containing network pattern", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.summary = "Fetch from https://example.com";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("FORBIDDEN_TOKEN_DETECTED");
    }
  });

  it("allows 'post-hoc' without matching POST", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.summary = "This is a post-hoc analysis";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    // Should not throw - "post-hoc" should not match forbidden patterns
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).not.toThrow();
  });

  it("rejects patch importing ../secrets", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    // Use path that normalizes to a file not in allowedFiles (symbol-boundary rejects ".." so use ./secrets)
    response.output.proposedChanges[0].patch = "import './secrets'";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("IMPORT_BOUNDARY_VIOLATION");
    }
  });

  it("rejects patch importing ./newModule not in allowedFiles", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].patch = "import './newModule'";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("IMPORT_BOUNDARY_VIOLATION");
    }
  });

  it("rejects patch importing external module not in allowedExternalModules", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].patch = "import axios from 'axios'";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).toThrow(SessionError);
    try {
      lintModelResponse(response, capsule, dod, lock, plan);
    } catch (e) {
      expect((e as SessionError).code).toBe("IMPORT_BOUNDARY_VIOLATION");
    }
  });

  it("allows patch importing external module in allowedExternalModules", () => {
    const capsule = createCapsule();
    const response = createResponse(capsule);
    response.output.proposedChanges[0].patch = "import _ from 'lodash'";
    response.hash.responseHash = computeResponseHash(response);
    const dod = createDoD();
    const lock = createLock();
    const plan = createPlan();
    expect(() => lintModelResponse(response, capsule, dod, lock, plan)).not.toThrow();
  });
});
