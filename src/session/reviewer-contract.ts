/**
 * ReviewerContract — reviewer roles and structured report schema.
 *
 * Defines the fixed set of reviewer roles, violation structure,
 * and the report schema each reviewer produces.
 * No execution. Structural validation only.
 */

import { z } from "zod";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV4 = z.string().regex(UUID_V4_RE, "Must be a valid UUID v4");

export const REVIEWER_ROLES = ["static", "security", "qa", "e2e", "automation"] as const;

export const ReviewerRoleSchema = z.enum(REVIEWER_ROLES);

export const ViolationSchema = z
  .object({
    ruleId: z.string().min(1),
    message: z.string().min(1),
  })
  .passthrough();

export const ReviewerReportSchema = z
  .object({
    schemaVersion: z.literal(SESSION_SCHEMA_VERSION),
    sessionId: uuidV4,
    stepId: z.string().min(1),
    reviewerRole: ReviewerRoleSchema,
    passed: z.boolean(),
    violations: z.array(ViolationSchema),
    notes: z.array(z.string()).default([]),
  })
  .passthrough()
  .refine(
    (r) => {
      if (!r.passed && r.violations.length === 0) return false;
      if (r.passed && r.violations.length > 0) return false;
      return true;
    },
    "passed=false requires violations.length > 0; passed=true requires violations.length === 0",
  );

export type ReviewerRole = z.infer<typeof ReviewerRoleSchema>;
export type Violation = z.infer<typeof ViolationSchema>;
export type ReviewerReport = z.infer<typeof ReviewerReportSchema>;
