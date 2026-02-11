/**
 * Approval Bundle — cryptographic signatures for artifact approval.
 *
 * Phase N: Contains signatures that bind to specific artifact hashes.
 * Uses RSA-SHA256 signatures with replay-resistant nonces.
 */

import { z } from "zod";
import { createVerify } from "node:crypto";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso8601Utc = z
  .string()
  .regex(ISO8601_RE, "Must be ISO 8601 UTC datetime")
  .refine((s) => !isNaN(Date.parse(s)), "Must be parseable datetime");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const sha256HexString = z
  .string()
  .regex(SHA256_HEX_RE, "Must be 64-char lowercase hex SHA-256");

// Base64 signature
const base64Signature = z
  .string()
  .min(1)
  .refine(
    (s) => {
      try {
        Buffer.from(s, "base64");
        return true;
      } catch {
        return false;
      }
    },
    "Must be valid base64",
  );

export const ApprovalSignatureSchema = z
  .object({
    signatureId: uuidV4,
    approverId: z.string().min(1).max(200),
    role: z.string().min(1).max(200),
    algorithm: z.literal("RSA-SHA256"),
    artifactType: z.enum(["decision_lock", "execution_plan", "prompt_capsule"]),
    artifactHash: sha256HexString,
    sessionId: uuidV4,
    timestamp: iso8601Utc,
    nonce: uuidV4,
    signature: base64Signature,
    payloadHash: sha256HexString,
  })
  .passthrough();

export const ApprovalBundleSchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    sessionId: uuidV4,
    bundleId: uuidV4,
    signatures: z.array(ApprovalSignatureSchema).min(1),
    bundleHash: sha256HexString,
  })
  .passthrough();

export type ApprovalSignature = z.infer<typeof ApprovalSignatureSchema>;
export type ApprovalBundle = z.infer<typeof ApprovalBundleSchema>;

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute signature payload hash (what gets signed).
 * Excludes signature and payloadHash fields from hash computation.
 *
 * @param signature - Signature object
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeSignaturePayloadHash(
  signature: ApprovalSignature,
): string {
  const payload = normalizeSignaturePayload(signature);
  const canonical = canonicalize(payload);
  return sha256Hex(canonical);
}

/**
 * Normalize signature payload for hashing (excludes signature and payloadHash).
 */
function normalizeSignaturePayload(
  signature: ApprovalSignature,
): Record<string, unknown> {
  return {
    signatureId: signature.signatureId,
    approverId: signature.approverId,
    role: signature.role,
    algorithm: signature.algorithm,
    artifactType: signature.artifactType,
    artifactHash: signature.artifactHash,
    sessionId: signature.sessionId,
    timestamp: signature.timestamp,
    nonce: signature.nonce,
  };
}

/**
 * Compute bundle hash from normalized bundle (excluding bundleHash field).
 *
 * @param bundle - Bundle object
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeBundleHash(bundle: ApprovalBundle): string {
  const normalized = normalizeBundle(bundle);
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}

/**
 * Normalize bundle for hashing (excludes bundleHash field).
 */
function normalizeBundle(
  bundle: ApprovalBundle,
): Record<string, unknown> {
  // Sort signatures by signatureId for determinism
  const sortedSignatures = [...bundle.signatures].sort((a, b) =>
    a.signatureId.localeCompare(b.signatureId),
  );

  return {
    schemaVersion: bundle.schemaVersion,
    sessionId: bundle.sessionId,
    bundleId: bundle.bundleId,
    signatures: sortedSignatures.map((sig) => normalizeSignaturePayload(sig)),
  };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify approval signature using approver's public key.
 *
 * @param signature - Signature to verify
 * @param approverPublicKeyPem - PEM format public key
 * @throws SessionError with code APPROVAL_SIGNATURE_INVALID on failure
 */
export function verifySignature(
  signature: ApprovalSignature,
  approverPublicKeyPem: string,
): void {
  // Compute payload hash
  const computedPayloadHash = computeSignaturePayloadHash(signature);

  // Verify payloadHash matches computed hash
  if (signature.payloadHash !== computedPayloadHash) {
    throw new SessionError(
      `Signature payloadHash mismatch: expected ${computedPayloadHash}, got ${signature.payloadHash}`,
      "APPROVAL_SIGNATURE_INVALID",
      {
        signatureId: signature.signatureId,
        expected: computedPayloadHash,
        got: signature.payloadHash,
      },
    );
  }

  // Decode signature
  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(signature.signature, "base64");
  } catch (error) {
    throw new SessionError(
      `Invalid base64 signature: ${String(error)}`,
      "APPROVAL_SIGNATURE_INVALID",
      { signatureId: signature.signatureId },
    );
  }

  // Verify PEM format
  const isPEM = approverPublicKeyPem.includes("-----BEGIN");
  if (!isPEM) {
    throw new SessionError(
      "Public key must be in PEM format",
      "APPROVAL_SIGNATURE_INVALID",
      { signatureId: signature.signatureId },
    );
  }

  // Verify signature using node:crypto
  try {
    const verify = createVerify("RSA-SHA256");
    verify.update(computedPayloadHash, "hex");
    verify.end();
    const isValid = verify.verify(approverPublicKeyPem, signatureBuffer);

    if (!isValid) {
      throw new SessionError(
        "Signature verification failed",
        "APPROVAL_SIGNATURE_INVALID",
        {
          signatureId: signature.signatureId,
          approverId: signature.approverId,
        },
      );
    }
  } catch (error) {
    if (error instanceof SessionError) {
      throw error;
    }
    throw new SessionError(
      `Signature verification error: ${String(error)}`,
      "APPROVAL_SIGNATURE_INVALID",
      {
        signatureId: signature.signatureId,
        error: String(error),
      },
    );
  }
}
