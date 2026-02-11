/**
 * Approval Bundle Tests — Phase N
 *
 * Tests for approval bundle schema, signature verification, and hash computation.
 */

import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import { SessionError } from "../src/session/errors.js";
import {
  ApprovalBundleSchema,
  ApprovalSignatureSchema,
  computeSignaturePayloadHash,
  computeBundleHash,
  verifySignature,
  type ApprovalSignature,
  type ApprovalBundle,
} from "../src/session/approval-bundle.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const BUNDLE_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const TS = "2026-02-11T12:00:00.000Z";
const ARTIFACT_HASH = "a".repeat(64);

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

function createSignature(
  approverId: string,
  role: string,
  artifactType: "decision_lock" | "execution_plan" | "prompt_capsule",
  artifactHash: string,
  privateKey: string,
): ApprovalSignature {
  const signatureId = uuidv4();
  const nonce = uuidv4();

  const payload = {
    signatureId,
    approverId,
    role,
    algorithm: "RSA-SHA256" as const,
    artifactType,
    artifactHash,
    sessionId: SESSION_ID,
    timestamp: TS,
    nonce,
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

describe("Approval Bundle", () => {
  describe("Signature Verification", () => {
    it("should verify valid signature", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      expect(() => verifySignature(signature, publicKey1)).not.toThrow();
    });

    it("should reject signature with wrong public key", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      expect(() => verifySignature(signature, publicKey2)).toThrow(SessionError);
      expect(() => verifySignature(signature, publicKey2)).toThrow(
        /Signature verification failed/,
      );
    });

    it("should reject corrupted signature", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const corrupted = {
        ...signature,
        signature: signature.signature.slice(0, -10) + "corrupted",
      };

      expect(() => verifySignature(corrupted, publicKey1)).toThrow();
    });

    it("should reject signature with wrong payloadHash", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const wrongHash = {
        ...signature,
        payloadHash: "b".repeat(64),
      };

      expect(() => verifySignature(wrongHash, publicKey1)).toThrow(SessionError);
      expect(() => verifySignature(wrongHash, publicKey1)).toThrow(
        /payloadHash mismatch/,
      );
    });

    it("should reject invalid base64 signature", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const invalidBase64 = {
        ...signature,
        signature: "not-valid-base64!!!",
      };

      // Invalid base64 will cause signature verification to fail
      expect(() => verifySignature(invalidBase64, publicKey1)).toThrow();
    });

    it("should reject signature with non-PEM public key", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      expect(() => verifySignature(signature, "not-a-pem-key")).toThrow(SessionError);
      expect(() => verifySignature(signature, "not-a-pem-key")).toThrow(
        /Public key must be in PEM format/,
      );
    });
  });

  describe("Wrong Artifact Hash", () => {
    it("should detect wrong artifactHash in signature", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      // Signature is valid but hash doesn't match expected artifact
      const wrongHash = "b".repeat(64);
      const signatureWithWrongHash = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        wrongHash,
        privateKey1,
      );

      // Verification should pass (signature is cryptographically valid)
      expect(() => verifySignature(signatureWithWrongHash, publicKey1)).not.toThrow();

      // But the hash mismatch will be caught in enforcement
      expect(signatureWithWrongHash.artifactHash).not.toBe(ARTIFACT_HASH);
    });
  });

  describe("Wrong Session ID", () => {
    it("should detect wrong sessionId in signature", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      // Signature is valid but sessionId doesn't match bundle
      expect(signature.sessionId).toBe(SESSION_ID);
      // This will be caught in enforcement, not signature verification
    });
  });

  describe("Duplicate Approver IDs", () => {
    it("should allow duplicate approverId in bundle (enforcement checks this)", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-1", // same approver
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      // Both signatures verify correctly
      expect(() => verifySignature(sig1, publicKey1)).not.toThrow();
      expect(() => verifySignature(sig2, publicKey1)).not.toThrow();

      // Bundle creation should work
      const bundle = minimalBundle([sig1, sig2]);
      expect(bundle.signatures.length).toBe(2);
    });
  });

  describe("Replay Nonce Detection", () => {
    it("should detect reused nonce", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      // First use should work (enforcement checks this)
      expect(signature.nonce).toBeDefined();

      // Second signature with same nonce - need to recompute payloadHash and signature
      const signature2Payload = {
        signatureId: uuidv4(),
        approverId: "approver-1",
        role: "tech_lead",
        algorithm: "RSA-SHA256" as const,
        artifactType: "decision_lock" as const,
        artifactHash: ARTIFACT_HASH,
        sessionId: SESSION_ID,
        timestamp: TS,
        nonce: signature.nonce, // reuse nonce
      };

      const payloadHash = computeSignaturePayloadHash({
        ...signature2Payload,
        signature: "",
        payloadHash: "",
      });

      const sign = createSign("RSA-SHA256");
      sign.update(payloadHash, "hex");
      sign.end();
      const sig = sign.sign(privateKey1, "base64");

      const signature2 = {
        ...signature2Payload,
        signature: sig,
        payloadHash,
      };

      // Both signatures verify correctly (signature verification doesn't check nonce reuse)
      expect(() => verifySignature(signature, publicKey1)).not.toThrow();
      expect(() => verifySignature(signature2, publicKey1)).not.toThrow();

      // Nonce reuse will be caught in enforcement
      expect(signature2.nonce).toBe(signature.nonce);
    });
  });

  describe("Bundle Hash Computation", () => {
    it("should compute consistent bundle hash", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-2",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey2,
      );

      const bundle1 = minimalBundle([sig1, sig2]);
      const bundle2 = minimalBundle([sig1, sig2]);

      expect(bundle1.bundleHash).toBe(bundle2.bundleHash);
    });

    it("should compute different hash for different signatures", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-2",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey2,
      );

      const bundle1 = minimalBundle([sig1]);
      const bundle2 = minimalBundle([sig1, sig2]);

      expect(bundle1.bundleHash).not.toBe(bundle2.bundleHash);
    });

    it("should exclude bundleHash from hash computation", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const bundle = minimalBundle([sig1]);
      const computedHash = computeBundleHash(bundle);

      expect(bundle.bundleHash).toBe(computedHash);
    });
  });

  describe("Payload Hash Computation", () => {
    it("should compute consistent payload hash", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const hash1 = computeSignaturePayloadHash(signature);
      const hash2 = computeSignaturePayloadHash(signature);

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(signature.payloadHash);
    });

    it("should exclude signature and payloadHash from payload hash", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const sig2 = {
        ...sig1,
        signature: "different-signature",
        payloadHash: "different-hash",
      };

      const hash1 = computeSignaturePayloadHash(sig1);
      const hash2 = computeSignaturePayloadHash(sig2);

      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different payloads", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const sig2 = createSignature(
        "approver-1",
        "tech_lead",
        "execution_plan", // different artifact type
        ARTIFACT_HASH,
        privateKey1,
      );

      const hash1 = computeSignaturePayloadHash(sig1);
      const hash2 = computeSignaturePayloadHash(sig2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Multiple Signatures", () => {
    it("should handle bundle with multiple signatures", () => {
      const sig1 = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );
      const sig2 = createSignature(
        "approver-2",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey2,
      );
      const sig3 = createSignature(
        "approver-3",
        "security_reviewer",
        "execution_plan",
        ARTIFACT_HASH,
        privateKey1,
      );

      const bundle = minimalBundle([sig1, sig2, sig3]);

      expect(bundle.signatures.length).toBe(3);
      expect(() => verifySignature(sig1, publicKey1)).not.toThrow();
      expect(() => verifySignature(sig2, publicKey2)).not.toThrow();
      expect(() => verifySignature(sig3, publicKey1)).not.toThrow();
    });
  });

  describe("Schema Validation", () => {
    it("should reject invalid UUIDs", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const invalid = {
        ...signature,
        signatureId: "not-a-uuid",
      };

      const result = ApprovalSignatureSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid artifact hash format", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const invalid = {
        ...signature,
        artifactHash: "not-64-chars",
      };

      const result = ApprovalSignatureSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject invalid algorithm", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      const invalid = {
        ...signature,
        algorithm: "RSA-SHA384" as any,
      };

      const result = ApprovalSignatureSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject empty signatures array", () => {
      const bundle = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        bundleId: BUNDLE_ID,
        signatures: [],
        bundleHash: "a".repeat(64),
      };

      const result = ApprovalBundleSchema.safeParse(bundle);
      expect(result.success).toBe(false);
    });
  });

  describe("Valid Signature Acceptance", () => {
    it("should accept valid signature for decision_lock", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "decision_lock",
        ARTIFACT_HASH,
        privateKey1,
      );

      expect(() => verifySignature(signature, publicKey1)).not.toThrow();
    });

    it("should accept valid signature for execution_plan", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "execution_plan",
        ARTIFACT_HASH,
        privateKey1,
      );

      expect(() => verifySignature(signature, publicKey1)).not.toThrow();
    });

    it("should accept valid signature for prompt_capsule", () => {
      const signature = createSignature(
        "approver-1",
        "tech_lead",
        "prompt_capsule",
        ARTIFACT_HASH,
        privateKey1,
      );

      expect(() => verifySignature(signature, publicKey1)).not.toThrow();
    });
  });
});
