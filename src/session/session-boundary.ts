/**
 * Session Boundary Validation — ensures all artifacts belong to the same session.
 *
 * Phase G: Validates that sessionId matches across all artifacts and that
 * hash bindings (planHash, evidenceHash, anchor) are consistent.
 * Prevents cross-session artifact reuse.
 */

import { SessionError } from "./errors.js";
import type { DefinitionOfDone, DecisionLock } from "./schemas.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { SessionAnchor } from "./session-anchor.js";
import type { RunnerAttestation } from "./runner-attestation.js";
import type { RunnerIdentity } from "./runner-identity.js";
import type { Policy } from "./policy.js";
import type { SessionContext } from "./policy-engine.js";
import { computePlanHash } from "./plan-hash.js";
import { computeEvidenceHash } from "./evidence-chain.js";
import { computeIdentityHash } from "./runner-identity.js";
import { canonicalize } from "./canonical.js";
import { sha256Hex } from "./crypto.js";
import { validatePolicies } from "./policy-enforcement.js";
import {
  computePolicySetHash,
  computePolicyEvaluationHash,
} from "./policy-enforcement.js";

// ---------------------------------------------------------------------------
// Validation input types
// ---------------------------------------------------------------------------

export interface SessionBoundaryInput {
  sessionId: string;
  dod: DefinitionOfDone;
  decisionLock: DecisionLock;
  executionPlan: ExecutionPlanLike;
  runnerEvidence: RunnerEvidence[];
  anchor?: SessionAnchor;
  attestation?: RunnerAttestation;
  runnerIdentity?: RunnerIdentity;
  policies?: Policy[]; // Phase I: Optional policies for validation
}

// ---------------------------------------------------------------------------
// Session boundary validation
// ---------------------------------------------------------------------------

/**
 * Validate session boundary integrity.
 *
 * Checks:
 * - sessionId matches across DoD, Decision Lock, Execution Plan, Runner Evidence, and Anchor
 * - planHash matches lock binding
 * - anchor finalEvidenceHash matches tail of evidence chain (if anchor present)
 * - No cross-session artifact reuse
 *
 * @param input - All session artifacts to validate
 * @throws SessionError with code SESSION_BOUNDARY_INVALID on any failure
 */
export function validateSessionBoundary(input: SessionBoundaryInput): void {
  const { sessionId, dod, decisionLock, executionPlan, runnerEvidence, anchor } =
    input;

  // 1. Validate sessionId matches across all artifacts
  if (dod.sessionId !== sessionId) {
    throw new SessionError(
      `DoD sessionId "${dod.sessionId}" does not match expected "${sessionId}"`,
      "SESSION_BOUNDARY_INVALID",
      {
        artifact: "DoD",
        expected: sessionId,
        got: dod.sessionId,
      },
    );
  }

  if (decisionLock.sessionId !== sessionId) {
    throw new SessionError(
      `Decision Lock sessionId "${decisionLock.sessionId}" does not match expected "${sessionId}"`,
      "SESSION_BOUNDARY_INVALID",
      {
        artifact: "DecisionLock",
        expected: sessionId,
        got: decisionLock.sessionId,
      },
    );
  }

  const planSessionId = executionPlan.sessionId;
  if (planSessionId !== undefined && planSessionId !== sessionId) {
    throw new SessionError(
      `Execution Plan sessionId "${planSessionId}" does not match expected "${sessionId}"`,
      "SESSION_BOUNDARY_INVALID",
      {
        artifact: "ExecutionPlan",
        expected: sessionId,
        got: planSessionId,
      },
    );
  }

  // Validate all evidence items have matching sessionId
  for (let i = 0; i < runnerEvidence.length; i++) {
    const evidence = runnerEvidence[i];
    if (!evidence) continue;
    if (evidence.sessionId !== sessionId) {
      throw new SessionError(
        `Runner Evidence ${i} sessionId "${evidence.sessionId}" does not match expected "${sessionId}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerEvidence",
          index: i,
          expected: sessionId,
          got: evidence.sessionId,
        },
      );
    }
  }

  // 2. Validate planHash matches lock binding
  const computedPlanHash = computePlanHash(executionPlan);
  const lockPlanHash = (decisionLock as Record<string, unknown>).planHash;
  if (typeof lockPlanHash === "string") {
    if (lockPlanHash !== computedPlanHash) {
      throw new SessionError(
        `Decision Lock planHash "${lockPlanHash}" does not match computed plan hash "${computedPlanHash}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "DecisionLock",
          expected: computedPlanHash,
          got: lockPlanHash,
        },
      );
    }
  }

  // 3. Validate anchor finalEvidenceHash matches tail of evidence chain
  if (anchor) {
    if (anchor.sessionId !== sessionId) {
      throw new SessionError(
        `Anchor sessionId "${anchor.sessionId}" does not match expected "${sessionId}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "SessionAnchor",
          expected: sessionId,
          got: anchor.sessionId,
        },
      );
    }

    if (anchor.lockId !== decisionLock.lockId) {
      throw new SessionError(
        `Anchor lockId "${anchor.lockId}" does not match Decision Lock lockId "${decisionLock.lockId}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "SessionAnchor",
          expected: decisionLock.lockId,
          got: anchor.lockId,
        },
      );
    }

    if (anchor.planHash !== computedPlanHash) {
      throw new SessionError(
        `Anchor planHash "${anchor.planHash}" does not match computed plan hash "${computedPlanHash}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "SessionAnchor",
          expected: computedPlanHash,
          got: anchor.planHash,
        },
      );
    }

    // Compute final evidence hash from last evidence item
    if (runnerEvidence.length === 0) {
      throw new SessionError(
        "Anchor present but no runner evidence found",
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "SessionAnchor",
          reason: "no_evidence",
        },
      );
    }

    const lastEvidence = runnerEvidence[runnerEvidence.length - 1];
    if (!lastEvidence) {
      throw new SessionError(
        "Last evidence item is undefined",
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerEvidence",
          reason: "undefined_last_item",
        },
      );
    }

    const lastEvidenceHash = (lastEvidence as Record<string, unknown>)
      .evidenceHash;
    if (typeof lastEvidenceHash !== "string") {
      // Compute hash if not present
      const computed = computeEvidenceHash(lastEvidence);
      if (anchor.finalEvidenceHash !== computed) {
        throw new SessionError(
          `Anchor finalEvidenceHash "${anchor.finalEvidenceHash}" does not match last evidence hash "${computed}"`,
          "SESSION_BOUNDARY_INVALID",
          {
            artifact: "SessionAnchor",
            expected: computed,
            got: anchor.finalEvidenceHash,
          },
        );
      }
    } else {
      if (anchor.finalEvidenceHash !== lastEvidenceHash) {
        throw new SessionError(
          `Anchor finalEvidenceHash "${anchor.finalEvidenceHash}" does not match last evidence hash "${lastEvidenceHash}"`,
          "SESSION_BOUNDARY_INVALID",
          {
            artifact: "SessionAnchor",
            expected: lastEvidenceHash,
            got: anchor.finalEvidenceHash,
          },
        );
      }
    }
  }

  // 4. Validate all evidence items have matching planHash
  for (let i = 0; i < runnerEvidence.length; i++) {
    const evidence = runnerEvidence[i];
    if (!evidence) continue;
    const evidencePlanHash = (evidence as Record<string, unknown>).planHash;
    if (typeof evidencePlanHash === "string") {
      if (evidencePlanHash !== computedPlanHash) {
        throw new SessionError(
          `Runner Evidence ${i} planHash "${evidencePlanHash}" does not match computed plan hash "${computedPlanHash}"`,
          "SESSION_BOUNDARY_INVALID",
          {
            artifact: "RunnerEvidence",
            index: i,
            expected: computedPlanHash,
            got: evidencePlanHash,
          },
        );
      }
    }
  }

  // 5. Phase H: Validate attestation bindings if present
  if (input.attestation) {
    const { attestation, runnerIdentity } = input;
    if (!runnerIdentity) {
      throw new SessionError(
        "Attestation provided but runnerIdentity is missing",
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          reason: "missing_identity",
        },
      );
    }

    // Validate attestation sessionId
    if (attestation.sessionId !== sessionId) {
      throw new SessionError(
        `Attestation sessionId "${attestation.sessionId}" does not match expected "${sessionId}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          expected: sessionId,
          got: attestation.sessionId,
        },
      );
    }

    // Validate attestation planHash
    if (attestation.planHash !== computedPlanHash) {
      throw new SessionError(
        `Attestation planHash "${attestation.planHash}" does not match computed plan hash "${computedPlanHash}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          expected: computedPlanHash,
          got: attestation.planHash,
        },
      );
    }

    // Validate attestation lockId
    if (attestation.lockId !== decisionLock.lockId) {
      throw new SessionError(
        `Attestation lockId "${attestation.lockId}" does not match Decision Lock lockId "${decisionLock.lockId}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          expected: decisionLock.lockId,
          got: attestation.lockId,
        },
      );
    }

    // Validate attestation evidenceChainTailHash
    if (runnerEvidence.length === 0) {
      throw new SessionError(
        "Attestation present but no runner evidence found",
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          reason: "no_evidence",
        },
      );
    }
    const lastEvidence = runnerEvidence[runnerEvidence.length - 1]!;
    const lastEvidenceHash = (lastEvidence as Record<string, unknown>)
      .evidenceHash;
    const expectedTailHash =
      typeof lastEvidenceHash === "string"
        ? lastEvidenceHash
        : computeEvidenceHash(lastEvidence);
    if (attestation.evidenceChainTailHash !== expectedTailHash) {
      throw new SessionError(
        `Attestation evidenceChainTailHash "${attestation.evidenceChainTailHash}" does not match last evidence hash "${expectedTailHash}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          expected: expectedTailHash,
          got: attestation.evidenceChainTailHash,
        },
      );
    }

    // Validate attestation identityHash
    const computedIdentityHash = computeIdentityHash(runnerIdentity);
    if (attestation.identityHash !== computedIdentityHash) {
      throw new SessionError(
        `Attestation identityHash "${attestation.identityHash}" does not match computed identity hash "${computedIdentityHash}"`,
        "SESSION_BOUNDARY_INVALID",
        {
          artifact: "RunnerAttestation",
          expected: computedIdentityHash,
          got: attestation.identityHash,
        },
      );
    }

    // Validate anchor attestation fields if anchor present
    if (anchor) {
      // Compute attestation hash (excluding signature)
      const attestationPayload = {
        sessionId: attestation.sessionId,
        planHash: attestation.planHash,
        lockId: attestation.lockId,
        runnerId: attestation.runnerId,
        identityHash: attestation.identityHash,
        evidenceChainTailHash: attestation.evidenceChainTailHash,
        nonce: attestation.nonce,
        signatureAlgorithm: attestation.signatureAlgorithm,
        createdAt: attestation.createdAt,
      };
      const attestationHash = sha256Hex(canonicalize(attestationPayload));
      if (anchor.finalAttestationHash !== undefined) {
        if (anchor.finalAttestationHash !== attestationHash) {
          throw new SessionError(
            `Anchor finalAttestationHash "${anchor.finalAttestationHash}" does not match computed attestation hash "${attestationHash}"`,
            "SESSION_BOUNDARY_INVALID",
            {
              artifact: "SessionAnchor",
              expected: attestationHash,
              got: anchor.finalAttestationHash,
            },
          );
        }
      }
      if (anchor.runnerIdentityHash !== undefined) {
        if (anchor.runnerIdentityHash !== computedIdentityHash) {
          throw new SessionError(
            `Anchor runnerIdentityHash "${anchor.runnerIdentityHash}" does not match computed identity hash "${computedIdentityHash}"`,
            "SESSION_BOUNDARY_INVALID",
            {
              artifact: "SessionAnchor",
              expected: computedIdentityHash,
              got: anchor.runnerIdentityHash,
            },
          );
        }
      }
    }
  }

  // 6. Phase I: Validate policies if provided
  if (input.policies && input.policies.length > 0) {
    const context: SessionContext = {
      dod,
      decisionLock,
      executionPlan,
      evidenceChain: runnerEvidence,
      runnerIdentity: input.runnerIdentity,
      runnerAttestation: input.attestation,
      anchor,
    };

    try {
      const policyResult = validatePolicies(context, input.policies);

      // Validate policy hashes in anchor if present
      if (anchor) {
        const policySetHash = computePolicySetHash(input.policies);
        const policyEvaluationHash = computePolicyEvaluationHash(policyResult);

        if (anchor.policySetHash !== undefined) {
          if (anchor.policySetHash !== policySetHash) {
            throw new SessionError(
              `Anchor policySetHash "${anchor.policySetHash}" does not match computed "${policySetHash}"`,
              "SESSION_BOUNDARY_INVALID",
              {
                artifact: "SessionAnchor",
                expected: policySetHash,
                got: anchor.policySetHash,
              },
            );
          }
        }

        if (anchor.policyEvaluationHash !== undefined) {
          if (anchor.policyEvaluationHash !== policyEvaluationHash) {
            throw new SessionError(
              `Anchor policyEvaluationHash "${anchor.policyEvaluationHash}" does not match computed "${policyEvaluationHash}"`,
              "SESSION_BOUNDARY_INVALID",
              {
                artifact: "SessionAnchor",
                expected: policyEvaluationHash,
                got: anchor.policyEvaluationHash,
              },
            );
          }
        }
      }
    } catch (error) {
      // Re-throw policy errors
      if (error instanceof SessionError) {
        throw error;
      }
      throw new SessionError(
        `Policy validation error: ${error instanceof Error ? error.message : String(error)}`,
        "POLICY_EVALUATION_FAILED",
        {},
      );
    }
  }
}
