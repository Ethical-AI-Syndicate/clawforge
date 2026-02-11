/**
 * Evidence chain validation — tamper-evident chain linking.
 *
 * Validates that evidence items form a valid chain with:
 * - planHash matching plan
 * - evidenceHash matching computed hash
 * - prevEvidenceHash linking to previous item
 * - Monotonic timestamps
 */

import { sha256Hex } from "./crypto.js";
import { canonicalize, normalizeRunnerEvidence } from "./canonical.js";
import { SessionError } from "./errors.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import { computePlanHash } from "./plan-hash.js";

/**
 * Compute evidence hash from normalized evidence (excluding evidenceHash field).
 *
 * @param evidence - Runner evidence to hash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeEvidenceHash(evidence: RunnerEvidence): string {
  const normalized = normalizeRunnerEvidence(evidence);
  const canonical = canonicalize(normalized);
  return sha256Hex(canonical);
}

/**
 * Validate evidence chain integrity.
 *
 * Checks:
 * - Each evidence item has planHash matching plan
 * - Each evidenceHash matches computed hash
 * - prevEvidenceHash links correctly (first item has null, others link to previous)
 * - Timestamps are monotonic non-decreasing
 *
 * @param evidenceList - Array of evidence items
 * @param plan - Execution plan for planHash validation
 * @throws SessionError with code EVIDENCE_CHAIN_INVALID on any failure
 */
export function validateEvidenceChain(
  evidenceList: RunnerEvidence[],
  plan: ExecutionPlanLike,
): void {
  const planHash = computePlanHash(plan);
  let prevHash: string | null = null;
  let prevTimestamp: string | null = null;
  
  for (let i = 0; i < evidenceList.length; i++) {
    const evidence = evidenceList[i];
    if (!evidence) {
      throw new SessionError(
        `Evidence ${i} is undefined`,
        "EVIDENCE_CHAIN_INVALID",
        { index: i, field: "evidence", reason: "undefined" },
      );
    }
    const index = i;
    
    // Check planHash matches
    const evidencePlanHash = (evidence as Record<string, unknown>).planHash;
    if (typeof evidencePlanHash !== "string") {
      throw new SessionError(
        `Evidence ${index} missing planHash`,
        "EVIDENCE_CHAIN_INVALID",
        {
          index,
          field: "planHash",
          reason: "missing",
        },
      );
    }
    
    if (evidencePlanHash !== planHash) {
      throw new SessionError(
        `Evidence ${index} planHash mismatch: expected ${planHash}, got ${evidencePlanHash}`,
        "EVIDENCE_CHAIN_INVALID",
        {
          index,
          field: "planHash",
          reason: "mismatch",
          expected: planHash,
          got: evidencePlanHash,
        },
      );
    }
    
    // Check evidenceHash matches computed
    const evidenceHash = (evidence as Record<string, unknown>).evidenceHash;
    if (typeof evidenceHash !== "string") {
      throw new SessionError(
        `Evidence ${index} missing evidenceHash`,
        "EVIDENCE_CHAIN_INVALID",
        {
          index,
          field: "evidenceHash",
          reason: "missing",
        },
      );
    }
    
    const computedHash = computeEvidenceHash(evidence);
    if (evidenceHash !== computedHash) {
      throw new SessionError(
        `Evidence ${index} evidenceHash mismatch: expected ${computedHash}, got ${evidenceHash}`,
        "EVIDENCE_CHAIN_INVALID",
        {
          index,
          field: "evidenceHash",
          reason: "mismatch",
          expected: computedHash,
          got: evidenceHash,
        },
      );
    }
    
    // Check prevEvidenceHash links correctly
    const prevEvidenceHash = (evidence as Record<string, unknown>).prevEvidenceHash;
    if (index === 0) {
      // First item must have null prevEvidenceHash
      if (prevEvidenceHash !== null && prevEvidenceHash !== undefined) {
        throw new SessionError(
          `Evidence ${index} (first) must have null prevEvidenceHash, got ${prevEvidenceHash}`,
          "EVIDENCE_CHAIN_INVALID",
          {
            index,
            field: "prevEvidenceHash",
            reason: "first item must be null",
            got: prevEvidenceHash,
          },
        );
      }
    } else {
      // Subsequent items must link to previous hash
      if (prevEvidenceHash !== prevHash) {
        throw new SessionError(
          `Evidence ${index} prevEvidenceHash mismatch: expected ${prevHash}, got ${prevEvidenceHash}`,
          "EVIDENCE_CHAIN_INVALID",
          {
            index,
            field: "prevEvidenceHash",
            reason: "mismatch",
            expected: prevHash,
            got: prevEvidenceHash,
          },
        );
      }
    }
    
    // Check monotonic timestamps
    if (prevTimestamp !== null) {
      const currentTime = Date.parse(evidence.timestamp);
      const prevTime = Date.parse(prevTimestamp);
      if (isNaN(currentTime) || isNaN(prevTime)) {
        throw new SessionError(
          `Evidence ${index} or previous has invalid timestamp`,
          "EVIDENCE_CHAIN_INVALID",
          {
            index,
            field: "timestamp",
            reason: "invalid ISO8601",
          },
        );
      }
      if (currentTime < prevTime) {
        throw new SessionError(
          `Evidence ${index} timestamp ${evidence.timestamp} is before previous ${prevTimestamp}`,
          "EVIDENCE_CHAIN_INVALID",
          {
            index,
            field: "timestamp",
            reason: "non-monotonic",
            current: evidence.timestamp,
            previous: prevTimestamp,
          },
        );
      }
    }
    
    prevHash = evidenceHash;
    prevTimestamp = evidence.timestamp;
  }
}
