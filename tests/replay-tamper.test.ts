/**
 * Replay Tamper Tests — Phase J
 *
 * Adversarial tests: verify that replay detects all tampering attempts.
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

describe("Tamper Detection", () => {
  describe("Plan Tampering", () => {
    it("should detect plan text modification even if planHash unchanged in lock", () => {
      const bundle = createFullBundle();
      const originalPlanHash = computePlanHash(bundle.artifacts.executionPlan);
      
      // Modify plan but keep old hash in lock
      bundle.artifacts.executionPlan.steps.push({ stepId: "step-2", references: ["dod-2"] });
      const newPlanHash = computePlanHash(bundle.artifacts.executionPlan);
      
      // Lock still has old hash
      (bundle.artifacts.decisionLock as Record<string, unknown>).planHash = originalPlanHash;
      
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "planHash")).toBe(true);
    });

    it("should detect planHash mismatch in evidence", () => {
      const bundle = createFullBundle();
      const planHash = computePlanHash(bundle.artifacts.executionPlan);
      
      // Modify plan
      bundle.artifacts.executionPlan.steps.push({ stepId: "step-2", references: ["dod-2"] });
      const newPlanHash = computePlanHash(bundle.artifacts.executionPlan);
      
      // Evidence still has old planHash
      bundle.artifacts.runnerEvidence[0]!.planHash = planHash;
      
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "planHash" && m.artifact === "runnerEvidence")).toBe(true);
    });
  });

  describe("Evidence Tampering", () => {
    it("should detect evidence timestamp modification even if evidenceHash unchanged", () => {
      const bundle = createFullBundle();
      const originalEvidence = bundle.artifacts.runnerEvidence[0]!;
      const originalHash = originalEvidence.evidenceHash;
      
      // Modify timestamp
      originalEvidence.timestamp = "2026-02-12T12:00:00.000Z";
      
      // Recompute hash - it will be different
      const newHash = computeEvidenceHash(originalEvidence);
      
      // But keep old hash in evidence
      originalEvidence.evidenceHash = originalHash;
      
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "evidenceHash")).toBe(true);
    });

    it("should detect evidence chain order swap", () => {
      const bundle = createFullBundle();
      const evidence1 = bundle.artifacts.runnerEvidence[0]!;
      const evidence2 = bundle.artifacts.runnerEvidence[1]!;
      
      // Swap order
      bundle.artifacts.runnerEvidence = [evidence2, evidence1];
      
      // Fix prevEvidenceHash for swapped order
      evidence2.prevEvidenceHash = null;
      evidence1.prevEvidenceHash = evidence2.evidenceHash;
      
      const result = replaySession(bundle);
      // Chain validation should fail because planHash in evidence2 doesn't match
      // or because the chain structure is broken
      expect(result.deterministicReplayPassed).toBe(false);
    });

    it("should detect broken evidence chain link", () => {
      const bundle = createFullBundle();
      // Break chain by changing prevEvidenceHash
      bundle.artifacts.runnerEvidence[1]!.prevEvidenceHash = "wrong-prev-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
    });
  });

  describe("Identity Tampering", () => {
    it("should detect allowedCapabilitiesSnapshot modification", () => {
      const bundle = createFullBundle();
      const originalIdentityHash = computeIdentityHash(bundle.artifacts.runnerIdentity!);
      
      // Modify capabilities
      bundle.artifacts.runnerIdentity!.allowedCapabilitiesSnapshot = ["forbidden_cap"];
      const newIdentityHash = computeIdentityHash(bundle.artifacts.runnerIdentity!);
      
      // Attestation still has old identityHash
      bundle.artifacts.runnerAttestation!.identityHash = originalIdentityHash;
      
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "identityHash")).toBe(true);
      expect(result.attestationValid).toBe(false);
    });

    it("should detect environmentFingerprint modification", () => {
      const bundle = createFullBundle();
      const originalIdentityHash = computeIdentityHash(bundle.artifacts.runnerIdentity!);
      
      // Modify fingerprint
      bundle.artifacts.runnerIdentity!.environmentFingerprint = "modified-fingerprint";
      const newIdentityHash = computeIdentityHash(bundle.artifacts.runnerIdentity!);
      
      // Attestation still has old identityHash
      bundle.artifacts.runnerAttestation!.identityHash = originalIdentityHash;
      
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.attestationValid).toBe(false);
    });
  });

  describe("Attestation Tampering", () => {
    it("should detect signature modification", () => {
      const bundle = createFullBundle();
      // Modify signature
      bundle.artifacts.runnerAttestation!.signature = Buffer.from("wrong-signature").toString("base64");
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.recomputedHashes.attestationSignatureValid).toBe(false);
      expect(result.attestationValid).toBe(false);
    });

    it("should detect nonce format modification", () => {
      const bundle = createFullBundle();
      // Invalid nonce format
      bundle.artifacts.runnerAttestation!.nonce = "not-a-uuid";
      const result = replaySession(bundle);
      // Nonce format validation should fail
      expect(result.deterministicReplayPassed).toBe(false);
    });

    it("should detect planHash modification in attestation", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerAttestation!.planHash = "wrong-plan-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.some((m) => m.type === "attestationHash")).toBe(true);
    });

    it("should detect evidenceChainTailHash modification", () => {
      const bundle = createFullBundle();
      bundle.artifacts.runnerAttestation!.evidenceChainTailHash = "wrong-tail-hash";
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.attestationValid).toBe(false);
    });
  });

  describe("Policy Tampering", () => {
    it("should detect policy severity modification", () => {
      const bundle = createFullBundle();
      const policy = minimalPolicy();
      bundle.artifacts.policies = [policy];
      
      // First replay to get baseline
      const result1 = replaySession(bundle);
      const originalPolicyEvaluationHash = result1.recomputedHashes.policyEvaluationHash;
      
      // Modify severity
      policy.rules[0]!.severity = "critical";
      
      // Replay again
      const result2 = replaySession(bundle);
      const newPolicyEvaluationHash = result2.recomputedHashes.policyEvaluationHash;
      
      expect(newPolicyEvaluationHash).not.toBe(originalPolicyEvaluationHash);
    });

    it("should detect policy rule modification", () => {
      const bundle = createFullBundle();
      const policy = minimalPolicy();
      bundle.artifacts.policies = [policy];
      
      const result1 = replaySession(bundle);
      const originalHash = result1.recomputedHashes.policyEvaluationHash;
      
      // Modify rule
      policy.rules[0]!.effect = "deny";
      
      const result2 = replaySession(bundle);
      const newHash = result2.recomputedHashes.policyEvaluationHash;
      
      expect(newHash).not.toBe(originalHash);
    });
  });

  describe("Anchor Tampering", () => {
    it("should detect anchor policy hash modification", () => {
      const bundle = createFullBundle();
      bundle.artifacts.policies = [minimalPolicy()];
      
      const result1 = replaySession(bundle);
      const computedPolicySetHash = result1.recomputedHashes.policySetHash!;
      
      // Set anchor with wrong policy hash
      bundle.artifacts.sessionAnchor!.policySetHash = "wrong-policy-hash";
      
      const result2 = replaySession(bundle);
      expect(result2.anchorValid).toBe(false);
      expect(result2.mismatches.some((m) => m.type === "anchorHash")).toBe(true);
    });

    it("should detect anchor finalEvidenceHash modification", () => {
      const bundle = createFullBundle();
      bundle.artifacts.sessionAnchor!.finalEvidenceHash = "wrong-evidence-hash";
      const result = replaySession(bundle);
      expect(result.anchorValid).toBe(false);
    });

    it("should detect anchor finalAttestationHash modification", () => {
      const bundle = createFullBundle();
      bundle.artifacts.sessionAnchor!.finalAttestationHash = "wrong-attestation-hash";
      const result = replaySession(bundle);
      expect(result.anchorValid).toBe(false);
    });

    it("should detect anchor runnerIdentityHash modification", () => {
      const bundle = createFullBundle();
      bundle.artifacts.sessionAnchor!.runnerIdentityHash = "wrong-identity-hash";
      const result = replaySession(bundle);
      expect(result.anchorValid).toBe(false);
    });
  });

  describe("Multiple Tampering Attempts", () => {
    it("should detect all tampering attempts simultaneously", () => {
      const bundle = createFullBundle();
      
      // Tamper with multiple things
      bundle.artifacts.runnerEvidence[0]!.evidenceHash = "wrong-hash";
      bundle.artifacts.runnerAttestation!.identityHash = "wrong-identity-hash";
      bundle.artifacts.sessionAnchor!.finalEvidenceHash = "wrong-anchor-hash";
      
      const result = replaySession(bundle);
      expect(result.deterministicReplayPassed).toBe(false);
      expect(result.mismatches.length).toBeGreaterThan(1);
    });
  });
});
