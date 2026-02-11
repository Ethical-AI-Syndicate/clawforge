/**
 * Runner Identity Model — Phase H
 *
 * Defines runner identity schema and validation.
 * Runner identity binds runner version, public key, environment fingerprint,
 * and capability snapshot into a verifiable identity.
 */

import { z } from "zod";
import { SessionError } from "./errors.js";
import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";

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

// PEM format: starts with -----BEGIN PUBLIC KEY----- or similar
// Allow for various newline formats and whitespace (including trailing newlines)
const PEM_PUBLIC_KEY_RE =
  /^-----BEGIN (PUBLIC KEY|RSA PUBLIC KEY|EC PUBLIC KEY)-----[\s\S]+-----END (PUBLIC KEY|RSA PUBLIC KEY|EC PUBLIC KEY)-----[\s]*$/;

// Hex-encoded public key (for compact representation)
const HEX_PUBLIC_KEY_RE = /^[0-9a-f]{64,512}$/i;

const publicKey = z
  .string()
  .min(1)
  .refine(
    (s) => PEM_PUBLIC_KEY_RE.test(s) || HEX_PUBLIC_KEY_RE.test(s),
    "Must be PEM format or hex-encoded public key",
  );

export const RunnerIdentitySchema = z
  .object({
    runnerId: uuidV4,
    runnerVersion: z.string().min(1).max(100),
    runnerPublicKey: publicKey,
    environmentFingerprint: sha256HexString,
    buildHash: sha256HexString,
    allowedCapabilitiesSnapshot: z.array(z.string().min(1).max(200)).min(0),
    attestationTimestamp: iso8601Utc,
  })
  .passthrough();

export type RunnerIdentity = z.infer<typeof RunnerIdentitySchema>;

// ---------------------------------------------------------------------------
// Identity hash computation
// ---------------------------------------------------------------------------

/**
 * Compute identity hash from canonical runner identity.
 *
 * @param identity - Runner identity to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeIdentityHash(identity: RunnerIdentity): string {
  const normalized = normalizeRunnerIdentity(identity);
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}

/**
 * Normalize runner identity for hashing.
 * Strips volatile fields and ensures stable structure.
 */
function normalizeRunnerIdentity(
  identity: RunnerIdentity,
): Record<string, unknown> {
  return {
    runnerId: identity.runnerId,
    runnerVersion: identity.runnerVersion,
    runnerPublicKey: identity.runnerPublicKey,
    environmentFingerprint: identity.environmentFingerprint,
    buildHash: identity.buildHash,
    allowedCapabilitiesSnapshot: [...identity.allowedCapabilitiesSnapshot].sort(),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate runner identity schema and structure.
 *
 * @param identity - Raw identity object to validate
 * @throws SessionError with code RUNNER_IDENTITY_INVALID on failure
 */
export function validateRunnerIdentity(identity: unknown): RunnerIdentity {
  const parseResult = RunnerIdentitySchema.safeParse(identity);
  if (!parseResult.success) {
    throw new SessionError(
      `Runner identity schema invalid: ${parseResult.error.message}`,
      "RUNNER_IDENTITY_INVALID",
      { errors: parseResult.error.message },
    );
  }
  return parseResult.data;
}
