/**
 * Bundle Tests — Phase J
 *
 * Tests for artifact bundle schema validation and hash computation.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  ArtifactBundleSchema,
  validateBundle,
  computeBundleHash,
  type ArtifactBundle,
} from "../src/session/bundle.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
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
    lockId: "l1k2m3n4-o5p6-4q7r-8s9t-0u1v2w3x4y5z",
    sessionId: SESSION_ID,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    approved: true,
    approvedBy: { actorId: "u", actorType: "human" },
    approvedAt: TS,
    planHash: HASH,
  } as DecisionLock;
}

function minimalPlan(): ExecutionPlanLike {
  return {
    sessionId: SESSION_ID,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    lockId: "l1k2m3n4-o5p6-4q7r-8s9t-0u1v2w3x4y5z",
    steps: [],
    allowedCapabilities: getAllCapabilityIds().slice(0, 2),
  };
}

function minimalEvidence(): RunnerEvidence {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-1",
    evidenceId: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
    timestamp: TS,
    evidenceType: "artifact_recorded",
    artifactHash: HASH,
    verificationMetadata: {},
    capabilityUsed: getAllCapabilityIds()[0] || "read_file",
    humanConfirmationProof: "confirmed",
    planHash: HASH,
    prevEvidenceHash: null,
    evidenceHash: HASH,
  } as RunnerEvidence;
}

function minimalBundle(): ArtifactBundle {
  return {
    bundleVersion: "1.0.0",
    artifacts: {
      dod: minimalDoD(),
      decisionLock: minimalLock(),
      executionPlan: minimalPlan(),
      runnerEvidence: [minimalEvidence()],
    },
  };
}

describe("Artifact Bundle Schema", () => {
  it("should accept valid bundle", () => {
    const bundle = minimalBundle();
    expect(() => ArtifactBundleSchema.parse(bundle)).not.toThrow();
  });

  it("should reject missing bundleVersion", () => {
    const bundle = minimalBundle();
    delete (bundle as Record<string, unknown>).bundleVersion;
    expect(() => ArtifactBundleSchema.parse(bundle)).toThrow();
  });

  it("should reject invalid bundleVersion format", () => {
    const bundle = minimalBundle();
    bundle.bundleVersion = "not-semver";
    expect(() => ArtifactBundleSchema.parse(bundle)).toThrow();
  });

  it("should accept valid semantic versions", () => {
    const versions = ["1.0.0", "2.1.3", "0.0.1", "1.0.0-alpha"];
    for (const version of versions) {
      const bundle = { ...minimalBundle(), bundleVersion: version };
      expect(() => ArtifactBundleSchema.parse(bundle)).not.toThrow();
    }
  });

  it("should reject missing artifacts", () => {
    const bundle = minimalBundle();
    delete (bundle as Record<string, unknown>).artifacts;
    expect(() => ArtifactBundleSchema.parse(bundle)).toThrow();
  });

  it("should reject missing dod", () => {
    const bundle = minimalBundle();
    delete (bundle.artifacts.dod);
    expect(() => ArtifactBundleSchema.parse(bundle)).toThrow();
  });

  it("should reject missing decisionLock", () => {
    const bundle = minimalBundle();
    delete (bundle.artifacts.decisionLock);
    expect(() => ArtifactBundleSchema.parse(bundle)).toThrow();
  });

  it("should reject missing executionPlan", () => {
    const bundle = minimalBundle();
    delete (bundle.artifacts.executionPlan);
    expect(() => ArtifactBundleSchema.parse(bundle)).toThrow();
  });

  it("should accept empty runnerEvidence array", () => {
    const bundle = minimalBundle();
    bundle.artifacts.runnerEvidence = [];
    expect(() => ArtifactBundleSchema.parse(bundle)).not.toThrow();
  });

  it("should accept optional artifacts", () => {
    const bundle = minimalBundle();
    // All optional fields undefined
    expect(() => ArtifactBundleSchema.parse(bundle)).not.toThrow();
  });
});

describe("Bundle Hash Computation", () => {
  it("should compute deterministic hash", () => {
    const bundle = minimalBundle();
    const hash1 = computeBundleHash(bundle);
    const hash2 = computeBundleHash(bundle);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex
  });

  it("should produce same hash for identical bundles", () => {
    const bundle1 = minimalBundle();
    const bundle2 = minimalBundle();
    const hash1 = computeBundleHash(bundle1);
    const hash2 = computeBundleHash(bundle2);
    expect(hash1).toBe(hash2);
  });

  it("should produce different hash for different bundleVersion", () => {
    const bundle1 = { ...minimalBundle(), bundleVersion: "1.0.0" };
    const bundle2 = { ...minimalBundle(), bundleVersion: "2.0.0" };
    const hash1 = computeBundleHash(bundle1);
    const hash2 = computeBundleHash(bundle2);
    expect(hash1).not.toBe(hash2);
  });

  it("should produce different hash for different dod", () => {
    const bundle1 = minimalBundle();
    const bundle2 = {
      ...minimalBundle(),
      artifacts: {
        ...minimalBundle().artifacts,
        dod: { ...minimalDoD(), title: "Different" },
      },
    };
    const hash1 = computeBundleHash(bundle1);
    const hash2 = computeBundleHash(bundle2);
    expect(hash1).not.toBe(hash2);
  });
});

describe("Order Independence", () => {
  it("should produce same hash for policies in different order", () => {
    // This test requires policies - we'll create minimal policy objects
    const policy1 = {
      policyId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      name: "Policy 1",
      version: "1.0.0",
      scope: "global" as const,
      rules: [],
      createdAt: TS,
      createdBy: { actorId: "u", actorType: "human" },
    };
    const policy2 = {
      policyId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      name: "Policy 2",
      version: "1.0.0",
      scope: "global" as const,
      rules: [],
      createdAt: TS,
      createdBy: { actorId: "u", actorType: "human" },
    };

    const bundle1 = {
      ...minimalBundle(),
      artifacts: {
        ...minimalBundle().artifacts,
        policies: [policy1, policy2],
      },
    };
    const bundle2 = {
      ...minimalBundle(),
      artifacts: {
        ...minimalBundle().artifacts,
        policies: [policy2, policy1], // Different order
      },
    };

    const hash1 = computeBundleHash(bundle1);
    const hash2 = computeBundleHash(bundle2);
    expect(hash1).toBe(hash2); // Should be same (sorted by policyId)
  });

  it("should produce different hash for evidence chain in different order", () => {
    const evidence1 = { ...minimalEvidence(), stepId: "step-1" };
    const evidence2 = { ...minimalEvidence(), stepId: "step-2", evidenceId: "e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b" };

    const bundle1 = {
      ...minimalBundle(),
      artifacts: {
        ...minimalBundle().artifacts,
        runnerEvidence: [evidence1, evidence2],
      },
    };
    const bundle2 = {
      ...minimalBundle(),
      artifacts: {
        ...minimalBundle().artifacts,
        runnerEvidence: [evidence2, evidence1], // Different order
      },
    };

    const hash1 = computeBundleHash(bundle1);
    const hash2 = computeBundleHash(bundle2);
    expect(hash1).not.toBe(hash2); // Order matters for evidence chain
  });
});

describe("validateBundle", () => {
  it("should return validated bundle for valid input", () => {
    const bundle = minimalBundle();
    const result = validateBundle(bundle);
    expect(result).toBeDefined();
    expect(result.bundleVersion).toBe(bundle.bundleVersion);
  });

  it("should throw SessionError for invalid schema", () => {
    const bundle = minimalBundle();
    bundle.bundleVersion = "not-semver";
    expect(() => validateBundle(bundle)).toThrow(SessionError);
    try {
      validateBundle(bundle);
    } catch (e) {
      if (e instanceof SessionError) {
        expect(e.code).toBe("REPLAY_BUNDLE_INVALID");
      }
    }
  });
});
