/**
 * Approval Enforcement Tests — Phase N
 *
 * Tests for quorum enforcement, role validation, and approval verification.
 */

import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { SessionError } from "../src/session/errors.js";
import {
  enforceApprovals,
  type ApprovalEnforcementResult,
} from "../src/session/approval-enforcement.js";
import type { ApprovalPolicy, Approver, ApprovalRule } from "../src/session/approval-policy.js";
import type { ApprovalBundle, ApprovalSignature } from "../src/session/approval-bundle.js";
import { computeSignaturePayloadHash, computeBundleHash } from "../src/session/approval-bundle.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const POLICY_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const BUNDLE_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TS = "2026-02-11T12:00:00.000Z";
const DECISION_LOCK_HASH = "a".repeat(64);
const PLAN_HASH = "b".repeat(64);
const CAPSULE_HASH = "c".repeat(64);

// Generate test RSA key pairs
const { publicKey: publicKey1, privateKey: privateKey1 } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const { publicKey: publicKey2, privateKey: privateKey2 } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const { publicKey: publicKey3, privateKey: privateKey3 } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function minimalApprover(approverId: string, role: string, publicKey: string): Approver {
  return {
    approverId,
    role,
    publicKeyPem: publicKey,
    active: true,
  };
}

function minimalRule(
  artifactType: "decision_lock" | "execution_plan" | "prompt_capsule",
  requiredRoles: string[],
  m: number,
  n: number,
): ApprovalRule {
  return {
    artifactType,
    requiredRoles,
    quorum: {
      type: "m_of_n",
      m,
      n,
    },
    requireDistinctApprovers: true,
  };
}

function minimalPolicy(
  approvers: Approver[],
  rules: ApprovalRule[],
): ApprovalPolicy {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    policyId: POLICY_ID,
    allowedAlgorithms: ["RSA-SHA256"],
    approvers,
    rules,
    createdAt: TS,
  };
}

function createSignature(
  approverId: string,
  role: string,
  artifactType: "decision_lock" | "execution_plan" | "prompt_capsule",
  artifactHash: string,
  privateKey: string,
  nonce?: string,
): ApprovalSignature {
  const signatureId = uuidv4();
  const signatureNonce = nonce || uuidv4();

  const payload = {
    signatureId,
    approverId,
    role,
    algorithm: "RSA-SHA256" as const,
    artifactType,
    artifactHash,
    sessionId: SESSION_ID,
    timestamp: TS,
    nonce: signatureNonce,
  };

  const payloadHash = computeSignaturePayloadHash({
    ...payload,
    signature: "",
    payloadHash: "",
  });

  // Sign payload hash
  const sign = createSign("RSA-SHA256");
  sign.update(payloadHash, "hex");
  sign.end();
  const signature = sign.sign(privateKey, "base64");

  return {
    ...payload,
    signature,
    payloadHash,
  };
}

function minimalBundle(signatures: ApprovalSignature[]): ApprovalBundle {
  const bundleHash = computeBundleHash({
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    bundleId: BUNDLE_ID,
    signatures,
    bundleHash: "",
  });

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    bundleId: BUNDLE_ID,
    signatures,
    bundleHash,
  };
}

describe("Approval Enforcement", () => {
  describe("Quorum Failures", () => {
    it("should fail when 1-of-3 quorum has only 1 signature but wrong role", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
        minimalApprover("approver-3", "tech_lead", publicKey3),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 3),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "security_reviewer", // wrong role
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.includes("role"))).toBe(true);
    });

    it("should fail when 2-of-3 quorum has only 1 signature", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
        minimalApprover("approver-3", "tech_lead", publicKey3),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 3),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("Quorum not met"))).toBe(true);
      expect(result.errors.some((e) => e.includes("required 2"))).toBe(true);
    });

    it("should fail when 2-of-3 quorum has 2 signatures but same approver", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
        minimalApprover("approver-3", "tech_lead", publicKey3),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 3),
      ];
      const policy = minimalPolicy(approvers, rules);

      const nonce1 = uuidv4();
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
        nonce1,
      );
      const sig2 = createSignature(
        "approver-1", // same approver
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
        uuidv4(),
      );
      const bundle = minimalBundle([sig1, sig2]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate approverId"))).toBe(true);
    });
  });

  describe("Role Mismatches", () => {
    it("should fail when signature role not in requiredRoles", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "security_reviewer", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-2",
        "security_reviewer", // not in requiredRoles
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey2,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should fail when approver role doesn't match signature role", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "security_reviewer", // doesn't match approver role
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("role") && e.includes("does not match"))).toBe(true);
    });
  });

  describe("Mixed Artifacts", () => {
    it("should handle signatures for different artifact types", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 2),
        minimalRule("execution_plan", ["tech_lead"], 1, 2),
        minimalRule("prompt_capsule", ["tech_lead"], 1, 2),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-2",
        "tech_lead",
        "execution_plan",
        PLAN_HASH,
        privateKey2,
      );
      const sig3 = createSignature(
        "approver-1",
        "tech_lead",
        "prompt_capsule",
        CAPSULE_HASH,
        privateKey1,
        uuidv4(),
      );
      const bundle = minimalBundle([sig1, sig2, sig3]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: {
          decisionLockHash: DECISION_LOCK_HASH,
          planHash: PLAN_HASH,
          capsuleHash: CAPSULE_HASH,
        },
        usedNonces: [],
      });

      expect(result.passed).toBe(true);
      expect(result.satisfiedRules.length).toBe(3);
    });
  });

  describe("Missing Artifact Hash", () => {
    it("should fail when artifact hash is missing", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: {}, // missing decisionLockHash
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("has no corresponding artifact hash"))).toBe(true);
    });
  });

  describe("Wrong Artifact Hash", () => {
    it("should fail when signature artifactHash doesn't match expected", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        "wrong-hash".repeat(6), // wrong hash
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("artifactHash") && e.includes("does not match"))).toBe(true);
    });
  });

  describe("Session ID Mismatch", () => {
    it("should fail when bundle sessionId doesn't match policy", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = {
        ...minimalBundle([sig1]),
        sessionId: "different-session-id",
      };

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("sessionId") && e.includes("does not match"))).toBe(true);
    });
  });

  describe("Replay Detection", () => {
    it("should fail when nonce is reused", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const nonce = uuidv4();
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
        nonce,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [nonce], // nonce already used
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("reused nonce"))).toBe(true);
    });
  });

  describe("Inactive Approver", () => {
    it("should fail when approver is inactive", () => {
      const approvers = [
        {
          ...minimalApprover("approver-1", "tech_lead", publicKey1),
          active: false,
        },
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("inactive approver"))).toBe(true);
    });
  });

  describe("Unknown Approver", () => {
    it("should fail when approver doesn't exist in policy", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "unknown-approver",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("unknown approver"))).toBe(true);
    });
  });

  describe("Happy Paths", () => {
    it("should pass 2-of-3 quorum with 2 distinct signatures", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
        minimalApprover("approver-3", "tech_lead", publicKey3),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 3),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-2",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey2,
      );
      const bundle = minimalBundle([sig1, sig2]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(true);
      expect(result.errors.length).toBe(0);
      expect(result.satisfiedRules.length).toBe(1);
      expect(result.satisfiedRules[0]!.requiredSignatures).toBe(2);
      expect(result.satisfiedRules[0]!.actualSignatures).toBe(2);
    });

    it("should pass all artifact types approved", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 2),
        minimalRule("execution_plan", ["tech_lead"], 1, 2),
        minimalRule("prompt_capsule", ["tech_lead"], 1, 2),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-2",
        "tech_lead",
        "execution_plan",
        PLAN_HASH,
        privateKey2,
      );
      const sig3 = createSignature(
        "approver-1",
        "tech_lead",
        "prompt_capsule",
        CAPSULE_HASH,
        privateKey1,
        uuidv4(),
      );
      const bundle = minimalBundle([sig1, sig2, sig3]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: {
          decisionLockHash: DECISION_LOCK_HASH,
          planHash: PLAN_HASH,
          capsuleHash: CAPSULE_HASH,
        },
        usedNonces: [],
      });

      expect(result.passed).toBe(true);
      expect(result.satisfiedRules.length).toBe(3);
    });

    it("should pass with multiple roles", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "security_reviewer", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead", "security_reviewer"], 1, 2),
      ];
      const policy = minimalPolicy(approvers, rules);

      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
      );
      const bundle = minimalBundle([sig1]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(true);
      expect(result.satisfiedRules.length).toBe(1);
    });
  });

  describe("Distinct Approvers Requirement", () => {
    it("should enforce distinct approvers when required", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 2),
      ];
      const policy = minimalPolicy(approvers, rules);

      const nonce1 = uuidv4();
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
        nonce1,
      );
      const sig2 = createSignature(
        "approver-1", // same approver
        "tech_lead",
        "decision_lock",
        DECISION_LOCK_HASH,
        privateKey1,
        uuidv4(),
      );
      const bundle = minimalBundle([sig1, sig2]);

      const result = enforceApprovals({
        policy,
        bundle,
        artifacts: { decisionLockHash: DECISION_LOCK_HASH },
        usedNonces: [],
      });

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("duplicate approverId"))).toBe(true);
    });
  });
});
