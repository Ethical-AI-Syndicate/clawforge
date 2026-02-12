/**
 * Model Response Artifact Schema — deterministic model output packaging.
 *
 * Phase K: Packages AI model outputs with strict boundary validation.
 * All outputs must cite allowed references and cannot introduce new symbols
 * outside the capsule's allowed reference set.
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

const ModelProviderSchema = z.enum(["openai", "anthropic", "other"]);

// ---------------------------------------------------------------------------
// Change Proposal Schema
// ---------------------------------------------------------------------------

const ChangeTypeSchema = z.enum([
  "edit_file",
  "add_file",
  "delete_file",
  "rename_file",
  "no_change",
]);

export const ChangeProposalSchema = z
  .object({
    changeId: z.string().min(1).max(100),
    changeType: ChangeTypeSchema,
    targetPath: z.string().min(1).max(1000),
    patch: z.string().max(200000).nullable(),
    referencedDoDItems: z.array(z.string().min(1)).min(1),
    referencedPlanStepIds: z.array(z.string().min(1)).min(1),
    referencedSymbols: z.array(z.string().min(1)).min(0),
    riskNotes: z.array(z.string().min(1)).min(0).max(20),
  })
  .passthrough();

export type ChangeProposal = z.infer<typeof ChangeProposalSchema>;

// ---------------------------------------------------------------------------
// Citation Schema
// ---------------------------------------------------------------------------

const CitationTypeSchema = z.enum([
  "file",
  "symbol",
  "dod_item",
  "plan_step",
  "policy",
  "other",
]);

export const CitationSchema = z
  .object({
    type: CitationTypeSchema,
    ref: z.string().min(1).max(1000),
    note: z.string().min(1).max(2000),
  })
  .passthrough();

export type Citation = z.infer<typeof CitationSchema>;

// ---------------------------------------------------------------------------
// Model Response Artifact Schema
// ---------------------------------------------------------------------------

const ModelInfoSchema = z
  .object({
    provider: ModelProviderSchema,
    modelId: z.string().min(1).max(200),
    seed: z.number().int().min(0).max(2147483647),
  })
  .passthrough();

const RefusalSchema = z
  .object({
    reason: z.string().min(1).max(5000),
  })
  .passthrough();

const OutputSchema = z
  .object({
    summary: z.string().min(1).max(5000),
    proposedChanges: z.array(ChangeProposalSchema).min(0),
    citations: z.array(CitationSchema).min(1),
    refusal: RefusalSchema.optional(),
  })
  .passthrough()
  .refine(
    (output) => {
      if (output.refusal !== undefined) {
        return output.proposedChanges.length === 0;
      }
      return output.proposedChanges.length >= 1;
    },
    "If refusal is present, proposedChanges must be empty; otherwise at least one change required",
  );

const ResponseHashSchema = z
  .object({
    responseHash: z.string().regex(/^[0-9a-f]{64}$/, "Must be a 64-char lowercase hex SHA-256 hash"),
  })
  .passthrough();

export const ModelResponseArtifactSchema = z
  .object({
    schemaVersion,
    sessionId: uuidV4,
    capsuleId: uuidV4,
    responseId: uuidV4,
    createdAt: iso8601Utc,
    model: ModelInfoSchema,
    output: OutputSchema,
    hash: ResponseHashSchema,
  })
  .passthrough();

export type ModelResponseArtifact = z.infer<typeof ModelResponseArtifactSchema>;

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute response hash from normalized response content (excluding hash.responseHash).
 *
 * @param response - Model response artifact to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeResponseHash(response: ModelResponseArtifact): string {
  // Create a copy excluding hash field entirely
  const { hash, ...rest } = response;
  const normalized = rest;
  
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}
