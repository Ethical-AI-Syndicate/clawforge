/**
 * Runner Contract — declarative schemas for external runner boundary.
 *
 * Defines RunnerRequest (input to runner) and RunnerEvidence (output from runner).
 * No executable instructions. No shell, URLs, or side-effect semantics.
 * ClawForge validates only; it does not launch or call the runner.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso8601Utc = z
  .string()
  .regex(ISO8601_RE, "Must be ISO 8601 UTC datetime")
  .refine((s) => !isNaN(Date.parse(s)), "Must be parseable datetime");

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const sha256Hex = z
  .string()
  .regex(SHA256_HEX_RE, "Must be 64-char lowercase hex SHA-256");

const schemaVersion = z.literal(SESSION_SCHEMA_VERSION);

// ---------------------------------------------------------------------------
// RunnerRequestSchema — input contract to external runner (declarative only)
// ---------------------------------------------------------------------------

export const RunnerRequestSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    lockId: uuidV4,
    dodId: uuidV4,
    goal: z.string().min(1).max(5000),
    stepId: z.string().min(1).max(100),
    allowedCapabilities: z.array(z.string().min(1).max(200)).min(1).max(50),
    expectedEvidenceTypes: z.array(z.string().min(1).max(100)).min(1).max(20),
    verificationRequirements: z
      .array(z.string().min(1).max(2000))
      .min(1)
      .max(50),
  })
  .passthrough();

export type RunnerRequest = z.infer<typeof RunnerRequestSchema>;

// ---------------------------------------------------------------------------
// RunnerEvidenceSchema — output contract from runner (structurally verifiable)
// ---------------------------------------------------------------------------

export const RunnerEvidenceSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    stepId: z.string().min(1).max(100),
    evidenceId: uuidV4,
    timestamp: iso8601Utc,
    evidenceType: z.string().min(1).max(100),
    artifactHash: sha256Hex,
    verificationMetadata: z.record(z.string(), z.unknown()),
    capabilityUsed: z.string().min(1).max(200),
    humanConfirmationProof: z.string().min(1).max(2000),
    // Phase F: tamper-evident chain fields (optional in schema, required for Phase F validation)
    planHash: sha256Hex.optional(),
    prevEvidenceHash: sha256Hex.nullable().optional(),
    evidenceHash: sha256Hex.optional(),
  })
  .passthrough();

export type RunnerEvidence = z.infer<typeof RunnerEvidenceSchema>;
