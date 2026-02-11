/**
 * Runner Attestation — Phase H
 *
 * Cryptographic attestation binding runner identity to execution results.
 * Attestation proves:
 * - Runner identity
 * - Plan hash binding
 * - Evidence chain binding
 * - Session binding
 * - Replay resistance
 */

import { z } from "zod";
import { createVerify } from "node:crypto";
import { SessionError } from "./errors.js";
import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";
import {
  validateRunnerIdentity,
  computeIdentityHash,
  type RunnerIdentity,
} from "./runner-identity.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { RunnerEvidence } from "./runner-contract.js";
import { computePlanHash } from "./plan-hash.js";
import { computeEvidenceHash } from "./evidence-chain.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const sha256HexString = z
  .string()
  .regex(SHA256_HEX_RE, "Must be 64-char lowercase hex SHA-256");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso8601Utc = z
  .string()
  .regex(ISO8601_RE, "Must be ISO 8601 UTC datetime")
  .refine((s) => !isNaN(Date.parse(s)), "Must be parseable datetime");

// Base64 signature
const base64Signature = z
  .string()
  .min(1)
  .refine((s) => {
    try {
      Buffer.from(s, "base64");
      return true;
    } catch {
      return false;
    }
  }, "Must be valid base64");

export const RunnerAttestationSchema = z
  .object({
    sessionId: uuidV4,
    planHash: sha256HexString,
    lockId: uuidV4,
    runnerId: uuidV4,
    identityHash: sha256HexString,
    evidenceChainTailHash: sha256HexString,
    nonce: uuidV4,
    signature: base64Signature,
    signatureAlgorithm: z.enum(["sha256", "sha384", "sha512"]),
    createdAt: iso8601Utc,
  })
  .passthrough();

export type RunnerAttestation = z.infer<typeof RunnerAttestationSchema>;

// ---------------------------------------------------------------------------
// Attestation payload hash computation
// ---------------------------------------------------------------------------

/**
 * Compute attestation payload hash (what gets signed).
 * Excludes signature field from hash computation.
 *
 * @param attestation - Attestation object
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeAttestationPayloadHash(
  attestation: RunnerAttestation,
): string {
  const payload = normalizeAttestationPayload(attestation);
  const canonical = canonicalize(payload);
  return sha256Hex(canonical);
}

/**
 * Normalize attestation payload for hashing (excludes signature).
 */
function normalizeAttestationPayload(
  attestation: RunnerAttestation,
): Record<string, unknown> {
  return {
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
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Verify attestation signature using runner public key.
 *
 * @param attestation - Attestation to verify
 * @param runnerIdentity - Runner identity containing public key
 * @throws SessionError with code ATTESTATION_SIGNATURE_INVALID on failure
 */
export function verifyAttestationSignature(
  attestation: RunnerAttestation,
  runnerIdentity: RunnerIdentity,
): void {
  const payloadHash = computeAttestationPayloadHash(attestation);
  const signatureBuffer = Buffer.from(attestation.signature, "base64");

  // Determine key format
  const isPEM = runnerIdentity.runnerPublicKey.includes("-----BEGIN");
  const publicKey = isPEM
    ? runnerIdentity.runnerPublicKey
    : // Convert hex to PEM if needed (simplified - assumes RSA for hex keys)
      `-----BEGIN PUBLIC KEY-----\n${Buffer.from(runnerIdentity.runnerPublicKey, "hex").toString("base64")}\n-----END PUBLIC KEY-----`;

  try {
    // Map signature algorithm to node:crypto algorithm name
    const algorithmMap: Record<string, string> = {
      sha256: "RSA-SHA256",
      sha384: "RSA-SHA384",
      sha512: "RSA-SHA512",
    };
    const algorithm = algorithmMap[attestation.signatureAlgorithm] || "RSA-SHA256";

    const verify = createVerify(algorithm);
    verify.update(payloadHash, "hex");
    verify.end();

    const verified = verify.verify(publicKey, signatureBuffer);

    if (!verified) {
      throw new SessionError(
        "Attestation signature verification failed",
        "ATTESTATION_SIGNATURE_INVALID",
        {
          runnerId: attestation.runnerId,
          algorithm: attestation.signatureAlgorithm,
        },
      );
    }
  } catch (error) {
    if (error instanceof SessionError) {
      throw error;
    }
    throw new SessionError(
      `Signature verification error: ${error instanceof Error ? error.message : String(error)}`,
      "ATTESTATION_SIGNATURE_INVALID",
      {
        runnerId: attestation.runnerId,
        algorithm: attestation.signatureAlgorithm,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// Attestation validation
// ---------------------------------------------------------------------------

export interface AttestationValidationInput {
  attestation: unknown;
  runnerIdentity: RunnerIdentity;
  executionPlan: ExecutionPlanLike;
  evidenceChain: RunnerEvidence[];
  sessionId: string;
  lockId: string;
  usedNonces: Set<string>;
  skipNonceUniqueness?: boolean; // Phase J: Skip nonce uniqueness check for replay
}

/**
 * Validate runner attestation against all bindings.
 *
 * Checks:
 * - Schema validity
 * - Signature validity
 * - Identity hash match
 * - Plan hash match
 * - Evidence chain tail hash match
 * - Session ID match
 * - Lock ID match
 * - Timestamp ordering
 * - Capability snapshot match
 * - Nonce uniqueness
 *
 * @param input - Validation input
 * @throws SessionError on any validation failure
 */
export function validateAttestation(
  input: AttestationValidationInput,
): RunnerAttestation {
  // 1. Schema validation
  const parseResult = RunnerAttestationSchema.safeParse(input.attestation);
  if (!parseResult.success) {
    throw new SessionError(
      `Attestation schema invalid: ${parseResult.error.message}`,
      "ATTESTATION_INVALID",
      { errors: parseResult.error.message },
    );
  }
  const attestation = parseResult.data;

  // 2. Session ID match
  if (attestation.sessionId !== input.sessionId) {
    throw new SessionError(
      `Attestation sessionId "${attestation.sessionId}" does not match expected "${input.sessionId}"`,
      "ATTESTATION_INVALID",
      {
        expected: input.sessionId,
        got: attestation.sessionId,
      },
    );
  }

  // 3. Lock ID match
  if (attestation.lockId !== input.lockId) {
    throw new SessionError(
      `Attestation lockId "${attestation.lockId}" does not match expected "${input.lockId}"`,
      "ATTESTATION_INVALID",
      {
        expected: input.lockId,
        got: attestation.lockId,
      },
    );
  }

  // 4. Runner ID match
  if (attestation.runnerId !== input.runnerIdentity.runnerId) {
    throw new SessionError(
      `Attestation runnerId "${attestation.runnerId}" does not match identity runnerId "${input.runnerIdentity.runnerId}"`,
      "ATTESTATION_INVALID",
      {
        expected: input.runnerIdentity.runnerId,
        got: attestation.runnerId,
      },
    );
  }

  // 5. Identity hash match
  const computedIdentityHash = computeIdentityHash(input.runnerIdentity);
  if (attestation.identityHash !== computedIdentityHash) {
    throw new SessionError(
      `Attestation identityHash "${attestation.identityHash}" does not match computed "${computedIdentityHash}"`,
      "ATTESTATION_INVALID",
      {
        expected: computedIdentityHash,
        got: attestation.identityHash,
      },
    );
  }

  // 6. Plan hash match
  const computedPlanHash = computePlanHash(input.executionPlan);
  if (attestation.planHash !== computedPlanHash) {
    throw new SessionError(
      `Attestation planHash "${attestation.planHash}" does not match computed "${computedPlanHash}"`,
      "ATTESTATION_INVALID",
      {
        expected: computedPlanHash,
        got: attestation.planHash,
      },
    );
  }

  // 7. Evidence chain tail hash match
  if (input.evidenceChain.length === 0) {
    throw new SessionError(
      "Cannot validate attestation: evidence chain is empty",
      "ATTESTATION_INVALID",
      {},
    );
  }
  const lastEvidence = input.evidenceChain[input.evidenceChain.length - 1]!;
  const lastEvidenceHash = (lastEvidence as Record<string, unknown>)
    .evidenceHash;
  if (typeof lastEvidenceHash !== "string") {
    // Compute if not present
    const computed = computeEvidenceHash(lastEvidence);
    if (attestation.evidenceChainTailHash !== computed) {
      throw new SessionError(
        `Attestation evidenceChainTailHash "${attestation.evidenceChainTailHash}" does not match computed "${computed}"`,
        "ATTESTATION_INVALID",
        {
          expected: computed,
          got: attestation.evidenceChainTailHash,
        },
      );
    }
  } else {
    if (attestation.evidenceChainTailHash !== lastEvidenceHash) {
      throw new SessionError(
        `Attestation evidenceChainTailHash "${attestation.evidenceChainTailHash}" does not match last evidence hash "${lastEvidenceHash}"`,
        "ATTESTATION_INVALID",
        {
          expected: lastEvidenceHash,
          got: attestation.evidenceChainTailHash,
        },
      );
    }
  }

  // 8. Timestamp ordering: attestation timestamp must be >= last evidence timestamp
  const lastEvidenceTimestamp = Date.parse(lastEvidence.timestamp);
  const attestationTimestamp = Date.parse(attestation.createdAt);
  if (isNaN(lastEvidenceTimestamp) || isNaN(attestationTimestamp)) {
    throw new SessionError(
      "Invalid timestamp in evidence or attestation",
      "ATTESTATION_INVALID",
      {},
    );
  }
  if (attestationTimestamp < lastEvidenceTimestamp) {
    throw new SessionError(
      `Attestation timestamp ${attestation.createdAt} is before last evidence timestamp ${lastEvidence.timestamp}`,
      "ATTESTATION_INVALID",
      {
        attestationTimestamp: attestation.createdAt,
        lastEvidenceTimestamp: lastEvidence.timestamp,
      },
    );
  }

  // 9. Capability snapshot match
  const planCapabilities = new Set(
    input.executionPlan.allowedCapabilities ?? [],
  );
  const identityCapabilities = new Set(
    input.runnerIdentity.allowedCapabilitiesSnapshot,
  );
  if (planCapabilities.size !== identityCapabilities.size) {
    throw new SessionError(
      `Capability snapshot mismatch: plan has ${planCapabilities.size} capabilities, identity has ${identityCapabilities.size}`,
      "ATTESTATION_INVALID",
      {
        planCapabilities: Array.from(planCapabilities).sort(),
        identityCapabilities: Array.from(identityCapabilities).sort(),
      },
    );
  }
  for (const cap of planCapabilities) {
    if (!identityCapabilities.has(cap)) {
      throw new SessionError(
        `Capability "${cap}" in plan but not in identity snapshot`,
        "ATTESTATION_INVALID",
        {
          capability: cap,
          planCapabilities: Array.from(planCapabilities).sort(),
          identityCapabilities: Array.from(identityCapabilities).sort(),
        },
      );
    }
  }

  // 10. Nonce uniqueness (replay resistance)
  // Skip for replay mode (Phase J: deterministic replay doesn't have stored nonces)
  if (!input.skipNonceUniqueness) {
    if (input.usedNonces.has(attestation.nonce)) {
      throw new SessionError(
        `Attestation nonce "${attestation.nonce}" has already been used (replay detected)`,
        "ATTESTATION_INVALID",
        {
          nonce: attestation.nonce,
        },
      );
    }
  }
  // Still validate nonce format (UUID v4) even in replay mode
  const nonceUuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!nonceUuidRegex.test(attestation.nonce)) {
    throw new SessionError(
      `Attestation nonce "${attestation.nonce}" is not a valid UUID v4`,
      "ATTESTATION_INVALID",
      {
        nonce: attestation.nonce,
      },
    );
  }

  // 11. Signature verification
  verifyAttestationSignature(attestation, input.runnerIdentity);

  return attestation;
}
