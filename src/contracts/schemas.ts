/**
 * Zod schemas for the three core ClawForge contract types.
 *
 * Every schema uses .passthrough() at every object level so that unknown
 * fields added in future minor versions are preserved (forward compatibility).
 *
 * Schema version validation rejects any major version != 1.
 */

import { z } from "zod";
import { isSupportedSchemaVersion, parseSemver } from "./validation.js";

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
    (v) => parseSemver(v) !== null,
    "Must be a valid semver string (MAJOR.MINOR.PATCH)",
  )
  .refine(
    (v) => isSupportedSchemaVersion(v),
    `Unsupported schema major version (supported: 1)`,
  );

// ---------------------------------------------------------------------------
// Nested object schemas
// ---------------------------------------------------------------------------

const ContractActorSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    actorType: z.enum(["human", "system"]),
  })
  .passthrough();

const IntentConstraintsSchema = z
  .object({
    maxSteps: z.number().int().min(1).max(1000),
    timeoutMs: z.number().int().min(1).max(86_400_000),
    providers: z.array(z.string().min(1).max(200)).max(20),
  })
  .passthrough();

const RetryPolicySchema = z
  .object({
    maxRetries: z.number().int().min(0).max(10),
    backoffMs: z.number().int().min(100).max(60_000),
  })
  .passthrough();

const WorkerConstraintsSchema = z
  .object({
    maxDurationMs: z.number().int().min(1).max(3_600_000),
    maxOutputBytes: z.number().int().min(1).max(104_857_600),
    sandboxed: z.boolean(),
  })
  .passthrough();

/**
 * Field that accepts null OR a non-empty plain object (used for
 * expectedOutputSchema / outputSchema fields).
 */
const jsonSchemaOrNull = z.union([
  z.null(),
  z
    .record(z.string(), z.unknown())
    .refine(
      (r) => Object.keys(r).length > 0,
      "Schema object must not be empty",
    ),
]);

// ---------------------------------------------------------------------------
// Record<string,unknown> field schemas with size / key constraints
// ---------------------------------------------------------------------------

/**
 * inputParams: max 50 keys, each key 1..200 chars, serialized <= 100 KB.
 */
const inputParamsSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (r) => Object.keys(r).length <= 50,
    "inputParams must have at most 50 keys",
  )
  .refine(
    (r) => Object.keys(r).every((k) => k.length >= 1 && k.length <= 200),
    "Each inputParams key must be 1..200 characters",
  )
  .refine(
    (r) => Buffer.byteLength(JSON.stringify(r), "utf8") <= 102_400,
    "inputParams serialized size must not exceed 100 KB",
  );

/**
 * toolParams: max 50 keys, serialized <= 100 KB.
 */
const toolParamsSchema = z
  .record(z.string(), z.unknown())
  .refine(
    (r) => Object.keys(r).length <= 50,
    "toolParams must have at most 50 keys",
  )
  .refine(
    (r) => Buffer.byteLength(JSON.stringify(r), "utf8") <= 102_400,
    "toolParams serialized size must not exceed 100 KB",
  );

// ---------------------------------------------------------------------------
// Contract schemas
// ---------------------------------------------------------------------------

export const IntentContractSchema = z
  .object({
    schemaVersion,
    intentId: uuidV4,
    title: z.string().min(1).max(500),
    description: z.string().max(5000),
    actor: ContractActorSchema,
    constraints: IntentConstraintsSchema,
    inputParams: inputParamsSchema,
    tags: z.array(z.string().min(1).max(100)).max(20),
    createdAt: iso8601Utc,
  })
  .passthrough();

export const StepContractSchema = z
  .object({
    schemaVersion,
    stepId: uuidV4,
    intentId: uuidV4,
    stepIndex: z.number().int().min(0).max(999),
    name: z.string().min(1).max(300),
    description: z.string().max(3000),
    toolName: z.string().min(1).max(200),
    toolParams: toolParamsSchema,
    expectedOutputSchema: jsonSchemaOrNull,
    requiresApproval: z.boolean(),
    retryPolicy: RetryPolicySchema,
    dependsOn: z.array(uuidV4).max(50),
    createdAt: iso8601Utc,
  })
  .passthrough();

export const WorkerTaskContractSchema = z
  .object({
    schemaVersion,
    taskId: uuidV4,
    stepId: uuidV4,
    runId: uuidV4,
    workerType: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-zA-Z0-9._-]+$/, "Must match pattern [a-zA-Z0-9._-]+"),
    instructions: z.string().max(10_000),
    inputRefs: z.array(z.string().min(1).max(200)).max(100),
    constraints: WorkerConstraintsSchema,
    outputSchema: jsonSchemaOrNull,
    createdAt: iso8601Utc,
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Type exports (inferred from schemas)
// ---------------------------------------------------------------------------

export type IntentContract = z.infer<typeof IntentContractSchema>;
export type StepContract = z.infer<typeof StepContractSchema>;
export type WorkerTaskContract = z.infer<typeof WorkerTaskContractSchema>;
