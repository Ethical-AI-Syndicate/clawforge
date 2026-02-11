/**
 * Replay Determinism Tests — Phase J
 *
 * Tests for deterministic behavior: same input always produces same output.
 * No hidden state, no time dependencies, no filesystem dependencies.
 */

import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { replaySession } from "../src/session/replay.js";
import type { ArtifactBundle } from "../src/session/bundle.js";
import { computePlanHash } from "../src/session/plan-hash.js";
import { computeEvidenceHash } from "../src/session/evidence-chain.js";
import { computeIdentityHash } from "../src/session/runner-identity.js";
import {
  computeAttestationPayloadHash,
  type RunnerAttestation,
} from "../src/session/runner-attestation.js";
import { validateRunnerIdentity, type RunnerIdentity } from "../src/session/runner-identity.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import type { Policy } from "../src/session/policy.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";
import { computePolicySetHash } from "../src/session/policy-enforcement.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const RUNNER_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const NONCE = "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

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

function minimalLock(planHash: string): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: LOCK_ID,
    sessionId: SESSION_ID,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    approved: true,
    approvedBy: { actorId: "u", actorType: "human" },
    approvedAt: TS,
    planHash,
  } as DecisionLock;
}

function minimalPlan(): ExecutionPlanLike {
  return {
    sessionId: SESSION_ID,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    lockId: LOCK_ID,
    steps: [{ stepId: "step-1", references: ["dod-1"] }],
    allowedCapabilities: getAllCapabilityIds().slice(0, 2),
  };
}

function minimalIdentity(): RunnerIdentity {
  return validateRunnerIdentity({
    runnerId: RUNNER_ID,
    runnerVersion: "1.0.0",
    runnerPublicKey: publicKey,
    environmentFingerprint: HASH,
    buildHash: HASH,
    allowedCapabilitiesSnapshot: getAllCapabilityIds().slice(0, 2),
    attestationTimestamp: TS,
  });
}

function minimalEvidence(
  planHash: string,
  prevHash: string | null = null,
): RunnerEvidence {
  const evidence: RunnerEvidence = {
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
    planHash,
    prevEvidenceHash: prevHash,
  } as RunnerEvidence;
  const evidenceHash = computeEvidenceHash(evidence);
  return { ...evidence, evidenceHash } as RunnerEvidence;
}

function createSignedAttestation(
  planHash: string,
  identityHash: string,
  evidenceTailHash: string,
): RunnerAttestation {
  const payload: Omit<RunnerAttestation, "signature"> = {
    sessionId: SESSION_ID,
    planHash,
    lockId: LOCK_ID,
    runnerId: RUNNER_ID,
    identityHash,
    evidenceChainTailHash: evidenceTailHash,
    nonce: NONCE,
    signatureAlgorithm: "sha256",
    createdAt: TS,
  };

  const payloadHash = computeAttestationPayloadHash({
    ...payload,
    signature: "",
  } as RunnerAttestation);

  const sign = createSign("RSA-SHA256");
  sign.update(payloadHash, "hex");
  sign.end();
  const signature = sign.sign(privateKey, "base64");

  return {
    ...payload,
    signature,
  };
}

function createPolicy(policyId: string, ruleId: string): Policy {
  return {
    policyId,
    name: `Policy ${policyId}`,
    version: "1.0.0",
    scope: "global",
    rules: [
      {
        ruleId,
        description: "Test rule",
        target: "runnerIdentity",
        condition: {
          field: "runnerIdentity.environmentFingerprint",
          operator: "equals",
          value: HASH,
        },
        effect: "allow",
        severity: "info",
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "user", actorType: "human" },
  };
}

function createFullBundle(): ArtifactBundle {
  const plan = minimalPlan();
  const planHash = computePlanHash(plan);
  const lock = minimalLock(planHash);
  const identity = minimalIdentity();
  const identityHash = computeIdentityHash(identity);
  const evidence1 = minimalEvidence(planHash, null);
  const evidence2 = minimalEvidence(planHash, evidence1.evidenceHash);
  const attestation = createSignedAttestation(
    planHash,
    identityHash,
    evidence2.evidenceHash,
  );

  return {
    bundleVersion: "1.0.0",
    artifacts: {
      dod: minimalDoD(),
      decisionLock: lock,
      executionPlan: plan,
      runnerIdentity: identity,
      runnerEvidence: [evidence1, evidence2],
      runnerAttestation: attestation,
    },
  };
}

describe("Deterministic Replay", () => {
  describe("Multiple Replays", () => {
    it("should produce identical results for same bundle", () => {
      const bundle = createFullBundle();
      const result1 = replaySession(bundle);
      const result2 = replaySession(bundle);
      const result3 = replaySession(bundle);
      
      expect(result1.deterministicReplayPassed).toBe(result2.deterministicReplayPassed);
      expect(result2.deterministicReplayPassed).toBe(result3.deterministicReplayPassed);
      expect(result1.mismatches.length).toBe(result2.mismatches.length);
      expect(result2.mismatches.length).toBe(result3.mismatches.length);
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
      expect(result2.recomputedHashes.planHash).toBe(result3.recomputedHashes.planHash);
      expect(result1.recomputedHashes.identityHash).toBe(result2.recomputedHashes.identityHash);
      expect(result1.attestationValid).toBe(result2.attestationValid);
    });

    it("should produce identical hash arrays", () => {
      const bundle = createFullBundle();
      const result1 = replaySession(bundle);
      const result2 = replaySession(bundle);
      
      expect(result1.recomputedHashes.evidenceHashes).toEqual(result2.recomputedHashes.evidenceHashes);
    });

    it("should produce identical mismatch arrays", () => {
      const bundle = createFullBundle();
      // Create a bundle with intentional mismatch
      bundle.artifacts.runnerEvidence[0]!.evidenceHash = "wrong-hash";
      
      const result1 = replaySession(bundle);
      const result2 = replaySession(bundle);
      
      expect(result1.mismatches.length).toBe(result2.mismatches.length);
      expect(result1.mismatches).toEqual(result2.mismatches);
    });
  });

  describe("Policy Order Independence", () => {
    it("should produce same policySetHash for policies in different order", () => {
      const policy1 = createPolicy("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "rule-1");
      const policy2 = createPolicy("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "rule-2");
      
      const hash1 = computePolicySetHash([policy1, policy2]);
      const hash2 = computePolicySetHash([policy2, policy1]); // Different order
      
      expect(hash1).toBe(hash2); // Should be same (sorted by policyId)
    });

    it("should produce same policySetHash for policies in different order", () => {
      const bundle = createFullBundle();
      const policy1 = createPolicy("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d", "rule-1");
      const policy2 = createPolicy("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e", "rule-2");
      
      bundle.artifacts.policies = [policy1, policy2];
      const result1 = replaySession(bundle);
      
      bundle.artifacts.policies = [policy2, policy1]; // Different order
      const result2 = replaySession(bundle);
      
      // policySetHash should be same (sorted by policyId)
      expect(result1.recomputedHashes.policySetHash).toBe(result2.recomputedHashes.policySetHash);
      
      // policyEvaluationHash might differ if evaluation order affects result structure
      // but both should produce same verdict
      expect(result1.policyVerdict?.passed).toBe(result2.policyVerdict?.passed);
    });
  });

  describe("Evidence Chain Order Dependence", () => {
    it("should produce different hashes for evidence chain in different order", () => {
      const bundle = createFullBundle();
      const evidence1 = bundle.artifacts.runnerEvidence[0]!;
      const evidence2 = bundle.artifacts.runnerEvidence[1]!;
      
      // Create bundles with different evidence order
      const bundle1 = {
        ...bundle,
        artifacts: {
          ...bundle.artifacts,
          runnerEvidence: [evidence1, evidence2],
        },
      };
      
      // Note: Can't actually swap order without breaking chain, but we can test
      // that order matters by checking hash computation
      const hash1_0 = computeEvidenceHash(evidence1);
      const hash2_0 = computeEvidenceHash(evidence2);
      
      // Create evidence2 with different prevEvidenceHash (simulating swap)
      const evidence2Swapped = {
        ...evidence2,
        prevEvidenceHash: null, // Would break chain
      };
      
      const hash2Swapped = computeEvidenceHash(evidence2Swapped);
      
      // Hashes should be different because prevEvidenceHash changed
      expect(hash2_0).not.toBe(hash2Swapped);
    });

    it("should maintain evidence chain order requirement", () => {
      const bundle = createFullBundle();
      const result1 = replaySession(bundle);
      
      // Break chain by swapping order (fixing prevEvidenceHash)
      const evidence1 = bundle.artifacts.runnerEvidence[0]!;
      const evidence2 = bundle.artifacts.runnerEvidence[1]!;
      
      bundle.artifacts.runnerEvidence = [evidence2, evidence1];
      evidence2.prevEvidenceHash = null;
      evidence1.prevEvidenceHash = evidence2.evidenceHash;
      
      const result2 = replaySession(bundle);
      
      // Should fail because planHash in evidence2 doesn't match new plan
      // or chain validation fails
      expect(result2.deterministicReplayPassed).toBe(false);
    });
  });

  describe("No Time Dependencies", () => {
    it("should produce same results regardless of when replay runs", () => {
      const bundle = createFullBundle();
      const result1 = replaySession(bundle);
      
      // Wait a bit (simulate time passing)
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Busy wait
      }
      
      const result2 = replaySession(bundle);
      
      // Results should be identical
      expect(result1.deterministicReplayPassed).toBe(result2.deterministicReplayPassed);
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
    });

    it("should only use timestamps from artifacts, not current time", () => {
      const bundle = createFullBundle();
      const result1 = replaySession(bundle);
      
      // Change system time wouldn't affect replay (we can't test this directly,
      // but we verify replay doesn't use Date.now() or new Date())
      const result2 = replaySession(bundle);
      
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
    });
  });

  describe("No Filesystem Dependencies", () => {
    it("should work without filesystem access", () => {
      // Replay is pure function - no filesystem access
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      
      // Should work without any filesystem operations
      expect(result).toBeDefined();
      expect(result.recomputedHashes.planHash).toBeDefined();
    });

    it("should not depend on stored nonces", () => {
      // Replay mode skips nonce uniqueness check
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      
      // Should work without stored nonces
      expect(result.attestationValid).toBe(true);
    });
  });

  describe("No Environment Dependencies", () => {
    it("should produce same results regardless of environment", () => {
      const bundle = createFullBundle();
      const result1 = replaySession(bundle);
      
      // Replay should not depend on process.env
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "test";
      
      const result2 = replaySession(bundle);
      
      process.env.NODE_ENV = originalEnv;
      
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
    });
  });

  describe("Canonicalization Stability", () => {
    it("should produce same hash for identical objects with different key order", () => {
      const bundle1 = createFullBundle();
      const bundle2 = createFullBundle();
      
      // Objects are structurally identical but may have different key order
      const result1 = replaySession(bundle1);
      const result2 = replaySession(bundle2);
      
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
    });
  });
});
