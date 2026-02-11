/**
 * Policy Schema — Phase I
 *
 * Defines policy artifact schema for Policy-as-Code governance.
 * Policies are static JSON artifacts that compile into deterministic rule evaluation.
 * No code execution. No dynamic loading. Fail-closed.
 */

import { z } from "zod";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

const ISO8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const iso8601Utc = z
  .string()
  .regex(ISO8601_RE, "Must be ISO 8601 UTC datetime")
  .refine((s) => !isNaN(Date.parse(s)), "Must be parseable datetime");

const ActorSchema = z
  .object({
    actorId: z.string().min(1).max(200),
    actorType: z.enum(["human", "system"]),
  })
  .passthrough();

// Semantic version regex (simplified)
const SEMVER_RE = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;
const semver = z.string().regex(SEMVER_RE, "Must be semantic version format");

// ---------------------------------------------------------------------------
// Policy Condition Schema
// ---------------------------------------------------------------------------

export const PolicyConditionSchema = z
  .object({
    field: z.string().min(1).max(500), // Dot-notation path
    operator: z.enum([
      "equals",
      "not_equals",
      "in",
      "not_in",
      "subset_of",
      "superset_of",
      "greater_than",
      "less_than",
      "exists",
      "matches_regex",
    ]),
    value: z.unknown(), // Type-checked per operator in engine
  })
  .passthrough();

export type PolicyCondition = z.infer<typeof PolicyConditionSchema>;

// ---------------------------------------------------------------------------
// Policy Rule Schema
// ---------------------------------------------------------------------------

export const PolicyRuleSchema = z
  .object({
    ruleId: z.string().min(1).max(100),
    description: z.string().min(1).max(1000),
    target: z.enum([
      "plan",
      "evidence",
      "attestation",
      "runnerIdentity",
      "capability",
    ]),
    condition: PolicyConditionSchema,
    effect: z.enum(["allow", "deny", "require"]),
    severity: z.enum(["info", "warning", "critical"]),
  })
  .passthrough();

export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

// ---------------------------------------------------------------------------
// Policy Schema
// ---------------------------------------------------------------------------

export const PolicySchema = z
  .object({
    policyId: uuidV4,
    name: z.string().min(1).max(200),
    version: semver,
    scope: z.enum(["session", "plan", "runner", "capability", "global"]),
    rules: z.array(PolicyRuleSchema).min(1).max(1000),
    createdAt: iso8601Utc,
    createdBy: ActorSchema,
  })
  .passthrough();

export type Policy = z.infer<typeof PolicySchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate policy schema.
 *
 * @param policy - Raw policy object to validate
 * @throws SessionError with code POLICY_INVALID on failure
 */
export function validatePolicy(policy: unknown): Policy {
  const parseResult = PolicySchema.safeParse(policy);
  if (!parseResult.success) {
    throw new SessionError(
      `Policy schema invalid: ${parseResult.error.message}`,
      "POLICY_INVALID",
      { errors: parseResult.error.message },
    );
  }
  return parseResult.data;
}
