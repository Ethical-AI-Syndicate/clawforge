/**
 * Attestation Chain Binding Tests — Phase H
 *
 * Tests for attestation binding to evidence chains, session boundaries, and anchors.
 */

import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { SessionError } from "../src/session/errors.js";
import { validateSessionBoundary } from "../src/session/session-boundary.js";
import { validateAnchor } from "../src/session/session-anchor.js";
import {
  validateAttestation,
  computeAttestationPayloadHash,
  type RunnerAttestation,
} from "../src/session/runner-attestation.js";
import {
  validateRunnerIdentity,
  computeIdentityHash,
  type RunnerIdentity,
} from "../src/session/runner-identity.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import type { SessionAnchor } from "../src/session/session-anchor.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { computePlanHash } from "../src/session/plan-hash.js";
import { computeEvidenceHash } from "../src/session/evidence-chain.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";
import { canonicalize } from "../src/session/canonical.js";
import { sha256Hex } from "../src/session/crypto.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const RUNNER_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

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

function minimalLock(): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: LOCK_ID,
    sessionId: SESSION_ID,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
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

function minimalPlan(): ExecutionPlanLike {
  const caps = getAllCapabilityIds();
  return {
    sessionId: SESSION_ID,
    steps: [{ stepId: "step-1", references: ["dod-1"] }],
    allowedCapabilities: caps.length > 0 ? caps.slice(0, 2) : ["read_file"],
  };
}

function minimalIdentity(): RunnerIdentity {
  const caps = getAllCapabilityIds();
  const snapshot = caps.length >= 2 ? caps.slice(0, 2) : (caps.length === 1 ? [caps[0]!] : ["read_file"]);
  return validateRunnerIdentity({
    runnerId: RUNNER_ID,
    runnerVersion: "1.0.0",
    runnerPublicKey: publicKey,
    environmentFingerprint: HASH,
    buildHash: HASH,
    allowedCapabilitiesSnapshot: snapshot,
    attestationTimestamp: TS,
  });
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
    planHash: computePlanHash(minimalPlan()),
    prevEvidenceHash: null,
    evidenceHash: computeEvidenceHash({
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
      planHash: computePlanHash(minimalPlan()),
      prevEvidenceHash: null,
    } as RunnerEvidence),
  } as RunnerEvidence;
}

function createSignedAttestation(
  payload: Omit<RunnerAttestation, "signature" | "signatureAlgorithm">,
): RunnerAttestation {
  const payloadHash = computeAttestationPayloadHash({
    ...payload,
    signature: "",
    signatureAlgorithm: "sha256",
  } as RunnerAttestation);

  const sign = createSign("RSA-SHA256");
  sign.update(payloadHash, "hex");
  sign.end();
  const signature = sign.sign(privateKey, "base64");

  return {
    ...payload,
    signature,
    signatureAlgorithm: "sha256",
  };
}

describe("Attestation Chain Binding", () => {
  describe("Attestation to evidence chain binding", () => {
    it("should bind attestation to evidence chain tail", () => {
      const identity = minimalIdentity();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      const attestation = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      const input = {
        attestation,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces: new Set<string>(),
      };

      expect(() => validateAttestation(input)).not.toThrow();
    });

    it("should reject attestation with wrong evidence chain tail hash", () => {
      const identity = minimalIdentity();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);

      const attestation = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: "b".repeat(64), // Wrong hash
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      const input = {
        attestation,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces: new Set<string>(),
      };

      expect(() => validateAttestation(input)).toThrow(SessionError);
    });

    it("should bind attestation to multiple evidence items", () => {
      const identity = minimalIdentity();
      const plan = minimalPlan();
      const evidence1 = minimalEvidence();
      const evidence2: RunnerEvidence = {
        ...minimalEvidence(),
        evidenceId: "f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c",
        prevEvidenceHash: evidence1.evidenceHash!,
        evidenceHash: computeEvidenceHash({
          ...minimalEvidence(),
          evidenceId: "f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c",
          prevEvidenceHash: evidence1.evidenceHash!,
        } as RunnerEvidence),
      } as RunnerEvidence;

      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence2.evidenceHash!;

      const attestation = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      const input = {
        attestation,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence1, evidence2],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces: new Set<string>(),
      };

      expect(() => validateAttestation(input)).not.toThrow();
    });
  });

  describe("Attestation to session boundary binding", () => {
    it("should validate attestation in session boundary", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const identity = minimalIdentity();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      const attestation = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          attestation,
          runnerIdentity: identity,
        }),
      ).not.toThrow();
    });

    it("should reject attestation with mismatched sessionId in boundary", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const identity = minimalIdentity();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      const attestation = createSignedAttestation({
        sessionId: "wrong-session-id",
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          attestation,
          runnerIdentity: identity,
        }),
      ).toThrow(SessionError);
    });

    it("should reject attestation with mismatched planHash in boundary", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const identity = minimalIdentity();
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      const attestation = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash: "b".repeat(64), // Wrong hash
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      expect(() =>
        validateSessionBoundary({
          sessionId: SESSION_ID,
          dod,
          decisionLock: lock,
          executionPlan: plan,
          runnerEvidence: [evidence],
          attestation,
          runnerIdentity: identity,
        }),
      ).toThrow(SessionError);
    });
  });

  describe("Attestation to anchor binding", () => {
    it("should validate attestation hash in anchor", () => {
      const dod = minimalDoD();
      const lock = minimalLock();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const identity = minimalIdentity();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      const attestation = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      // Compute attestation hash (excluding signature)
      const attestationPayload = {
        sessionId: attestation.sessionId,
        planHash: attestation.planHash,
        lockId: attestation.lockId,
        runnerId: attestation.runnerId,
        identityHash: attestation.identityHash,
        evidenceChainTailHash: attestation.evidenceChainTailHash,
        nonce: attestation.nonce,
        signatureAlgorithm: attestation.signatureAlgorithm,
        createdAt: attestation.createdAt,
      };
      const attestationHash = sha256Hex(canonicalize(attestationPayload));

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        finalEvidenceHash: evidenceTailHash,
        finalAttestationHash: attestationHash,
        runnerIdentityHash: identityHash,
      };

      expect(() =>
        validateAnchor(
          anchor,
          SESSION_ID,
          planHash,
          LOCK_ID,
          evidenceTailHash,
          attestationHash,
          identityHash,
        ),
      ).not.toThrow();
    });

    it("should reject anchor with mismatched attestation hash", () => {
      const planHash = computePlanHash(minimalPlan());
      const evidenceTailHash = minimalEvidence().evidenceHash!;
      const identityHash = computeIdentityHash(minimalIdentity());

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        finalEvidenceHash: evidenceTailHash,
        finalAttestationHash: "b".repeat(64), // Wrong hash
        runnerIdentityHash: identityHash,
      };

      expect(() =>
        validateAnchor(
          anchor,
          SESSION_ID,
          planHash,
          LOCK_ID,
          evidenceTailHash,
          "a".repeat(64), // Expected hash
          identityHash,
        ),
      ).toThrow(SessionError);
    });

    it("should reject anchor with mismatched runner identity hash", () => {
      const planHash = computePlanHash(minimalPlan());
      const evidenceTailHash = minimalEvidence().evidenceHash!;
      const identityHash = computeIdentityHash(minimalIdentity());

      const anchor: SessionAnchor = {
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        finalEvidenceHash: evidenceTailHash,
        finalAttestationHash: "a".repeat(64),
        runnerIdentityHash: "b".repeat(64), // Wrong hash
      };

      expect(() =>
        validateAnchor(
          anchor,
          SESSION_ID,
          planHash,
          LOCK_ID,
          evidenceTailHash,
          "a".repeat(64),
          identityHash, // Expected hash
        ),
      ).toThrow(SessionError);
    });
  });

  describe("Replay resistance", () => {
    it("should reject reused nonce", () => {
      const identity = minimalIdentity();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;
      const nonce = "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a";

      const attestation1 = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce,
        createdAt: TS,
      });

      const attestation2 = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce, // Same nonce
        createdAt: TS,
      });

      const usedNonces = new Set<string>([nonce]);

      const input1 = {
        attestation: attestation1,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces: new Set<string>(), // First use - should pass
      };

      const input2 = {
        attestation: attestation2,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces, // Second use - should fail
      };

      expect(() => validateAttestation(input1)).not.toThrow();
      expect(() => validateAttestation(input2)).toThrow(SessionError);
    });

    it("should accept different nonces", () => {
      const identity = minimalIdentity();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      const attestation1 = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      const attestation2 = createSignedAttestation({
        sessionId: SESSION_ID,
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "e5f6a7b8-c9d0-4e1f-9a2b-4c5d6e7f8a9b", // Different nonce
        createdAt: TS,
      });

      const input1 = {
        attestation: attestation1,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces: new Set<string>(),
      };

      const input2 = {
        attestation: attestation2,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID,
        lockId: LOCK_ID,
        usedNonces: new Set<string>([attestation1.nonce]),
      };

      expect(() => validateAttestation(input1)).not.toThrow();
      expect(() => validateAttestation(input2)).not.toThrow();
    });
  });

  describe("Cross-session replay prevention", () => {
    it("should reject attestation from different session", () => {
      const identity = minimalIdentity();
      const plan = minimalPlan();
      const evidence = minimalEvidence();
      const planHash = computePlanHash(plan);
      const identityHash = computeIdentityHash(identity);
      const evidenceTailHash = evidence.evidenceHash!;

      // Attestation for different session
      const attestation = createSignedAttestation({
        sessionId: "f6a7b8c9-d0e1-4f2a-9b3c-5d6e7f8a9b0c", // Different session
        planHash,
        lockId: LOCK_ID,
        runnerId: RUNNER_ID,
        identityHash,
        evidenceChainTailHash: evidenceTailHash,
        nonce: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
        createdAt: TS,
      });

      const input = {
        attestation,
        runnerIdentity: identity,
        executionPlan: plan,
        evidenceChain: [evidence],
        sessionId: SESSION_ID, // Current session
        lockId: LOCK_ID,
        usedNonces: new Set<string>(),
      };

      expect(() => validateAttestation(input)).toThrow(SessionError);
    });
  });
});
