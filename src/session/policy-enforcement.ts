/**
 * Policy Enforcement — Phase I
 *
 * Validates policies against session context and applies enforcement logic.
 * Deny rules block sessions. Require rules must pass. Severity determines handling.
 */

import { SessionError } from "./errors.js";
import type { Policy } from "./policy.js";
import type { SessionContext } from "./policy-engine.js";
import {
  evaluatePolicy,
  type PolicyEvaluationResult,
  type RuleEvaluationResult,
} from "./policy-engine.js";

// ---------------------------------------------------------------------------
// Policy Validation Result
// ---------------------------------------------------------------------------

export interface PolicyValidationResult {
  passed: boolean;
  policyResults: PolicyEvaluationResult[];
  failures: RuleEvaluationResult[]; // critical + deny/require failures
  warnings: RuleEvaluationResult[];
  info: RuleEvaluationResult[];
}

// ---------------------------------------------------------------------------
// Policy Validation
// ---------------------------------------------------------------------------

/**
 * Validate policies against session context and apply enforcement.
 *
 * Enforcement rules:
 * - Any `deny` rule passes → session fails
 * - Any `require` rule fails → session fails
 * - `critical` severity → throw SessionError
 * - `warning` → collected but not blocking
 * - `info` → collected but not blocking
 *
 * @param context - Session context
 * @param policies - Policies to evaluate
 * @returns Policy validation result
 * @throws SessionError with code POLICY_DENIED or POLICY_REQUIREMENT_FAILED on critical failures
 */
export function validatePolicies(
  context: SessionContext,
  policies: Policy[],
): PolicyValidationResult {
  const policyResults: PolicyEvaluationResult[] = [];
  const failures: RuleEvaluationResult[] = [];
  const warnings: RuleEvaluationResult[] = [];
  const info: RuleEvaluationResult[] = [];

  // Evaluate all policies
  for (const policy of policies) {
    try {
      const result = evaluatePolicy(policy, context);
      policyResults.push(result);

      // Categorize rule results
      for (const ruleResult of result.ruleResults) {
        // Deny rules: if condition passes, session is denied
        if (ruleResult.effect === "deny" && ruleResult.passed) {
          failures.push(ruleResult);
          if (ruleResult.severity === "critical") {
            throw new SessionError(
              `Policy "${policy.name}" rule "${ruleResult.ruleId}" denies session`,
              "POLICY_DENIED",
              {
                policyId: policy.policyId,
                policyName: policy.name,
                ruleId: ruleResult.ruleId,
                reason: ruleResult.reason,
              },
            );
          }
        }

        // Require rules: if condition fails, session is denied
        if (ruleResult.effect === "require" && !ruleResult.passed) {
          failures.push(ruleResult);
          if (ruleResult.severity === "critical") {
            throw new SessionError(
              `Policy "${policy.name}" rule "${ruleResult.ruleId}" requirement failed`,
              "POLICY_REQUIREMENT_FAILED",
              {
                policyId: policy.policyId,
                policyName: policy.name,
                ruleId: ruleResult.ruleId,
                reason: ruleResult.reason,
              },
            );
          }
        }

        // Categorize by severity (only for non-deny/require rules, or when they don't block)
        // For deny: only add to failures if condition matched (already handled above)
        // For require: only add to failures if condition failed (already handled above)
        // For allow: categorize by severity
        if (ruleResult.effect === "allow") {
          if (ruleResult.severity === "critical" && !ruleResult.passed) {
            failures.push(ruleResult);
          } else if (ruleResult.severity === "warning") {
            warnings.push(ruleResult);
          } else if (ruleResult.severity === "info") {
            info.push(ruleResult);
          }
        } else if (ruleResult.effect === "deny" && !ruleResult.passed) {
          // Deny rule condition didn't match - don't block, but categorize by severity
          if (ruleResult.severity === "warning") {
            warnings.push(ruleResult);
          } else if (ruleResult.severity === "info") {
            info.push(ruleResult);
          }
        } else if (ruleResult.effect === "require" && ruleResult.passed) {
          // Require rule condition matched - categorize by severity
          if (ruleResult.severity === "warning") {
            warnings.push(ruleResult);
          } else if (ruleResult.severity === "info") {
            info.push(ruleResult);
          }
        }
      }
    } catch (error) {
      if (error instanceof SessionError) {
        // Re-throw critical policy errors
        if (
          error.code === "POLICY_DENIED" ||
          error.code === "POLICY_REQUIREMENT_FAILED"
        ) {
          throw error;
        }
        // Other errors are evaluation failures
        failures.push({
          ruleId: "evaluation-error",
          passed: false,
          severity: "critical",
          effect: "deny",
          reason: error.message,
        });
      } else {
        failures.push({
          ruleId: "evaluation-error",
          passed: false,
          severity: "critical",
          effect: "deny",
          reason:
            error instanceof Error
              ? error.message
              : `Unknown error: ${String(error)}`,
        });
      }
    }
  }

  // Determine overall pass/fail
  // Session passes if:
  // - No blocking failures exist
  // Blocking failures are:
  //   - Deny rules where condition passed (matched deny condition)
  //   - Require rules where condition failed (requirement not met)
  //   - Critical severity failures
  const hasBlockingFailure = failures.some(
    (f) =>
      (f.effect === "deny" && f.passed) ||
      (f.effect === "require" && !f.passed) ||
      (f.severity === "critical" && !f.passed),
  );
  
  const finalPassed = !hasBlockingFailure;

  return {
    passed: finalPassed,
    policyResults,
    failures,
    warnings,
    info,
  };
}

import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";

/**
 * Compute policy set hash from array of policies.
 * Policies are sorted by policyId for deterministic hashing.
 *
 * @param policies - Array of policies
 * @returns SHA-256 hash of canonical JSON
 */
export function computePolicySetHash(policies: Policy[]): string {
  const sorted = [...policies].sort((a, b) =>
    a.policyId.localeCompare(b.policyId),
  );
  const canonical = canonicalize(sorted);
  return sha256Hex(canonical);
}

/**
 * Compute policy evaluation hash from validation result.
 *
 * @param result - Policy validation result
 * @returns SHA-256 hash of canonical JSON
 */
export function computePolicyEvaluationHash(
  result: PolicyValidationResult,
): string {
  const canonical = canonicalize(result);
  return sha256Hex(canonical);
}
