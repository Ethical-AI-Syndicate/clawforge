/**
 * Replay Engine — Phase J
 *
 * Deterministic replay of session artifacts for independent verification.
 * Pure function: no filesystem access, no stored state, no time dependencies.
 * Enables third-party verification of all hashes and verdicts from raw JSON.
 */

import { SessionError } from "./errors.js";
import type { ArtifactBundle } from "./bundle.js";
import { computePlanHash } from "./plan-hash.js";
import { computeEvidenceHash, validateEvidenceChain } from "./evidence-chain.js";
import { computeIdentityHash } from "./runner-identity.js";
import {
  computeAttestationPayloadHash,
  verifyAttestationSignature,
  type RunnerAttestation,
} from "./runner-attestation.js";
import { validateAnchor } from "./session-anchor.js";
import { validatePolicies } from "./policy-enforcement.js";
import {
  computePolicySetHash,
  computePolicyEvaluationHash,
} from "./policy-enforcement.js";
import type { SessionContext } from "./policy-engine.js";
import type { RuleEvaluationResult } from "./policy-engine.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { RunnerIdentity } from "./runner-identity.js";

// ---------------------------------------------------------------------------
// Replay Result
// ---------------------------------------------------------------------------

export interface ReplayResult {
  recomputedHashes: {
    planHash: string;
    evidenceHashes: string[];
    identityHash?: string;
    attestationPayloadHash?: string;
    attestationSignatureValid?: boolean;
    policySetHash?: string;
    policyEvaluationHash?: string;
    anchorHashes?: {
      finalEvidenceHash: string;
      finalAttestationHash?: string;
      runnerIdentityHash?: string;
      policySetHash?: string;
      policyEvaluationHash?: string;
    };
  };
  mismatches: Array<{
    type:
      | "planHash"
      | "evidenceHash"
      | "identityHash"
      | "attestationHash"
      | "attestationSignature"
      | "policySetHash"
      | "policyEvaluationHash"
      | "anchorHash";
    expected: string;
    got: string;
    artifact?: string;
    index?: number;
  }>;
  policyVerdict?: {
    passed: boolean;
    failures: RuleEvaluationResult[];
    warnings: RuleEvaluationResult[];
  };
  attestationValid: boolean;
  anchorValid: boolean;
  deterministicReplayPassed: boolean; // true if all hashes match and all validations pass
}

// ---------------------------------------------------------------------------
// Replay Engine
// ---------------------------------------------------------------------------

/**
 * Replay session from artifact bundle.
 *
 * Pure function: no side effects, no filesystem access, no stored state.
 * Recomputes all hashes and validates all bindings deterministically.
 *
 * @param bundle - Artifact bundle containing all session artifacts
 * @returns Replay result with recomputed hashes and validation results
 */
export function replaySession(bundle: ArtifactBundle): ReplayResult {
  const mismatches: ReplayResult["mismatches"] = [];
  const recomputedHashes: ReplayResult["recomputedHashes"] = {
    planHash: "",
    evidenceHashes: [],
  };

  // 1. Recompute planHash
  const computedPlanHash = computePlanHash(bundle.artifacts.executionPlan);
  recomputedHashes.planHash = computedPlanHash;

  const lockPlanHash = (bundle.artifacts.decisionLock as Record<string, unknown>)
    .planHash;
  if (typeof lockPlanHash === "string" && lockPlanHash !== computedPlanHash) {
    mismatches.push({
      type: "planHash",
      expected: computedPlanHash,
      got: lockPlanHash,
      artifact: "decisionLock",
    });
  }

  // 2. Recompute evidence chain hashes
  const evidenceHashes: string[] = [];
  for (let i = 0; i < bundle.artifacts.runnerEvidence.length; i++) {
    const evidence = bundle.artifacts.runnerEvidence[i]!;
    const computedHash = computeEvidenceHash(evidence);
    evidenceHashes.push(computedHash);

    const storedHash = (evidence as Record<string, unknown>).evidenceHash;
    if (typeof storedHash === "string" && storedHash !== computedHash) {
      mismatches.push({
        type: "evidenceHash",
        expected: computedHash,
        got: storedHash,
        artifact: "runnerEvidence",
        index: i,
      });
    }

    // Validate planHash binding in evidence
    const evidencePlanHash = (evidence as Record<string, unknown>).planHash;
    if (
      typeof evidencePlanHash === "string" &&
      evidencePlanHash !== computedPlanHash
    ) {
      mismatches.push({
        type: "planHash",
        expected: computedPlanHash,
        got: evidencePlanHash,
        artifact: "runnerEvidence",
        index: i,
      });
    }
  }
  recomputedHashes.evidenceHashes = evidenceHashes;

  // Validate evidence chain integrity
  try {
    validateEvidenceChain(
      bundle.artifacts.runnerEvidence,
      bundle.artifacts.executionPlan,
    );
  } catch (error) {
    if (error instanceof SessionError) {
      mismatches.push({
        type: "evidenceHash",
        expected: "valid chain",
        got: error.message,
        artifact: "runnerEvidence",
      });
    }
  }

  // 3. Recompute identityHash (if runnerIdentity present)
  let attestationValid = true;
  if (bundle.artifacts.runnerIdentity) {
    const computedIdentityHash = computeIdentityHash(
      bundle.artifacts.runnerIdentity,
    );
    recomputedHashes.identityHash = computedIdentityHash;

    // Compare with attestation if present
    if (bundle.artifacts.runnerAttestation) {
      if (
        bundle.artifacts.runnerAttestation.identityHash !== computedIdentityHash
      ) {
        mismatches.push({
          type: "identityHash",
          expected: computedIdentityHash,
          got: bundle.artifacts.runnerAttestation.identityHash,
          artifact: "runnerAttestation",
        });
        attestationValid = false;
      }
    }
  }

  // 4. Recompute attestation payload hash and verify signature (if attestation present)
  if (bundle.artifacts.runnerAttestation && bundle.artifacts.runnerIdentity) {
    const attestation = bundle.artifacts.runnerAttestation;
    const computedPayloadHash = computeAttestationPayloadHash(attestation);
    recomputedHashes.attestationPayloadHash = computedPayloadHash;

    // Verify signature (skip nonce uniqueness check for replay)
    try {
      verifyAttestationSignature(attestation, bundle.artifacts.runnerIdentity);
      recomputedHashes.attestationSignatureValid = true;
    } catch (error) {
      recomputedHashes.attestationSignatureValid = false;
      attestationValid = false;
      mismatches.push({
        type: "attestationSignature",
        expected: "valid signature",
        got: error instanceof Error ? error.message : String(error),
        artifact: "runnerAttestation",
      });
    }

    // Validate attestation bindings
    if (attestation.planHash !== computedPlanHash) {
      mismatches.push({
        type: "attestationHash",
        expected: computedPlanHash,
        got: attestation.planHash,
        artifact: "runnerAttestation",
      });
      attestationValid = false;
    }

    // Validate evidence chain tail hash
    if (evidenceHashes.length > 0) {
      const lastEvidenceHash = evidenceHashes[evidenceHashes.length - 1]!;
      if (attestation.evidenceChainTailHash !== lastEvidenceHash) {
        mismatches.push({
          type: "attestationHash",
          expected: lastEvidenceHash,
          got: attestation.evidenceChainTailHash,
          artifact: "runnerAttestation",
        });
        attestationValid = false;
      }
    }
  }

  // 5. Re-evaluate policies (if policies present)
  let policyVerdict: ReplayResult["policyVerdict"] | undefined;
  if (bundle.artifacts.policies && bundle.artifacts.policies.length > 0) {
    const context: SessionContext = {
      dod: bundle.artifacts.dod,
      decisionLock: bundle.artifacts.decisionLock,
      executionPlan: bundle.artifacts.executionPlan,
      evidenceChain: bundle.artifacts.runnerEvidence,
      runnerIdentity: bundle.artifacts.runnerIdentity,
      runnerAttestation: bundle.artifacts.runnerAttestation,
      anchor: bundle.artifacts.sessionAnchor,
    };

    try {
      const policyResult = validatePolicies(
        context,
        bundle.artifacts.policies,
      );
      policyVerdict = {
        passed: policyResult.passed,
        failures: policyResult.failures,
        warnings: policyResult.warnings,
      };

      // Recompute policy hashes
      const computedPolicySetHash = computePolicySetHash(
        bundle.artifacts.policies,
      );
      recomputedHashes.policySetHash = computedPolicySetHash;

      const computedPolicyEvaluationHash =
        computePolicyEvaluationHash(policyResult);
      recomputedHashes.policyEvaluationHash = computedPolicyEvaluationHash;

      // Compare with stored policyEvaluation if present
      if (bundle.artifacts.policyEvaluation) {
        const storedPolicySetHash = computePolicySetHash(
          bundle.artifacts.policies,
        );
        // Note: policyEvaluation doesn't contain policySetHash, so we compare with anchor
      }
    } catch (error) {
      // Policy validation threw (critical failure)
      policyVerdict = {
        passed: false,
        failures: [
          {
            ruleId: "policy-validation-error",
            passed: false,
            severity: "critical",
            effect: "deny",
            reason:
              error instanceof Error ? error.message : String(error),
          },
        ],
        warnings: [],
      };
    }
  }

  // 6. Recompute anchor validation
  let anchorValid = true;
  if (bundle.artifacts.sessionAnchor) {
    const anchor = bundle.artifacts.sessionAnchor;
    const anchorHashes: ReplayResult["recomputedHashes"]["anchorHashes"] = {
      finalEvidenceHash:
        evidenceHashes.length > 0
          ? evidenceHashes[evidenceHashes.length - 1]!
          : "",
    };

    if (bundle.artifacts.runnerAttestation) {
      const attestationHash = computeAttestationPayloadHash(
        bundle.artifacts.runnerAttestation,
      );
      anchorHashes.finalAttestationHash = attestationHash;
    }

    if (bundle.artifacts.runnerIdentity) {
      anchorHashes.runnerIdentityHash = recomputedHashes.identityHash;
    }

    if (recomputedHashes.policySetHash) {
      anchorHashes.policySetHash = recomputedHashes.policySetHash;
    }

    if (recomputedHashes.policyEvaluationHash) {
      anchorHashes.policyEvaluationHash =
        recomputedHashes.policyEvaluationHash;
    }

    recomputedHashes.anchorHashes = anchorHashes;

    // Validate anchor
    try {
      validateAnchor(
        anchor,
        bundle.artifacts.dod.sessionId,
        computedPlanHash,
        bundle.artifacts.decisionLock.lockId,
        anchorHashes.finalEvidenceHash,
        anchorHashes.finalAttestationHash,
        anchorHashes.runnerIdentityHash,
        anchorHashes.policySetHash,
        anchorHashes.policyEvaluationHash,
      );
    } catch (error) {
      anchorValid = false;
      mismatches.push({
        type: "anchorHash",
        expected: "valid anchor",
        got: error instanceof Error ? error.message : String(error),
        artifact: "sessionAnchor",
      });
    }
  }

  // Determine overall pass/fail
  const deterministicReplayPassed =
    mismatches.length === 0 &&
    attestationValid &&
    anchorValid &&
    (policyVerdict === undefined || policyVerdict.passed);

  return {
    recomputedHashes,
    mismatches,
    policyVerdict,
    attestationValid,
    anchorValid,
    deterministicReplayPassed,
  };
}
