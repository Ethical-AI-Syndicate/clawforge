/**
 * Plan hash computation and validation.
 *
 * Provides stable plan identity via SHA-256 hash of normalized plan.
 */

import { sha256Hex } from "./crypto.js";
import { canonicalize, normalizeExecutionPlan } from "./canonical.js";
import { SessionError } from "./errors.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { DecisionLock } from "./schemas.js";

/**
 * Compute plan hash from normalized execution plan.
 *
 * @param plan - Execution plan to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computePlanHash(plan: ExecutionPlanLike): string {
  const normalized = normalizeExecutionPlan(plan);
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}

/**
 * Validate that lock.planHash matches computed plan hash.
 *
 * @param plan - Execution plan
 * @param lock - Decision lock with planHash field
 * @throws SessionError with code PLAN_HASH_MISMATCH if mismatch
 */
export function validatePlanHashBinding(
  plan: ExecutionPlanLike,
  lock: DecisionLock,
): void {
  const computedHash = computePlanHash(plan);
  
  // planHash is optional in schema but required for Phase F validation
  const lockPlanHash = (lock as Record<string, unknown>).planHash;
  
  if (typeof lockPlanHash !== "string") {
    throw new SessionError(
      "Decision Lock missing planHash field",
      "PLAN_HASH_MISSING",
      { lockId: lock.lockId },
    );
  }
  
  if (lockPlanHash !== computedHash) {
    throw new SessionError(
      `Plan hash mismatch: expected ${computedHash}, got ${lockPlanHash}`,
      "PLAN_HASH_MISMATCH",
      {
        expected: computedHash,
        got: lockPlanHash,
        lockId: lock.lockId,
      },
    );
  }
}
