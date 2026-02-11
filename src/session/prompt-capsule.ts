/**
 * Prompt Capsule Schema — deterministic model input packaging.
 *
 * Phase K: Packages AI model inputs with strict boundaries, explicit scope,
 * and deterministic parameters. All inputs must be hash-bound and replayable.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";

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

const ActorSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    actorType: z.enum(["human", "system"]),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Model configuration schema
// ---------------------------------------------------------------------------

const ModelProviderSchema = z.enum(["openai", "anthropic", "other"]);

const ModelConfigSchema = z
  .object({
    provider: ModelProviderSchema,
    modelId: z.string().min(1).max(200),
    temperature: z.number().refine((v) => v === 0, "temperature must be exactly 0"),
    topP: z.number().refine((v) => v === 1, "topP must be exactly 1"),
    seed: z.number().int().min(0).max(2147483647), // 0..2^31-1
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Intent schema
// ---------------------------------------------------------------------------

const TaskTypeSchema = z.enum([
  "code_change",
  "review",
  "design",
  "explain",
  "test_plan",
  "other",
]);

const IntentSchema = z
  .object({
    goalExcerpt: z.string().min(1).max(5000),
    taskType: TaskTypeSchema,
    forbiddenBehaviors: z.array(z.string().min(1)).min(3),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Context schema
// ---------------------------------------------------------------------------

const ContextSchema = z
  .object({
    systemPrompt: z.string().min(1).max(20000),
    userPrompt: z.string().min(1).max(20000),
    constraints: z.array(z.string().min(1)).min(3),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Boundaries schema
// ---------------------------------------------------------------------------

// Path validation: no "..", no absolute paths, no backslashes
const repoRelativePath = z
  .string()
  .min(1)
  .refine((p) => !p.includes(".."), "Path must not contain '..'")
  .refine((p) => !p.startsWith("/"), "Path must not be absolute")
  .refine((p) => !p.includes("\\"), "Path must not contain backslashes");

const symbolReference = z.string().min(1).max(500); // Format: <path>#<exportOrSymbolName>

const BoundariesSchema = z
  .object({
    allowedFiles: z.array(repoRelativePath).min(1).max(200),
    allowedSymbols: z.array(symbolReference).min(0).max(500),
    allowedDoDItems: z.array(z.string().min(1)).min(1),
    allowedPlanStepIds: z.array(z.string().min(1)).min(1),
    allowedCapabilities: z.array(z.string().min(1)),
    disallowedPatterns: z.array(z.string().min(1)).min(5),
    allowedExternalModules: z.array(z.string().min(1)),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Inputs schema
// ---------------------------------------------------------------------------

const FileDigestSchema = z
  .object({
    path: repoRelativePath,
    sha256: sha256Hex,
  })
  .passthrough();

const InputsSchema = z
  .object({
    fileDigests: z.array(FileDigestSchema),
    partialCoverage: z.boolean(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Hash schema
// ---------------------------------------------------------------------------

const HashSchema = z
  .object({
    capsuleHash: sha256Hex,
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Prompt Capsule Schema
// ---------------------------------------------------------------------------

export const PromptCapsuleSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    capsuleId: uuidV4,
    lockId: uuidV4,
    planHash: sha256Hex,
    createdAt: iso8601Utc,
    createdBy: ActorSchema,
    model: ModelConfigSchema,
    intent: IntentSchema,
    context: ContextSchema,
    boundaries: BoundariesSchema,
    inputs: InputsSchema,
    hash: HashSchema,
  })
  .passthrough()
  .refine(
    (capsule) => {
      // Check for duplicate allowedFiles
      const files = capsule.boundaries.allowedFiles;
      return new Set(files).size === files.length;
    },
    "allowedFiles must not contain duplicates",
  )
  .refine(
    (capsule) => {
      // Check that disallowedPatterns doesn't include empty strings
      return capsule.boundaries.disallowedPatterns.every((p) => p.length > 0);
    },
    "disallowedPatterns must not contain empty strings",
  )
  .refine(
    (capsule) => {
      // Check that fileDigests paths are subset of allowedFiles
      const allowedSet = new Set(capsule.boundaries.allowedFiles);
      return capsule.inputs.fileDigests.every((digest) =>
        allowedSet.has(digest.path),
      );
    },
    "fileDigests paths must be subset of allowedFiles",
  )
  .refine(
    (capsule) => {
      // If partialCoverage is false, fileDigests must cover all allowedFiles
      if (!capsule.inputs.partialCoverage) {
        const digestPaths = new Set(
          capsule.inputs.fileDigests.map((d) => d.path),
        );
        return capsule.boundaries.allowedFiles.every((path) =>
          digestPaths.has(path),
        );
      }
      return true;
    },
    "If partialCoverage is false, fileDigests must cover all allowedFiles",
  );

export type PromptCapsule = z.infer<typeof PromptCapsuleSchema>;

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute capsule hash from normalized capsule content (excluding hash.capsuleHash).
 *
 * @param capsule - Prompt capsule to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeCapsuleHash(capsule: PromptCapsule): string {
  // Create a copy excluding hash field entirely
  const { hash, ...rest } = capsule;
  const normalized = rest;
  
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}
