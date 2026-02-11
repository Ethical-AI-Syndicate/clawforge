/**
 * Zod schemas for session-layer artifacts: Definition of Done,
 * Decision Lock, Execution Gate Result, and Gate Check.
 *
 * These schemas are part of the orchestration layer — they do NOT
 * modify kernel contracts, audit semantics, or evidence exports.
 *
 * Every schema uses .passthrough() at every object level so that
 * unknown fields added in future minor versions are preserved.
 *
 * Schema version is validated against a single exported constant
 * (exact match, not a range).
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Version constant
// ---------------------------------------------------------------------------

/**
 * The exact schema version supported by this build.
 * All session-layer schemas validate schemaVersion against this value.
 */
export const SESSION_SCHEMA_VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Shared field-level schemas
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const iso8601Utc = z
  .string()
  .regex(
    ISO8601_RE,
    "Must be ISO 8601 UTC datetime (YYYY-MM-DDTHH:mm:ss.sssZ)",
  )
  .refine((s) => !isNaN(Date.parse(s)), "Must be a parseable datetime");

const schemaVersion = z
  .string()
  .refine(
    (v) => v === SESSION_SCHEMA_VERSION,
    `schemaVersion must be exactly "${SESSION_SCHEMA_VERSION}"`,
  );

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

const sha256Hex = z
  .string()
  .regex(SHA256_HEX_RE, "Must be a 64-char lowercase hex SHA-256 hash");

// ---------------------------------------------------------------------------
// Nested object schemas
// ---------------------------------------------------------------------------

const ActorSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    actorType: z.enum(["human", "system"]),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// DoD Item
// ---------------------------------------------------------------------------

export const DoDItemSchema = z
  .object({
    id: z.string().min(1).max(100),
    description: z.string().min(1).max(2000),
    verificationMethod: z.enum([
      "command_exit_code",
      "file_exists",
      "file_hash_match",
      "command_output_match",
      "artifact_recorded",
      "custom",
    ]),
    verificationCommand: z.string().max(5000).optional(),
    expectedExitCode: z.number().int().min(0).max(255).optional(),
    expectedOutput: z.string().max(10000).optional(),
    expectedHash: sha256Hex.optional(),
    targetPath: z.string().max(1000).optional(),
    verificationProcedure: z.string().max(5000).optional(),
    notDoneConditions: z.array(z.string().min(1).max(1000)).max(20),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Definition of Done
// ---------------------------------------------------------------------------

/** Patterns that indicate vague, non-verifiable language. */
const VAGUE_LANGUAGE_RE =
  /\b(works?\s+as\s+expected|should\s+be\s+fine|seems?\s+correct|looks?\s+good)\b/i;

export const DefinitionOfDoneSchema = z
  .object({
    schemaVersion,
    dodId: uuidV4,
    sessionId: uuidV4,
    title: z.string().min(1).max(500),
    items: z.array(DoDItemSchema).min(1).max(100),
    createdAt: iso8601Utc,
    createdBy: ActorSchema,
  })
  .passthrough()
  .refine(
    (dod) =>
      dod.items.every(
        (item) => !VAGUE_LANGUAGE_RE.test(item.description),
      ),
    "DoD items must not contain vague statements like 'works as expected', 'should be fine', 'seems correct', or 'looks good'",
  );

// ---------------------------------------------------------------------------
// Decision Lock
// ---------------------------------------------------------------------------

const InterfaceSchema = z
  .object({
    name: z.string().min(1).max(300),
    description: z.string().min(1).max(2000),
    type: z.enum(["api", "cli", "file", "event", "schema", "other"]),
  })
  .passthrough();

const FailureModeSchema = z
  .object({
    description: z.string().min(1).max(1000),
    mitigation: z.string().min(1).max(1000),
  })
  .passthrough();

const RiskTradeoffSchema = z
  .object({
    description: z.string().min(1).max(1000),
    severity: z.enum(["low", "medium", "high"]),
    accepted: z.boolean(),
  })
  .passthrough();

const ApprovalMetadataSchema = z
  .object({
    approvedBy: z.string().min(1).max(200),
    approvedAt: iso8601Utc,
    approvalMethod: z.string().min(1).max(200),
  })
  .passthrough();

export const DecisionLockSchema = z
  .object({
    schemaVersion,
    lockId: uuidV4,
    sessionId: uuidV4,
    dodId: uuidV4,
    goal: z.string().min(1).max(5000),
    nonGoals: z.array(z.string().min(1).max(1000)).min(1).max(50),
    interfaces: z.array(InterfaceSchema).max(50),
    invariants: z.array(z.string().min(1).max(1000)).min(1).max(50),
    constraints: z.array(z.string().min(1).max(1000)).max(50),
    failureModes: z.array(FailureModeSchema).max(50),
    risksAndTradeoffs: z.array(RiskTradeoffSchema).max(50),
    status: z.enum(["draft", "approved", "rejected"]),
    approvalMetadata: ApprovalMetadataSchema.optional(),
    createdAt: iso8601Utc,
    createdBy: ActorSchema,
  })
  .passthrough()
  .refine(
    (lock) => lock.status !== "approved" || lock.approvalMetadata !== undefined,
    "approvalMetadata is required when status is 'approved'",
  );

// ---------------------------------------------------------------------------
// Execution Gate Result
// ---------------------------------------------------------------------------

export const GateCheckSchema = z
  .object({
    checkId: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    passed: z.boolean(),
    failureReason: z.string().max(2000).optional(),
  })
  .passthrough();

export const ExecutionGateResultSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    passed: z.boolean(),
    checks: z.array(GateCheckSchema).min(1),
    evaluatedAt: iso8601Utc,
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Type exports (inferred from schemas)
// ---------------------------------------------------------------------------

export type DoDItem = z.infer<typeof DoDItemSchema>;
export type DefinitionOfDone = z.infer<typeof DefinitionOfDoneSchema>;
export type DecisionLock = z.infer<typeof DecisionLockSchema>;
export type GateCheck = z.infer<typeof GateCheckSchema>;
export type ExecutionGateResult = z.infer<typeof ExecutionGateResultSchema>;
