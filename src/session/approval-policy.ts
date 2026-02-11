/**
 * Approval Policy — defines who can approve what artifacts.
 *
 * Phase N: Defines approvers, roles, quorum rules, and allowed algorithms
 * for cryptographic approval signatures.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
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

// PEM format validation (same pattern as runner-identity.ts)
const PEM_PUBLIC_KEY_RE =
  /^-----BEGIN (PUBLIC KEY|RSA PUBLIC KEY|EC PUBLIC KEY)-----[\s\S]+-----END (PUBLIC KEY|RSA PUBLIC KEY|EC PUBLIC KEY)-----[\s]*$/;

const publicKeyPem = z
  .string()
  .min(1)
  .refine(
    (s) => PEM_PUBLIC_KEY_RE.test(s),
    "Must be PEM format public key",
  );

const ApproverSchema = z
  .object({
    approverId: z.string().min(1).max(200),
    role: z.string().min(1).max(200),
    publicKeyPem: publicKeyPem,
    active: z.boolean(),
  })
  .passthrough();

const QuorumSchema = z
  .object({
    type: z.literal("m_of_n"),
    m: z.number().int().min(1),
    n: z.number().int().min(1),
  })
  .passthrough();

const ApprovalRuleSchema = z
  .object({
    artifactType: z.enum(["decision_lock", "execution_plan", "prompt_capsule"]),
    requiredRoles: z.array(z.string().min(1).max(200)).min(1),
    quorum: QuorumSchema,
    requireDistinctApprovers: z.boolean(),
  })
  .passthrough();

export const ApprovalPolicySchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    sessionId: uuidV4,
    policyId: uuidV4,
    allowedAlgorithms: z.array(z.string().min(1)).min(1),
    approvers: z.array(ApproverSchema).min(1),
    rules: z.array(ApprovalRuleSchema).min(1),
    createdAt: iso8601Utc,
  })
  .passthrough();

export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;
export type Approver = z.infer<typeof ApproverSchema>;
export type ApprovalRule = z.infer<typeof ApprovalRuleSchema>;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate approval policy structure and constraints.
 *
 * @param policy - Policy to validate
 * @throws SessionError with code APPROVAL_POLICY_INVALID on any failure
 */
export function validateApprovalPolicy(policy: ApprovalPolicy): void {
  // Schema validation
  const parseResult = ApprovalPolicySchema.safeParse(policy);
  if (!parseResult.success) {
    const errors = parseResult.error.issues
      .map((issue) => issue.message)
      .join("; ");
    throw new SessionError(
      `Approval policy schema invalid: ${errors}`,
      "APPROVAL_POLICY_INVALID",
      { policyId: policy.policyId, errors },
    );
  }

  // Validate allowedAlgorithms contains only "RSA-SHA256"
  const invalidAlgorithms = policy.allowedAlgorithms.filter(
    (alg) => alg !== "RSA-SHA256",
  );
  if (invalidAlgorithms.length > 0) {
    throw new SessionError(
      `Approval policy contains disallowed algorithms: ${invalidAlgorithms.join(", ")}. Only RSA-SHA256 is allowed`,
      "APPROVAL_POLICY_INVALID",
      { policyId: policy.policyId, invalidAlgorithms },
    );
  }

  // Validate approver IDs are unique
  const approverIds = policy.approvers.map((a) => a.approverId);
  const uniqueApproverIds = new Set(approverIds);
  if (approverIds.length !== uniqueApproverIds.size) {
    throw new SessionError(
      "Approval policy contains duplicate approverId values",
      "APPROVAL_POLICY_INVALID",
      { policyId: policy.policyId },
    );
  }

  // Build role to approver map
  const roleToApprovers = new Map<string, Approver[]>();
  for (const approver of policy.approvers) {
    const existing = roleToApprovers.get(approver.role) ?? [];
    existing.push(approver);
    roleToApprovers.set(approver.role, existing);
  }

  // Validate each rule
  for (const rule of policy.rules) {
    // Validate quorum: m <= n, m > 0, n > 0
    if (rule.quorum.m > rule.quorum.n) {
      throw new SessionError(
        `Quorum m (${rule.quorum.m}) cannot be greater than n (${rule.quorum.n}) for artifact type ${rule.artifactType}`,
        "APPROVAL_POLICY_INVALID",
        {
          policyId: policy.policyId,
          artifactType: rule.artifactType,
          m: rule.quorum.m,
          n: rule.quorum.n,
        },
      );
    }

    if (rule.quorum.m <= 0) {
      throw new SessionError(
        `Quorum m must be greater than 0 for artifact type ${rule.artifactType}`,
        "APPROVAL_POLICY_INVALID",
        {
          policyId: policy.policyId,
          artifactType: rule.artifactType,
          m: rule.quorum.m,
        },
      );
    }

    if (rule.quorum.n <= 0) {
      throw new SessionError(
        `Quorum n must be greater than 0 for artifact type ${rule.artifactType}`,
        "APPROVAL_POLICY_INVALID",
        {
          policyId: policy.policyId,
          artifactType: rule.artifactType,
          n: rule.quorum.n,
        },
      );
    }

    // Validate requiredRoles exist in approvers
    const allActiveApproversForRule = new Set<string>();
    for (const role of rule.requiredRoles) {
      const approversWithRole = roleToApprovers.get(role);
      if (!approversWithRole || approversWithRole.length === 0) {
        throw new SessionError(
          `Required role "${role}" for artifact type ${rule.artifactType} has no approvers`,
          "APPROVAL_POLICY_INVALID",
          {
            policyId: policy.policyId,
            artifactType: rule.artifactType,
            role,
          },
        );
      }

      // Check if all approvers with this role are inactive
      const activeApprovers = approversWithRole.filter((a) => a.active);
      if (activeApprovers.length === 0) {
        throw new SessionError(
          `Required role "${role}" for artifact type ${rule.artifactType} has no active approvers`,
          "APPROVAL_POLICY_INVALID",
          {
            policyId: policy.policyId,
            artifactType: rule.artifactType,
            role,
          },
        );
      }

      // Collect all active approvers across all required roles
      for (const approver of activeApprovers) {
        allActiveApproversForRule.add(approver.approverId);
      }
    }

    // Validate quorum.n doesn't exceed total available approvers across all required roles
    if (rule.quorum.n > allActiveApproversForRule.size) {
      throw new SessionError(
        `Quorum n (${rule.quorum.n}) exceeds available active approvers (${allActiveApproversForRule.size}) for artifact type ${rule.artifactType}`,
        "APPROVAL_POLICY_INVALID",
        {
          policyId: policy.policyId,
          artifactType: rule.artifactType,
          n: rule.quorum.n,
          availableApprovers: allActiveApproversForRule.size,
        },
      );
    }

    // Validate requireDistinctApprovers is true (as per spec)
    if (!rule.requireDistinctApprovers) {
      throw new SessionError(
        `requireDistinctApprovers must be true for artifact type ${rule.artifactType}`,
        "APPROVAL_POLICY_INVALID",
        {
          policyId: policy.policyId,
          artifactType: rule.artifactType,
        },
      );
    }
  }
}
