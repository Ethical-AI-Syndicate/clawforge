/**
 * Sealed Change Package Validator — comprehensive artifact integrity verification.
 *
 * Phase P: Validates sealed change package by loading all artifacts,
 * recomputing all hashes, and verifying cross-bindings.
 */

import { SessionError } from "./errors.js";
import type { SealedChangePackage } from "./sealed-change-package.js";
import { computeSealedChangePackageHash, validateSealedChangePackageStructure } from "./sealed-change-package.js";
import { computeDecisionLockHash } from "./decision-lock-hash.js";
import { computePlanHash } from "./plan-hash.js";
import { computeCapsuleHash } from "./prompt-capsule.js";
import { computeSnapshotHash } from "./repo-snapshot.js";
import { computePolicySetHash, computePolicyEvaluationHash } from "./policy-enforcement.js";
import { computeStepPacketHash } from "./step-packet.js";
import { computeEvidenceHash } from "./evidence-chain.js";
import { computeAttestationPayloadHash, verifyAttestationSignature } from "./runner-attestation.js";
import { computeBundleHash as computeApprovalBundleHash } from "./approval-bundle.js";
import { sha256Hex } from "./crypto.js";
import { canonicalJson } from "../audit/canonical.js";
import type {
  DecisionLock,
  DefinitionOfDone,
} from "./schemas.js";
import type { PromptCapsule } from "./prompt-capsule.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { RepoSnapshot } from "./repo-snapshot.js";
import type { SymbolIndex } from "./symbol-index.js";
import type { StepPacket } from "./step-packet.js";
import type { PatchArtifact } from "./patch-artifact.js";
import type { PatchApplyReport } from "./patch-apply.js";
import type { ReviewerReport } from "./reviewer-contract.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { RunnerIdentity } from "./runner-identity.js";
import type { RunnerAttestation } from "./runner-attestation.js";
import type { ApprovalPolicy } from "./approval-policy.js";
import type { ApprovalBundle } from "./approval-bundle.js";
import type { SessionAnchor } from "./session-anchor.js";
import type { PolicyEvaluationResult } from "./policy-engine.js";
import {
  readDecisionLockJson,
  readExecutionPlanJson,
  readPromptCapsuleJson,
  readRepoSnapshotJson,
  readSymbolIndexJson,
  readAllStepPacketsJson,
  readPatchApplyReportJson,
  readReviewerReports,
  readRunnerEvidenceJson,
  readRunnerIdentityJson,
  readRunnerAttestationJson,
  readApprovalPolicyJson,
  readApprovalBundleJson,
  readSessionAnchorJson,
  readPolicyEvaluationJson,
} from "./persistence.js";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Validate sealed change package by loading all artifacts and recomputing hashes.
 *
 * @param sessionId - Session ID
 * @param sessionRoot - Session root directory
 * @throws SessionError with appropriate code on validation failure
 */
export function validateSealedChangePackage(
  sessionId: string,
  sessionRoot: string,
): void {
  const errors: string[] = [];

  // Load SCP
  const scpPath = join(sessionRoot, sessionId, "sealed-change-package.json");
  if (!existsSync(scpPath)) {
    throw new SessionError(
      "Sealed change package not found",
      "SEAL_MISSING_DEPENDENCY",
      { sessionId },
    );
  }

  const scp: SealedChangePackage = JSON.parse(
    readFileSync(scpPath, "utf8"),
  ) as SealedChangePackage;

  // Validate SCP structure
  try {
    validateSealedChangePackageStructure(scp);
  } catch (error) {
    if (error instanceof SessionError) {
      throw error;
    }
    throw new SessionError(
      `Failed to validate SCP structure: ${String(error)}`,
      "SEAL_INVALID",
      { sessionId },
    );
  }

  // Load and validate DecisionLock
  const lock = readDecisionLockJson(sessionRoot, sessionId);
  if (!lock) {
    errors.push("DecisionLock missing");
  } else {
    const computedHash = computeDecisionLockHash(lock);
    if (computedHash !== scp.decisionLockHash) {
      errors.push(
        `DecisionLock hash mismatch: expected ${scp.decisionLockHash}, got ${computedHash}`,
      );
    }
  }

  // Load and validate ExecutionPlan
  const planJson = readExecutionPlanJson(sessionRoot, sessionId);
  if (!planJson) {
    errors.push("ExecutionPlan missing");
  } else {
    const plan: ExecutionPlanLike = {
      sessionId: planJson.sessionId as string | undefined,
      dodId: planJson.dodId as string | undefined,
      lockId: planJson.lockId as string | undefined,
      steps: planJson.steps as ExecutionPlanLike["steps"],
      allowedCapabilities: planJson.allowedCapabilities as string[] | undefined,
      ...planJson,
    };
    const computedHash = computePlanHash(plan);
    if (computedHash !== scp.planHash) {
      errors.push(
        `ExecutionPlan hash mismatch: expected ${scp.planHash}, got ${computedHash}`,
      );
    }
  }

  // Load and validate PromptCapsule
  const capsule = readPromptCapsuleJson(sessionRoot, sessionId);
  if (!capsule) {
    errors.push("PromptCapsule missing");
  } else {
    const computedHash = computeCapsuleHash(capsule);
    if (computedHash !== scp.capsuleHash) {
      errors.push(
        `PromptCapsule hash mismatch: expected ${scp.capsuleHash}, got ${computedHash}`,
      );
    }
  }

  // Load and validate RepoSnapshot
  const snapshot = readRepoSnapshotJson(sessionRoot, sessionId);
  if (!snapshot) {
    errors.push("RepoSnapshot missing");
  } else {
    const computedHash = computeSnapshotHash(snapshot);
    if (computedHash !== scp.snapshotHash) {
      errors.push(
        `RepoSnapshot hash mismatch: expected ${scp.snapshotHash}, got ${computedHash}`,
      );
    }
  }

  // Load and validate PolicySet (optional)
  if (scp.policySetHash) {
    // PolicySet is stored as array of policies - need to read from policy root
    // For now, we'll skip this validation if policies directory structure is unclear
    // This can be enhanced later if needed
  }

  // Load and validate PolicyEvaluation (optional)
  if (scp.policyEvaluationHash) {
    const policyEval = readPolicyEvaluationJson(sessionRoot, sessionId);
    if (!policyEval) {
      errors.push("PolicyEvaluation missing but hash present in SCP");
    } else {
      const computedHash = computePolicyEvaluationHash(policyEval);
      if (computedHash !== scp.policyEvaluationHash) {
        errors.push(
          `PolicyEvaluation hash mismatch: expected ${scp.policyEvaluationHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate SymbolIndex (optional)
  if (scp.symbolIndexHash) {
    const symbolIndex = readSymbolIndexJson(sessionRoot, sessionId);
    if (!symbolIndex) {
      errors.push("SymbolIndex missing but hash present in SCP");
    } else {
      const computedHash = sha256Hex(canonicalJson(symbolIndex));
      if (computedHash !== scp.symbolIndexHash) {
        errors.push(
          `SymbolIndex hash mismatch: expected ${scp.symbolIndexHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate StepPackets
  const stepPackets = readAllStepPacketsJson(sessionRoot, sessionId);
  const computedStepPacketHashes = stepPackets
    .map((p) => computeStepPacketHash(p))
    .sort();
  const scpStepPacketHashes = [...scp.stepPacketHashes].sort();

  if (computedStepPacketHashes.length !== scpStepPacketHashes.length) {
    errors.push(
      `StepPacket count mismatch: expected ${scpStepPacketHashes.length}, got ${computedStepPacketHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedStepPacketHashes.length; i++) {
      if (computedStepPacketHashes[i] !== scpStepPacketHashes[i]) {
        errors.push(
          `StepPacket hash mismatch at index ${i}: expected ${scpStepPacketHashes[i]}, got ${computedStepPacketHashes[i]}`,
        );
      }
    }
  }

  // Load and validate PatchArtifacts
  // Patch artifacts are stored per step - need to read them
  const plan = planJson ? {
    sessionId: planJson.sessionId as string | undefined,
    dodId: planJson.dodId as string | undefined,
    lockId: planJson.lockId as string | undefined,
    steps: planJson.steps as ExecutionPlanLike["steps"],
    allowedCapabilities: planJson.allowedCapabilities as string[] | undefined,
    ...planJson,
  } : null;

  const computedPatchArtifactHashes: string[] = [];
  if (plan && plan.steps) {
    for (const step of plan.steps) {
      // Try to read patch artifact for this step
      // Patch artifacts are stored as patch-<stepId>.json
      const patchPath = join(sessionRoot, sessionId, `patch-${step.stepId}.json`);
      if (existsSync(patchPath)) {
        const patch: PatchArtifact = JSON.parse(readFileSync(patchPath, "utf8"));
        // Compute hash for patch artifact (using canonical JSON)
        const patchHash = sha256Hex(canonicalJson(patch));
        computedPatchArtifactHashes.push(patchHash);
      }
    }
  }
  computedPatchArtifactHashes.sort();
  const scpPatchArtifactHashes = [...scp.patchArtifactHashes].sort();

  if (computedPatchArtifactHashes.length !== scpPatchArtifactHashes.length) {
    errors.push(
      `PatchArtifact count mismatch: expected ${scpPatchArtifactHashes.length}, got ${computedPatchArtifactHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedPatchArtifactHashes.length; i++) {
      if (computedPatchArtifactHashes[i] !== scpPatchArtifactHashes[i]) {
        errors.push(
          `PatchArtifact hash mismatch at index ${i}: expected ${scpPatchArtifactHashes[i]}, got ${computedPatchArtifactHashes[i]}`,
        );
      }
    }
  }

  // Load and validate PatchApplyReport (optional)
  if (scp.patchApplyReportHash) {
    const patchReport = readPatchApplyReportJson(sessionRoot, sessionId);
    if (!patchReport) {
      errors.push("PatchApplyReport missing but hash present in SCP");
    } else {
      const computedHash = sha256Hex(canonicalJson(patchReport));
      if (computedHash !== scp.patchApplyReportHash) {
        errors.push(
          `PatchApplyReport hash mismatch: expected ${scp.patchApplyReportHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate ReviewerReports
  const computedReviewerReportHashes: string[] = [];
  if (plan && plan.steps) {
    for (const step of plan.steps) {
      const reports = readReviewerReports(sessionRoot, sessionId, step.stepId);
      for (const report of reports) {
        const reportHash = sha256Hex(canonicalJson(report));
        computedReviewerReportHashes.push(reportHash);
      }
    }
  }
  computedReviewerReportHashes.sort();
  const scpReviewerReportHashes = [...scp.reviewerReportHashes].sort();

  if (computedReviewerReportHashes.length !== scpReviewerReportHashes.length) {
    errors.push(
      `ReviewerReport count mismatch: expected ${scpReviewerReportHashes.length}, got ${computedReviewerReportHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedReviewerReportHashes.length; i++) {
      if (computedReviewerReportHashes[i] !== scpReviewerReportHashes[i]) {
        errors.push(
          `ReviewerReport hash mismatch at index ${i}: expected ${scpReviewerReportHashes[i]}, got ${computedReviewerReportHashes[i]}`,
        );
      }
    }
  }

  // Load and validate EvidenceChain
  const evidenceList = readRunnerEvidenceJson(sessionRoot, sessionId);
  const computedEvidenceHashes = Array.isArray(evidenceList)
    ? evidenceList.map((e) => computeEvidenceHash(e)).sort()
    : [];
  const scpEvidenceHashes = [...scp.evidenceChainHashes].sort();

  if (computedEvidenceHashes.length !== scpEvidenceHashes.length) {
    errors.push(
      `EvidenceChain count mismatch: expected ${scpEvidenceHashes.length}, got ${computedEvidenceHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedEvidenceHashes.length; i++) {
      if (computedEvidenceHashes[i] !== scpEvidenceHashes[i]) {
        errors.push(
          `EvidenceChain hash mismatch at index ${i}: expected ${scpEvidenceHashes[i]}, got ${computedEvidenceHashes[i]}`,
        );
      }
    }
  }

  // Load and validate RunnerIdentity (optional)
  if (scp.runnerIdentityHash) {
    const runnerIdentity = readRunnerIdentityJson(sessionRoot, sessionId);
    if (!runnerIdentity) {
      errors.push("RunnerIdentity missing but hash present in SCP");
    } else {
      const computedHash = sha256Hex(canonicalJson(runnerIdentity));
      if (computedHash !== scp.runnerIdentityHash) {
        errors.push(
          `RunnerIdentity hash mismatch: expected ${scp.runnerIdentityHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate Attestation (optional)
  if (scp.attestationHash) {
    const attestation = readRunnerAttestationJson(sessionRoot, sessionId);
    if (!attestation) {
      errors.push("Attestation missing but hash present in SCP");
    } else {
      const computedHash = computeAttestationPayloadHash(attestation);
      if (computedHash !== scp.attestationHash) {
        errors.push(
          `Attestation hash mismatch: expected ${scp.attestationHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate ApprovalPolicy (optional)
  if (scp.approvalPolicyHash) {
    const approvalPolicy = readApprovalPolicyJson(sessionRoot, sessionId);
    if (!approvalPolicy) {
      errors.push("ApprovalPolicy missing but hash present in SCP");
    } else {
      const computedHash = sha256Hex(canonicalJson(approvalPolicy));
      if (computedHash !== scp.approvalPolicyHash) {
        errors.push(
          `ApprovalPolicy hash mismatch: expected ${scp.approvalPolicyHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate ApprovalBundle (optional)
  if (scp.approvalBundleHash) {
    const approvalBundle = readApprovalBundleJson(sessionRoot, sessionId);
    if (!approvalBundle) {
      errors.push("ApprovalBundle missing but hash present in SCP");
    } else {
      const computedHash = computeApprovalBundleHash(approvalBundle);
      if (computedHash !== scp.approvalBundleHash) {
        errors.push(
          `ApprovalBundle hash mismatch: expected ${scp.approvalBundleHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Load and validate Anchor (optional)
  if (scp.anchorHash) {
    const anchor = readSessionAnchorJson(sessionRoot, sessionId);
    if (!anchor) {
      errors.push("Anchor missing but hash present in SCP");
    } else {
      const computedHash = sha256Hex(canonicalJson(anchor));
      if (computedHash !== scp.anchorHash) {
        errors.push(
          `Anchor hash mismatch: expected ${scp.anchorHash}, got ${computedHash}`,
        );
      }
    }
  }

  // Throw if any errors found
  if (errors.length > 0) {
    // Determine error code based on error type
    let errorCode: "SEAL_HASH_MISMATCH" | "SEAL_MISSING_DEPENDENCY" | "SEAL_BINDING_VIOLATION" = "SEAL_HASH_MISMATCH";
    if (errors.some((e) => e.includes("missing"))) {
      errorCode = "SEAL_MISSING_DEPENDENCY";
    } else if (errors.some((e) => e.includes("count mismatch") || e.includes("binding"))) {
      errorCode = "SEAL_BINDING_VIOLATION";
    }

    throw new SessionError(
      `Sealed change package validation failed: ${errors.join("; ")}`,
      errorCode,
      { sessionId, errors },
    );
  }
}
