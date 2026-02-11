/**
 * Session anchor validation — optional anchor binding session artifacts.
 *
 * Anchor binds sessionId, planHash, lockId, and finalEvidenceHash.
 * If present, must validate correctly.
 */

import { z } from "zod";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const sha256HexString = z
  .string()
  .regex(SHA256_HEX_RE, "Must be 64-char lowercase hex SHA-256");

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

export const SessionAnchorSchema = z
  .object({
    sessionId: uuidV4,
    planHash: sha256HexString,
    lockId: uuidV4,
    finalEvidenceHash: sha256HexString,
    // Phase H: Attestation fields (optional)
    finalAttestationHash: sha256HexString.optional(),
    runnerIdentityHash: sha256HexString.optional(),
    // Phase I: Policy fields (optional)
    policySetHash: sha256HexString.optional(),
    policyEvaluationHash: sha256HexString.optional(),
  })
  .passthrough();

export type SessionAnchor = z.infer<typeof SessionAnchorSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate session anchor.
 *
 * Checks:
 * - Schema validity
 * - sessionId matches expected
 * - planHash matches expected
 * - lockId matches expected
 * - finalEvidenceHash matches last evidence hash
 * - finalAttestationHash matches (if provided)
 * - runnerIdentityHash matches (if provided)
 * - policySetHash matches (if provided)
 * - policyEvaluationHash matches (if provided)
 *
 * @param anchor - Anchor object to validate
 * @param sessionId - Expected session ID
 * @param planHash - Expected plan hash
 * @param lockId - Expected lock ID
 * @param finalEvidenceHash - Expected final evidence hash (from last evidence item)
 * @param finalAttestationHash - Expected final attestation hash (optional)
 * @param runnerIdentityHash - Expected runner identity hash (optional)
 * @param policySetHash - Expected policy set hash (optional)
 * @param policyEvaluationHash - Expected policy evaluation hash (optional)
 * @throws SessionError with code ANCHOR_INVALID on any failure
 */
export function validateAnchor(
  anchor: unknown,
  sessionId: string,
  planHash: string,
  lockId: string,
  finalEvidenceHash: string,
  finalAttestationHash?: string,
  runnerIdentityHash?: string,
  policySetHash?: string,
  policyEvaluationHash?: string,
): void {
  // Schema validation
  const parseResult = SessionAnchorSchema.safeParse(anchor);
  if (!parseResult.success) {
    throw new SessionError(
      `Anchor schema invalid: ${parseResult.error.message}`,
      "ANCHOR_INVALID",
      { errors: parseResult.error.message },
    );
  }
  
  const anchorObj = parseResult.data;
  
  // Validate bindings
  if (anchorObj.sessionId !== sessionId) {
    throw new SessionError(
      `Anchor sessionId mismatch: expected ${sessionId}, got ${anchorObj.sessionId}`,
      "ANCHOR_INVALID",
      {
        field: "sessionId",
        expected: sessionId,
        got: anchorObj.sessionId,
      },
    );
  }
  
  if (anchorObj.planHash !== planHash) {
    throw new SessionError(
      `Anchor planHash mismatch: expected ${planHash}, got ${anchorObj.planHash}`,
      "ANCHOR_INVALID",
      {
        field: "planHash",
        expected: planHash,
        got: anchorObj.planHash,
      },
    );
  }
  
  if (anchorObj.lockId !== lockId) {
    throw new SessionError(
      `Anchor lockId mismatch: expected ${lockId}, got ${anchorObj.lockId}`,
      "ANCHOR_INVALID",
      {
        field: "lockId",
        expected: lockId,
        got: anchorObj.lockId,
      },
    );
  }
  
  if (anchorObj.finalEvidenceHash !== finalEvidenceHash) {
    throw new SessionError(
      `Anchor finalEvidenceHash mismatch: expected ${finalEvidenceHash}, got ${anchorObj.finalEvidenceHash}`,
      "ANCHOR_INVALID",
      {
        field: "finalEvidenceHash",
        expected: finalEvidenceHash,
        got: anchorObj.finalEvidenceHash,
      },
    );
  }

  // Phase H: Validate attestation fields if present
  if (finalAttestationHash !== undefined) {
    if (anchorObj.finalAttestationHash === undefined) {
      throw new SessionError(
        "Anchor missing finalAttestationHash but expected",
        "ANCHOR_INVALID",
        {
          field: "finalAttestationHash",
          reason: "missing",
        },
      );
    }
    if (anchorObj.finalAttestationHash !== finalAttestationHash) {
      throw new SessionError(
        `Anchor finalAttestationHash mismatch: expected ${finalAttestationHash}, got ${anchorObj.finalAttestationHash}`,
        "ANCHOR_INVALID",
        {
          field: "finalAttestationHash",
          expected: finalAttestationHash,
          got: anchorObj.finalAttestationHash,
        },
      );
    }
  }

  if (runnerIdentityHash !== undefined) {
    if (anchorObj.runnerIdentityHash === undefined) {
      throw new SessionError(
        "Anchor missing runnerIdentityHash but expected",
        "ANCHOR_INVALID",
        {
          field: "runnerIdentityHash",
          reason: "missing",
        },
      );
    }
    if (anchorObj.runnerIdentityHash !== runnerIdentityHash) {
      throw new SessionError(
        `Anchor runnerIdentityHash mismatch: expected ${runnerIdentityHash}, got ${anchorObj.runnerIdentityHash}`,
        "ANCHOR_INVALID",
        {
          field: "runnerIdentityHash",
          expected: runnerIdentityHash,
          got: anchorObj.runnerIdentityHash,
        },
      );
    }
  }

  // Phase I: Validate policy fields if present
  if (policySetHash !== undefined) {
    if (anchorObj.policySetHash === undefined) {
      throw new SessionError(
        "Anchor missing policySetHash but expected",
        "ANCHOR_INVALID",
        {
          field: "policySetHash",
          reason: "missing",
        },
      );
    }
    if (anchorObj.policySetHash !== policySetHash) {
      throw new SessionError(
        `Anchor policySetHash mismatch: expected ${policySetHash}, got ${anchorObj.policySetHash}`,
        "ANCHOR_INVALID",
        {
          field: "policySetHash",
          expected: policySetHash,
          got: anchorObj.policySetHash,
        },
      );
    }
  }

  if (policyEvaluationHash !== undefined) {
    if (anchorObj.policyEvaluationHash === undefined) {
      throw new SessionError(
        "Anchor missing policyEvaluationHash but expected",
        "ANCHOR_INVALID",
        {
          field: "policyEvaluationHash",
          reason: "missing",
        },
      );
    }
    if (anchorObj.policyEvaluationHash !== policyEvaluationHash) {
      throw new SessionError(
        `Anchor policyEvaluationHash mismatch: expected ${policyEvaluationHash}, got ${anchorObj.policyEvaluationHash}`,
        "ANCHOR_INVALID",
        {
          field: "policyEvaluationHash",
          expected: policyEvaluationHash,
          got: anchorObj.policyEvaluationHash,
        },
      );
    }
  }
}
