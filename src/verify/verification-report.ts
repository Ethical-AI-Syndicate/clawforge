/**
 * Verification Report Schema — deterministic verification output.
 *
 * Phase Q: Provides structured, deterministic JSON output for Sealed Change Package verification.
 */

import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "../session/crypto.js";

// ---------------------------------------------------------------------------
// Verification Report Schema
// ---------------------------------------------------------------------------

export interface VerificationReport {
  schemaVersion: "1.0.0";
  verifiedAt: string; // ISO 8601 UTC
  sessionId: string;
  passed: boolean;
  verifierHash: string; // SHA-256 of normalized report (excluding verifierHash)
  checks: {
    scpStructure: { passed: boolean; error?: string };
    scpHash: { passed: boolean; error?: string };
    decisionLock: { passed: boolean; hash: string; error?: string };
    executionPlan: { passed: boolean; hash: string; error?: string };
    promptCapsule: { passed: boolean; hash: string; error?: string };
    repoSnapshot: { passed: boolean; hash: string; error?: string };
    stepPackets: { passed: boolean; count: number; errors: string[] };
    patchArtifacts: { passed: boolean; count: number; errors: string[] };
    reviewerReports: { passed: boolean; count: number; errors: string[] };
    evidenceChain: { passed: boolean; count: number; errors: string[] };
    // Optional checks
    policySet?: { passed: boolean; hash: string; error?: string };
    policyEvaluation?: { passed: boolean; hash: string; error?: string };
    symbolIndex?: { passed: boolean; hash: string; error?: string };
    patchApplyReport?: { passed: boolean; hash: string; error?: string };
    runnerIdentity?: { passed: boolean; hash: string; error?: string };
    attestation?: {
      passed: boolean;
      hash: string;
      signatureValid?: boolean;
      error?: string;
    };
    approvalPolicy?: { passed: boolean; hash: string; error?: string };
    approvalBundle?: {
      passed: boolean;
      hash: string;
      signaturesValid?: boolean;
      error?: string;
    };
    anchor?: { passed: boolean; hash: string; error?: string };
  };
  errors: string[]; // Aggregated error messages
}

// ---------------------------------------------------------------------------
// Hash Computation
// ---------------------------------------------------------------------------

/**
 * Compute verifier hash from normalized report (excluding verifierHash field).
 *
 * @param report - Verification report without verifierHash
 * @returns 64-character lowercase hexadecimal SHA-256 hash
 */
export function computeVerifierHash(
  report: Omit<VerificationReport, "verifierHash">,
): string {
  const normalized = normalizeVerificationReport(report);
  const canonical = canonicalJson(normalized);
  return sha256Hex(canonical);
}

/**
 * Normalize verification report for hashing (excludes verifierHash field).
 */
function normalizeVerificationReport(
  report: Omit<VerificationReport, "verifierHash">,
): Record<string, unknown> {
  const checks: Record<string, unknown> = {
    scpStructure: report.checks.scpStructure,
    scpHash: report.checks.scpHash,
    decisionLock: report.checks.decisionLock,
    executionPlan: report.checks.executionPlan,
    promptCapsule: report.checks.promptCapsule,
    repoSnapshot: report.checks.repoSnapshot,
    stepPackets: {
      passed: report.checks.stepPackets.passed,
      count: report.checks.stepPackets.count,
      errors: [...report.checks.stepPackets.errors].sort(),
    },
    patchArtifacts: {
      passed: report.checks.patchArtifacts.passed,
      count: report.checks.patchArtifacts.count,
      errors: [...report.checks.patchArtifacts.errors].sort(),
    },
    reviewerReports: {
      passed: report.checks.reviewerReports.passed,
      count: report.checks.reviewerReports.count,
      errors: [...report.checks.reviewerReports.errors].sort(),
    },
    evidenceChain: {
      passed: report.checks.evidenceChain.passed,
      count: report.checks.evidenceChain.count,
      errors: [...report.checks.evidenceChain.errors].sort(),
    },
  };

  // Include optional checks if present
  if (report.checks.policySet) {
    checks.policySet = report.checks.policySet;
  }
  if (report.checks.policyEvaluation) {
    checks.policyEvaluation = report.checks.policyEvaluation;
  }
  if (report.checks.symbolIndex) {
    checks.symbolIndex = report.checks.symbolIndex;
  }
  if (report.checks.patchApplyReport) {
    checks.patchApplyReport = report.checks.patchApplyReport;
  }
  if (report.checks.runnerIdentity) {
    checks.runnerIdentity = report.checks.runnerIdentity;
  }
  if (report.checks.attestation) {
    checks.attestation = report.checks.attestation;
  }
  if (report.checks.approvalPolicy) {
    checks.approvalPolicy = report.checks.approvalPolicy;
  }
  if (report.checks.approvalBundle) {
    checks.approvalBundle = report.checks.approvalBundle;
  }
  if (report.checks.anchor) {
    checks.anchor = report.checks.anchor;
  }

  const normalized: Record<string, unknown> = {
    schemaVersion: report.schemaVersion,
    verifiedAt: report.verifiedAt,
    sessionId: report.sessionId,
    passed: report.passed,
    checks,
    errors: [...report.errors].sort(),
  };

  return normalized;
}

// ---------------------------------------------------------------------------
// Report Builder
// ---------------------------------------------------------------------------

/**
 * Create initial verification report structure.
 */
export function createVerificationReport(
  sessionId: string,
): Omit<VerificationReport, "verifierHash"> {
  return {
    schemaVersion: "1.0.0",
    verifiedAt: new Date().toISOString(),
    sessionId,
    passed: true,
    checks: {
      scpStructure: { passed: false, error: "not checked" },
      scpHash: { passed: false, error: "not checked" },
      decisionLock: { passed: false, hash: "", error: "not checked" },
      executionPlan: { passed: false, hash: "", error: "not checked" },
      promptCapsule: { passed: false, hash: "", error: "not checked" },
      repoSnapshot: { passed: false, hash: "", error: "not checked" },
      stepPackets: { passed: false, count: 0, errors: [] },
      patchArtifacts: { passed: false, count: 0, errors: [] },
      reviewerReports: { passed: false, count: 0, errors: [] },
      evidenceChain: { passed: false, count: 0, errors: [] },
    },
    errors: [],
  };
}

/**
 * Finalize verification report by computing verifierHash.
 */
export function finalizeVerificationReport(
  report: Omit<VerificationReport, "verifierHash">,
): VerificationReport {
  const verifierHash = computeVerifierHash(report);
  return {
    ...report,
    verifierHash,
  };
}
