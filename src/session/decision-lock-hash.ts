/**
 * Decision Lock Hash Computation — deterministic lock identity.
 *
 * Phase N: Computes deterministic hash of Decision Lock excluding
 * approvalMetadata field for signature binding.
 */

import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";
import type { DecisionLock } from "./schemas.js";

/**
 * Compute decision lock hash from normalized lock (excluding approvalMetadata).
 *
 * @param lock - Decision lock to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeDecisionLockHash(lock: DecisionLock): string {
  const normalized = normalizeDecisionLock(lock);
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}

/**
 * Normalize decision lock for hashing (excludes approvalMetadata).
 */
function normalizeDecisionLock(
  lock: DecisionLock,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    schemaVersion: lock.schemaVersion,
    lockId: lock.lockId,
    sessionId: lock.sessionId,
    dodId: lock.dodId,
    goal: lock.goal,
    nonGoals: [...lock.nonGoals].sort(), // Sort for determinism
    interfaces: lock.interfaces.map((iface) => {
      const ifaceNorm: Record<string, unknown> = {};
      const keys = Object.keys(iface).sort();
      for (const key of keys) {
        ifaceNorm[key] = iface[key as keyof typeof iface];
      }
      return ifaceNorm;
    }),
    invariants: [...lock.invariants].sort(),
    constraints: [...lock.constraints].sort(),
    failureModes: lock.failureModes.map((fm) => {
      const fmNorm: Record<string, unknown> = {};
      const keys = Object.keys(fm).sort();
      for (const key of keys) {
        fmNorm[key] = fm[key as keyof typeof fm];
      }
      return fmNorm;
    }),
    risksAndTradeoffs: lock.risksAndTradeoffs.map((rt) => {
      const rtNorm: Record<string, unknown> = {};
      const keys = Object.keys(rt).sort();
      for (const key of keys) {
        rtNorm[key] = rt[key as keyof typeof rt];
      }
      return rtNorm;
    }),
    status: lock.status,
    createdAt: lock.createdAt,
    createdBy: lock.createdBy,
  };

  // Include passthrough fields but exclude approvalMetadata
  const allKeys = Object.keys(lock).sort();
  for (const key of allKeys) {
    if (
      key === "schemaVersion" ||
      key === "lockId" ||
      key === "sessionId" ||
      key === "dodId" ||
      key === "goal" ||
      key === "nonGoals" ||
      key === "interfaces" ||
      key === "invariants" ||
      key === "constraints" ||
      key === "failureModes" ||
      key === "risksAndTradeoffs" ||
      key === "status" ||
      key === "createdAt" ||
      key === "createdBy" ||
      key === "approvalMetadata" // Exclude approvalMetadata
    ) {
      continue;
    }
    normalized[key] = lock[key as keyof DecisionLock];
  }

  return normalized;
}
