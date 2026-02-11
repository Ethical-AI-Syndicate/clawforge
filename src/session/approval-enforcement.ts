/**
 * Approval Enforcement — quorum rule enforcement and signature validation.
 *
 * Phase N: Enforces quorum requirements and validates all signatures
 * match expected artifact hashes.
 */

import { SessionError } from "./errors.js";
import type { ApprovalPolicy, Approver } from "./approval-policy.js";
import type { ApprovalBundle, ApprovalSignature } from "./approval-bundle.js";
import { verifySignature } from "./approval-bundle.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApprovalEnforcementResult {
  passed: boolean;
  errors: string[]; // deterministic, sorted
  satisfiedRules: SatisfiedRule[];
}

export interface SatisfiedRule {
  artifactType: string;
  requiredSignatures: number;
  actualSignatures: number;
  approverIds: string[];
}

export interface EnforceApprovalsInput {
  policy: ApprovalPolicy;
  bundle: ApprovalBundle;
  artifacts: {
    decisionLockHash?: string;
    planHash?: string;
    capsuleHash?: string;
  };
  usedNonces: string[]; // for replay check
}

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce approval signatures against policy and artifacts.
 *
 * @param input - Policy, bundle, artifacts, and used nonces
 * @returns Enforcement result with errors and satisfied rules
 */
export function enforceApprovals(
  input: EnforceApprovalsInput,
): ApprovalEnforcementResult {
  const { policy, bundle, artifacts, usedNonces } = input;
  const errors: string[] = [];
  const satisfiedRules: SatisfiedRule[] = [];

  // 1. Verify bundle.sessionId matches policy.sessionId
  if (bundle.sessionId !== policy.sessionId) {
    errors.push(
      `Bundle sessionId "${bundle.sessionId}" does not match policy sessionId "${policy.sessionId}"`,
    );
    return { passed: false, errors: errors.sort(), satisfiedRules: [] };
  }

  // Build approver map for quick lookup
  const approverMap = new Map<string, Approver>();
  for (const approver of policy.approvers) {
    approverMap.set(approver.approverId, approver);
  }

  // Build role to approvers map
  const roleToApprovers = new Map<string, Approver[]>();
  for (const approver of policy.approvers) {
    const existing = roleToApprovers.get(approver.role) ?? [];
    existing.push(approver);
    roleToApprovers.set(approver.role, existing);
  }

  // 2. Validate each signature
  const approverIdsUsedByArtifactType = new Map<
    "decision_lock" | "execution_plan" | "prompt_capsule",
    Set<string>
  >();
  const signaturesByArtifactType = new Map<
    "decision_lock" | "execution_plan" | "prompt_capsule",
    ApprovalSignature[]
  >();

  for (const signature of bundle.signatures) {
    // Verify signature.sessionId matches bundle.sessionId
    if (signature.sessionId !== bundle.sessionId) {
      errors.push(
        `Signature ${signature.signatureId} sessionId "${signature.sessionId}" does not match bundle sessionId "${bundle.sessionId}"`,
      );
      continue;
    }

    // Verify approver exists and is active
    const approver = approverMap.get(signature.approverId);
    if (!approver) {
      errors.push(
        `Signature ${signature.signatureId} references unknown approver "${signature.approverId}"`,
      );
      continue;
    }

    if (!approver.active) {
      errors.push(
        `Signature ${signature.signatureId} references inactive approver "${signature.approverId}"`,
      );
      continue;
    }

    // Verify approver.role matches signature.role
    if (approver.role !== signature.role) {
      errors.push(
        `Signature ${signature.signatureId} role "${signature.role}" does not match approver role "${approver.role}"`,
      );
      continue;
    }

    // Verify signature.algorithm is in policy.allowedAlgorithms
    if (!policy.allowedAlgorithms.includes(signature.algorithm)) {
      errors.push(
        `Signature ${signature.signatureId} algorithm "${signature.algorithm}" is not in allowedAlgorithms`,
      );
      continue;
    }

    // Verify signature using cryptographic verification
    try {
      verifySignature(signature, approver.publicKeyPem);
    } catch (error) {
      if (error instanceof SessionError) {
        errors.push(
          `Signature ${signature.signatureId} verification failed: ${error.message}`,
        );
      } else {
        errors.push(
          `Signature ${signature.signatureId} verification failed: ${String(error)}`,
        );
      }
      continue;
    }

    // Verify nonce not reused (replay check)
    if (usedNonces.includes(signature.nonce)) {
      errors.push(
        `Signature ${signature.signatureId} uses reused nonce "${signature.nonce}"`,
      );
      continue;
    }

    // Verify approverId uniqueness per artifact type (if requireDistinctApprovers)
    const approverIdsForType = approverIdsUsedByArtifactType.get(signature.artifactType) ?? new Set<string>();
    if (approverIdsForType.has(signature.approverId)) {
      // Check if rule requires distinct approvers
      const rule = policy.rules.find(
        (r) => r.artifactType === signature.artifactType,
      );
      if (rule && rule.requireDistinctApprovers) {
        errors.push(
          `Signature ${signature.signatureId} duplicate approverId "${signature.approverId}" violates requireDistinctApprovers`,
        );
        continue;
      }
    }

    approverIdsForType.add(signature.approverId);
    approverIdsUsedByArtifactType.set(signature.artifactType, approverIdsForType);

    // Verify signature.artifactHash matches expected artifact hash
    let expectedHash: string | undefined;
    if (signature.artifactType === "decision_lock") {
      expectedHash = artifacts.decisionLockHash;
    } else if (signature.artifactType === "execution_plan") {
      expectedHash = artifacts.planHash;
    } else if (signature.artifactType === "prompt_capsule") {
      expectedHash = artifacts.capsuleHash;
    }

    if (!expectedHash) {
      errors.push(
        `Signature ${signature.signatureId} artifactType "${signature.artifactType}" has no corresponding artifact hash`,
      );
      continue;
    }

    if (signature.artifactHash !== expectedHash) {
      errors.push(
        `Signature ${signature.signatureId} artifactHash "${signature.artifactHash}" does not match expected "${expectedHash}"`,
      );
      continue;
    }

    // Group signature by artifact type
    const existing = signaturesByArtifactType.get(signature.artifactType) ?? [];
    existing.push(signature);
    signaturesByArtifactType.set(signature.artifactType, existing);
  }

  // 3. Verify quorum for each artifact type
  for (const rule of policy.rules) {
    const signatures = signaturesByArtifactType.get(rule.artifactType) ?? [];

    // Filter signatures by required roles
    const signaturesWithRequiredRoles = signatures.filter((sig) =>
      rule.requiredRoles.includes(sig.role),
    );

    // Count unique approvers with required roles
    const uniqueApproverIds = new Set(
      signaturesWithRequiredRoles.map((sig) => sig.approverId),
    );

    // Verify quorum satisfied
    const actualSignatures = uniqueApproverIds.size;
    const requiredSignatures = rule.quorum.m;
    const totalApprovers = rule.quorum.n;

    if (actualSignatures < requiredSignatures) {
      errors.push(
        `Quorum not met for ${rule.artifactType}: required ${requiredSignatures} signatures, got ${actualSignatures}`,
      );
    } else {
      satisfiedRules.push({
        artifactType: rule.artifactType,
        requiredSignatures,
        actualSignatures,
        approverIds: Array.from(uniqueApproverIds).sort(),
      });
    }
  }

  // Sort errors for determinism
  errors.sort();

  return {
    passed: errors.length === 0,
    errors,
    satisfiedRules: satisfiedRules.sort((a, b) =>
      a.artifactType.localeCompare(b.artifactType),
    ),
  };
}
