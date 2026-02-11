/**
 * Replay Tests — Phase J
 *
 * Tests for deterministic replay engine and independent verification.
 */

import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { replaySession, type ReplayResult } from "../src/session/replay.js";
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
import type { SessionAnchor } from "../src/session/session-anchor.js";
import type { Policy } from "../src/session/policy.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const RUNNER_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const NONCE = "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a";

// Generate test RSA key pair
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

function minimalLock(planHash: string = HASH): DecisionLock {
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

function minimalPolicy(): Policy {
  return {
    policyId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    name: "Test Policy",
    version: "1.0.0",
    scope: "global",
    rules: [
      {
        ruleId: "rule-1",
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

  const anchor: SessionAnchor = {
    sessionId: SESSION_ID,
    planHash,
    lockId: LOCK_ID,
    finalEvidenceHash: evidence2.evidenceHash,
    finalAttestationHash: computeAttestationPayloadHash(attestation),
    runnerIdentityHash: identityHash,
  };

  return {
    bundleVersion: "1.0.0",
    artifacts: {
      dod: minimalDoD(),
      decisionLock: lock,
      executionPlan: plan,
      runnerIdentity: identity,
      runnerEvidence: [evidence1, evidence2],
      runnerAttestation: attestation,
      sessionAnchor: anchor,
    },
  };
}

describe("Replay Engine", () => {
  describe("Full Session Replay", () => {
    it("should replay full session with all artifacts", () => {
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(true);
      expect(result.mismatches.length).toBe(0);
      expect(result.attestationValid).toBe(true);
      expect(result.anchorValid).toBe(true);
    });

    it("should recompute all hashes correctly", () => {
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      expect(result.recomputedHashes.planHash).toBeDefined();
      expect(result.recomputedHashes.evidenceHashes.length).toBe(2);
      expect(result.recomputedHashes.identityHash).toBeDefined();
      expect(result.recomputedHashes.attestationPayloadHash).toBeDefined();
      expect(result.recomputedHashes.attestationSignatureValid).toBe(true);
      expect(result.recomputedHashes.anchorHashes).toBeDefined();
    });

    it("should produce identical results for same input", () => {
      const bundle1 = createFullBundle();
      const bundle2 = createFullBundle();
      const result1 = replaySession(bundle1);
      const result2 = replaySession(bundle2);
      expect(result1.deterministicReplayPassed).toBe(result2.deterministicReplayPassed);
      expect(result1.mismatches.length).toBe(result2.mismatches.length);
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
    });
  });

  describe("Replay with Missing Optional Artifacts", () => {
    it("should replay without runnerIdentity", () => {
      const bundle = createFullBundle();
      delete bundle.artifacts.runnerIdentity;
      delete bundle.artifacts.runnerAttestation;
      delete bundle.artifacts.sessionAnchor;
      const result = replaySession(bundle);
      expect(result.recomputedHashes.identityHash).toBeUndefined();
      expect(result.attestationValid).toBe(true); // No attestation to validate
    });

    it("should replay without attestation", () => {
      const bundle = createFullBundle();
      delete bundle.artifacts.runnerAttestation;
      delete bundle.artifacts.sessionAnchor;
      const result = replaySession(bundle);
      expect(result.recomputedHashes.attestationPayloadHash).toBeUndefined();
      expect(result.attestationValid).toBe(true);
    });

    it("should replay without anchor", () => {
      const bundle = createFullBundle();
      delete bundle.artifacts.sessionAnchor;
      const result = replaySession(bundle);
      expect(result.anchorValid).toBe(true); // No anchor to validate
    });

    it("should replay without policies", () => {
      const bundle = createFullBundle();
      delete bundle.artifacts.policies;
      delete bundle.artifacts.policyEvaluation;
      const result = replaySession(bundle);
      expect(result.policyVerdict).toBeUndefined();
    });

    it("should replay with empty evidence chain", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerEvidence = [];
      delete bundle.artifacts.runnerAttestation;
      delete bundle.artifacts.sessionAnchor;
      const result = replaySession(bundle);
      expect(result.recomputedHashes.evidenceHashes.length).toBe(0);
    });
  });

  describe("Hash Mismatch Detection", () => {
    it("should detect planHash mismatch", () => {
      const bundle = createFullBundle();
      const wrongHash = "b".repeat(64);
      (bundle.artifacts.decisionLock as Record<string, unknown>).planHash = wrongHash;
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "planHash")).toBe(true);
    });

    it("should detect evidenceHash mismatch", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerEvidence[0]!.evidenceHash = "wrong-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "evidenceHash")).toBe(true);
    });

    it("should detect identityHash mismatch in attestation", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerAttestation!.identityHash = "wrong-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.attestationValid).toBe(false);
      expect(result.mismatches.some((m) => m.type === "identityHash")).toBe(true);
    });

    it("should detect evidence chain tail hash mismatch", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerAttestation!.evidenceChainTailHash = "wrong-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.attestationValid).toBe(false);
    });
  });

  describe("Attestation Signature Verification", () => {
    it("should verify valid signature", () => {
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      expect(result.recomputedHashes.attestationSignatureValid).toBe(true);
      expect(result.attestationValid).toBe(true);
    });

    it("should detect invalid signature", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerAttestation!.signature = Buffer.from("wrong-signature").toString("base64");
      const result = replaySession(bundle);
      expect(result.recomputedHashes.attestationSignatureValid).toBe(false);
      expect(result.attestationValid).toBe(false);
      expect(result.mismatches.some((m) => m.type === "attestationSignature")).toBe(true);
    });

    it("should work without nonce uniqueness check", () => {
      // Replay mode skips nonce uniqueness - this is tested implicitly
      // by the fact that replay works without stored nonces
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      expect(result.attestationValid).toBe(true);
    });
  });

  describe("Policy Re-evaluation", () => {
    it("should re-evaluate policies correctly", () => {
      const bundle = createFullBundle();
      bundle.artifacts.policies = [minimalPolicy()];
      const result = replaySession(bundle);
      expect(result.policyVerdict).toBeDefined();
      expect(result.policyVerdict!.passed).toBe(true);
    });

    it("should recompute policy hashes", () => {
      const bundle = createFullBundle();
      bundle.artifacts.policies = [minimalPolicy()];
      const result = replaySession(bundle);
      expect(result.recomputedHashes.policySetHash).toBeDefined();
      expect(result.recomputedHashes.policyEvaluationHash).toBeDefined();
    });

    it("should handle policy validation failures", () => {
      const bundle = createFullBundle();
      const failingPolicy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "deny-rule",
            description: "Deny rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH, // Condition passes
            },
            effect: "deny",
            severity: "critical",
          },
        ],
      };
      bundle.artifacts.policies = [failingPolicy];
      const result = replaySession(bundle);
      // Policy validation throws for critical deny, but replay catches it
      expect(result.policyVerdict).toBeDefined();
      expect(result.policyVerdict!.passed).toBe(false);
    });
  });

  describe("Anchor Validation", () => {
    it("should validate anchor correctly", () => {
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      expect(result.anchorValid).toBe(true);
      expect(result.recomputedHashes.anchorHashes).toBeDefined();
    });

    it("should detect anchor hash mismatch", () => {
      const bundle = createFullBundle();
      bundle.artifacts.sessionAnchor!.finalEvidenceHash = "wrong-hash";
      const result = replaySession(bundle);
      expect(result.anchorValid).toBe(false);
      expect(result.mismatches.some((m) => m.type === "anchorHash")).toBe(true);
    });

    it("should validate anchor policy hashes if present", () => {
      const bundle = createFullBundle();
      bundle.artifacts.policies = [minimalPolicy()];
      const result = replaySession(bundle);
      if (result.recomputedHashes.policySetHash) {
        bundle.artifacts.sessionAnchor!.policySetHash = result.recomputedHashes.policySetHash;
        bundle.artifacts.sessionAnchor!.policyEvaluationHash = result.recomputedHashes.policyEvaluationHash;
        const result2 = replaySession(bundle);
        expect(result2.anchorValid).toBe(true);
      }
    });
  });

  describe("Evidence Chain Validation", () => {
    it("should validate evidence chain integrity", () => {
      const bundle = createFullBundle();
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(true);
    });

    it("should detect broken evidence chain", () => {
      const bundle = createFullBundle();
      // Break chain by changing prevEvidenceHash
      bundle.artifacts.runnerEvidence[1]!.prevEvidenceHash = "wrong-prev-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
    });

    it("should validate planHash binding in evidence", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerEvidence[0]!.planHash = "wrong-plan-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "planHash" && m.artifact === "runnerEvidence")).toBe(true);
    });
  });

  describe("Deterministic Output", () => {
    it("should produce identical results for multiple replays", () => {
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
    });

    it("should produce same hashes for same artifacts", () => {
      const bundle1 = createFullBundle();
      const bundle2 = createFullBundle();
      const result1 = replaySession(bundle1);
      const result2 = replaySession(bundle2);
      
      expect(result1.recomputedHashes.planHash).toBe(result2.recomputedHashes.planHash);
      expect(result1.recomputedHashes.identityHash).toBe(result2.recomputedHashes.identityHash);
      expect(result1.recomputedHashes.evidenceHashes).toEqual(result2.recomputedHashes.evidenceHashes);
    });
  });
});
