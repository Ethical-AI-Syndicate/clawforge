/**
 * Independent Verification Module — standalone SCP validation.
 *
 * Phase Q: Pure read-only verification without session management dependencies.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "../session/crypto.js";
import { SealedChangePackageSchema } from "../session/sealed-change-package.js";
import type { SealedChangePackage } from "../session/sealed-change-package.js";
import { computeSealedChangePackageHash } from "../session/sealed-change-package.js";
import { computeDecisionLockHash } from "../session/decision-lock-hash.js";
import { computePlanHash } from "../session/plan-hash.js";
import { computeCapsuleHash } from "../session/prompt-capsule.js";
import { computeSnapshotHash } from "../session/repo-snapshot.js";
import { computeStepPacketHash } from "../session/step-packet.js";
import { computeEvidenceHash, validateEvidenceChain } from "../session/evidence-chain.js";
import { computeAttestationPayloadHash, verifyAttestationSignature } from "../session/runner-attestation.js";
import { computeBundleHash as computeApprovalBundleHash, verifySignature } from "../session/approval-bundle.js";
import { computePolicyEvaluationHash } from "../session/policy-enforcement.js";
import type {
  DecisionLock,
} from "../session/schemas.js";
import type { ExecutionPlanLike } from "../session/evidence-validation.js";
import type { PromptCapsule } from "../session/prompt-capsule.js";
import type { RepoSnapshot } from "../session/repo-snapshot.js";
import type { StepPacket } from "../session/step-packet.js";
import type { PatchArtifact } from "../session/patch-artifact.js";
import type { PatchApplyReport } from "../session/patch-apply.js";
import type { ReviewerReport } from "../session/reviewer-contract.js";
import type { RunnerEvidence } from "../session/runner-contract.js";
import type { RunnerIdentity } from "../session/runner-identity.js";
import type { RunnerAttestation } from "../session/runner-attestation.js";
import type { ApprovalPolicy } from "../session/approval-policy.js";
import type { ApprovalBundle } from "../session/approval-bundle.js";
import type { SessionAnchor } from "../session/session-anchor.js";
import type { PolicyValidationResult } from "../session/policy-enforcement.js";
import {
  createVerificationReport,
  finalizeVerificationReport,
  type VerificationReport,
} from "./verification-report.js";

/**
 * Verify sealed change package from session directory.
 *
 * @param sessionDir - Path to session directory containing sealed-change-package.json
 * @returns Verification report
 */
export function verifySealedChangePackage(
  sessionDir: string,
): VerificationReport {
  const report = createVerificationReport("");

  // Load SCP
  const scpPath = join(sessionDir, "sealed-change-package.json");
  if (!existsSync(scpPath)) {
    report.errors.push("Sealed change package not found");
    report.passed = false;
    report.checks.scpStructure.passed = false;
    report.checks.scpStructure.error = "File not found";
    return finalizeVerificationReport(report);
  }

  let scp: SealedChangePackage;
  try {
    const scpContent = readFileSync(scpPath, "utf8");
    scp = JSON.parse(scpContent) as SealedChangePackage;
    report.sessionId = scp.sessionId;
  } catch (error) {
    report.errors.push(`Failed to parse sealed-change-package.json: ${String(error)}`);
    report.passed = false;
    report.checks.scpStructure.passed = false;
    report.checks.scpStructure.error = `Parse error: ${String(error)}`;
    return finalizeVerificationReport(report);
  }

  // Validate SCP structure
  const structureResult = SealedChangePackageSchema.safeParse(scp);
  if (!structureResult.success) {
    const errorMessages = structureResult.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    report.errors.push(`Invalid SCP structure: ${errorMessages}`);
    report.passed = false;
    report.checks.scpStructure.passed = false;
    report.checks.scpStructure.error = errorMessages;
  } else {
    report.checks.scpStructure.passed = true;
  }

  // Verify packageHash
  try {
    const computedHash = computeSealedChangePackageHash(scp);
    if (computedHash !== scp.packageHash) {
      report.errors.push(
        `Package hash mismatch: expected ${computedHash}, got ${scp.packageHash}`,
      );
      report.passed = false;
      report.checks.scpHash.passed = false;
      report.checks.scpHash.error = `Expected ${computedHash}, got ${scp.packageHash}`;
    } else {
      report.checks.scpHash.passed = true;
    }
  } catch (error) {
    report.errors.push(`Failed to compute package hash: ${String(error)}`);
    report.passed = false;
    report.checks.scpHash.passed = false;
    report.checks.scpHash.error = String(error);
  }

  // Load and verify DecisionLock
  const lockPath = join(sessionDir, "decision-lock.json");
  if (!existsSync(lockPath)) {
    report.errors.push("DecisionLock missing");
    report.passed = false;
    report.checks.decisionLock.passed = false;
    report.checks.decisionLock.error = "File not found";
  } else {
    try {
      const lock: DecisionLock = JSON.parse(readFileSync(lockPath, "utf8"));
      const computedHash = computeDecisionLockHash(lock);
      if (computedHash !== scp.decisionLockHash) {
        report.errors.push(
          `DecisionLock hash mismatch: expected ${scp.decisionLockHash}, got ${computedHash}`,
        );
        report.passed = false;
        report.checks.decisionLock.passed = false;
        report.checks.decisionLock.hash = computedHash;
        report.checks.decisionLock.error = `Expected ${scp.decisionLockHash}, got ${computedHash}`;
      } else {
        report.checks.decisionLock.passed = true;
        report.checks.decisionLock.hash = computedHash;
      }
    } catch (error) {
      report.errors.push(`Failed to verify DecisionLock: ${String(error)}`);
      report.passed = false;
      report.checks.decisionLock.passed = false;
      report.checks.decisionLock.error = String(error);
    }
  }

  // Load and verify ExecutionPlan
  const planPath = join(sessionDir, "execution-plan.json");
  if (!existsSync(planPath)) {
    report.errors.push("ExecutionPlan missing");
    report.passed = false;
    report.checks.executionPlan.passed = false;
    report.checks.executionPlan.error = "File not found";
  } else {
    try {
      const planJson = JSON.parse(readFileSync(planPath, "utf8"));
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
        report.errors.push(
          `ExecutionPlan hash mismatch: expected ${scp.planHash}, got ${computedHash}`,
        );
        report.passed = false;
        report.checks.executionPlan.passed = false;
        report.checks.executionPlan.hash = computedHash;
        report.checks.executionPlan.error = `Expected ${scp.planHash}, got ${computedHash}`;
      } else {
        report.checks.executionPlan.passed = true;
        report.checks.executionPlan.hash = computedHash;
      }
    } catch (error) {
      report.errors.push(`Failed to verify ExecutionPlan: ${String(error)}`);
      report.passed = false;
      report.checks.executionPlan.passed = false;
      report.checks.executionPlan.error = String(error);
    }
  }

  // Load and verify PromptCapsule
  const capsulePath = join(sessionDir, "prompt-capsule.json");
  if (!existsSync(capsulePath)) {
    report.errors.push("PromptCapsule missing");
    report.passed = false;
    report.checks.promptCapsule.passed = false;
    report.checks.promptCapsule.error = "File not found";
  } else {
    try {
      const capsule: PromptCapsule = JSON.parse(readFileSync(capsulePath, "utf8"));
      const computedHash = computeCapsuleHash(capsule);
      if (computedHash !== scp.capsuleHash) {
        report.errors.push(
          `PromptCapsule hash mismatch: expected ${scp.capsuleHash}, got ${computedHash}`,
        );
        report.passed = false;
        report.checks.promptCapsule.passed = false;
        report.checks.promptCapsule.hash = computedHash;
        report.checks.promptCapsule.error = `Expected ${scp.capsuleHash}, got ${computedHash}`;
      } else {
        report.checks.promptCapsule.passed = true;
        report.checks.promptCapsule.hash = computedHash;
      }
    } catch (error) {
      report.errors.push(`Failed to verify PromptCapsule: ${String(error)}`);
      report.passed = false;
      report.checks.promptCapsule.passed = false;
      report.checks.promptCapsule.error = String(error);
    }
  }

  // Load and verify RepoSnapshot
  const snapshotPath = join(sessionDir, "repo-snapshot.json");
  if (!existsSync(snapshotPath)) {
    report.errors.push("RepoSnapshot missing");
    report.passed = false;
    report.checks.repoSnapshot.passed = false;
    report.checks.repoSnapshot.error = "File not found";
  } else {
    try {
      const snapshot: RepoSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
      const computedHash = computeSnapshotHash(snapshot);
      if (computedHash !== scp.snapshotHash) {
        report.errors.push(
          `RepoSnapshot hash mismatch: expected ${scp.snapshotHash}, got ${computedHash}`,
        );
        report.passed = false;
        report.checks.repoSnapshot.passed = false;
        report.checks.repoSnapshot.hash = computedHash;
        report.checks.repoSnapshot.error = `Expected ${scp.snapshotHash}, got ${computedHash}`;
      } else {
        report.checks.repoSnapshot.passed = true;
        report.checks.repoSnapshot.hash = computedHash;
      }
    } catch (error) {
      report.errors.push(`Failed to verify RepoSnapshot: ${String(error)}`);
      report.passed = false;
      report.checks.repoSnapshot.passed = false;
      report.checks.repoSnapshot.error = String(error);
    }
  }

  // Load and verify StepPackets
  const packetsDir = join(sessionDir, "packets");
  const stepPacketErrors: string[] = [];
  const computedStepPacketHashes: string[] = [];

  if (existsSync(packetsDir)) {
    try {
      const files = readdirSync(packetsDir).filter((f) =>
        f.startsWith("step-") && f.endsWith(".json"),
      );
      for (const file of files) {
        try {
          const packet: StepPacket = JSON.parse(
            readFileSync(join(packetsDir, file), "utf8"),
          );
          const hash = computeStepPacketHash(packet);
          computedStepPacketHashes.push(hash);
        } catch (error) {
          stepPacketErrors.push(`Failed to process ${file}: ${String(error)}`);
        }
      }
    } catch (error) {
      stepPacketErrors.push(`Failed to read packets directory: ${String(error)}`);
    }
  }

  computedStepPacketHashes.sort();
  const scpStepPacketHashes = [...scp.stepPacketHashes].sort();

  if (computedStepPacketHashes.length !== scpStepPacketHashes.length) {
    stepPacketErrors.push(
      `Count mismatch: expected ${scpStepPacketHashes.length}, got ${computedStepPacketHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedStepPacketHashes.length; i++) {
      if (computedStepPacketHashes[i] !== scpStepPacketHashes[i]) {
        stepPacketErrors.push(
          `Hash mismatch at index ${i}: expected ${scpStepPacketHashes[i]}, got ${computedStepPacketHashes[i]}`,
        );
      }
    }
  }

  report.checks.stepPackets = {
    passed: stepPacketErrors.length === 0,
    count: computedStepPacketHashes.length,
    errors: stepPacketErrors,
  };
  if (stepPacketErrors.length > 0) {
    report.passed = false;
    report.errors.push(...stepPacketErrors.map((e) => `StepPacket: ${e}`));
  }

  // Load and verify PatchArtifacts
  const patchArtifactErrors: string[] = [];
  const computedPatchArtifactHashes: string[] = [];

  // Try to load plan for step IDs
  let plan: ExecutionPlanLike | null = null;
  if (existsSync(planPath)) {
    try {
      const planJson = JSON.parse(readFileSync(planPath, "utf8"));
      plan = {
        sessionId: planJson.sessionId as string | undefined,
        dodId: planJson.dodId as string | undefined,
        lockId: planJson.lockId as string | undefined,
        steps: planJson.steps as ExecutionPlanLike["steps"],
        allowedCapabilities: planJson.allowedCapabilities as string[] | undefined,
        ...planJson,
      };
    } catch {
      // Ignore, will try alternative patterns
    }
  }

  // Try patch-step-*.json pattern first
  if (plan && plan.steps) {
    for (const step of plan.steps) {
      const patchPath = join(sessionDir, `patch-step-${step.stepId}.json`);
      if (existsSync(patchPath)) {
        try {
          const patch: PatchArtifact = JSON.parse(readFileSync(patchPath, "utf8"));
          const patchHash = sha256Hex(canonicalJson(patch));
          computedPatchArtifactHashes.push(patchHash);
        } catch (error) {
          patchArtifactErrors.push(
            `Failed to process patch-step-${step.stepId}.json: ${String(error)}`,
          );
        }
      }
    }
  }

  // Also try patch-*.json pattern (including patch-step-*.json if plan loading failed)
  try {
    const files = readdirSync(sessionDir).filter(
      (f) => f.startsWith("patch-") && f.endsWith(".json"),
    );
    for (const file of files) {
      // Skip if already processed via plan steps
      if (file.startsWith("patch-step-") && plan && plan.steps) {
        const stepId = file.replace(/^patch-step-/, "").replace(/\.json$/, "");
        if (plan.steps.some((s) => s.stepId === stepId)) {
          continue;
        }
      }
      try {
        const patch: PatchArtifact = JSON.parse(
          readFileSync(join(sessionDir, file), "utf8"),
        );
        const patchHash = sha256Hex(canonicalJson(patch));
        if (!computedPatchArtifactHashes.includes(patchHash)) {
          computedPatchArtifactHashes.push(patchHash);
        }
      } catch (error) {
        patchArtifactErrors.push(`Failed to process ${file}: ${String(error)}`);
      }
    }
  } catch {
    // Ignore if directory read fails
  }

  computedPatchArtifactHashes.sort();
  const scpPatchArtifactHashes = [...scp.patchArtifactHashes].sort();

  if (computedPatchArtifactHashes.length !== scpPatchArtifactHashes.length) {
    patchArtifactErrors.push(
      `Count mismatch: expected ${scpPatchArtifactHashes.length}, got ${computedPatchArtifactHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedPatchArtifactHashes.length; i++) {
      if (computedPatchArtifactHashes[i] !== scpPatchArtifactHashes[i]) {
        patchArtifactErrors.push(
          `Hash mismatch at index ${i}: expected ${scpPatchArtifactHashes[i]}, got ${computedPatchArtifactHashes[i]}`,
        );
      }
    }
  }

  report.checks.patchArtifacts = {
    passed: patchArtifactErrors.length === 0,
    count: computedPatchArtifactHashes.length,
    errors: patchArtifactErrors,
  };
  if (patchArtifactErrors.length > 0) {
    report.passed = false;
    report.errors.push(...patchArtifactErrors.map((e) => `PatchArtifact: ${e}`));
  }

  // Load and verify ReviewerReports
  const reviewerReportErrors: string[] = [];
  const computedReviewerReportHashes: string[] = [];

  if (plan && plan.steps) {
    for (const step of plan.steps) {
      const prefix = `reviewer-${step.stepId}-`;
      try {
        const files = readdirSync(sessionDir).filter(
          (f) => f.startsWith(prefix) && f.endsWith(".json"),
        );
        for (const file of files) {
          try {
            const report: ReviewerReport = JSON.parse(
              readFileSync(join(sessionDir, file), "utf8"),
            );
            const reportHash = sha256Hex(canonicalJson(report));
            computedReviewerReportHashes.push(reportHash);
          } catch (error) {
            reviewerReportErrors.push(`Failed to process ${file}: ${String(error)}`);
          }
        }
      } catch {
        // Ignore if directory read fails
      }
    }
  }

  computedReviewerReportHashes.sort();
  const scpReviewerReportHashes = [...scp.reviewerReportHashes].sort();

  if (computedReviewerReportHashes.length !== scpReviewerReportHashes.length) {
    reviewerReportErrors.push(
      `Count mismatch: expected ${scpReviewerReportHashes.length}, got ${computedReviewerReportHashes.length}`,
    );
  } else {
    for (let i = 0; i < computedReviewerReportHashes.length; i++) {
      if (computedReviewerReportHashes[i] !== scpReviewerReportHashes[i]) {
        reviewerReportErrors.push(
          `Hash mismatch at index ${i}: expected ${scpReviewerReportHashes[i]}, got ${computedReviewerReportHashes[i]}`,
        );
      }
    }
  }

  report.checks.reviewerReports = {
    passed: reviewerReportErrors.length === 0,
    count: computedReviewerReportHashes.length,
    errors: reviewerReportErrors,
  };
  if (reviewerReportErrors.length > 0) {
    report.passed = false;
    report.errors.push(...reviewerReportErrors.map((e) => `ReviewerReport: ${e}`));
  }

  // Load and verify EvidenceChain
  const evidencePath = join(sessionDir, "runner-evidence.json");
  const evidenceChainErrors: string[] = [];
  let evidenceList: RunnerEvidence[] = [];

  if (!existsSync(evidencePath)) {
    if (scp.evidenceChainHashes.length > 0) {
      evidenceChainErrors.push("Evidence file missing but hashes present in SCP");
    }
  } else {
    try {
      evidenceList = JSON.parse(readFileSync(evidencePath, "utf8")) as RunnerEvidence[];
      if (!Array.isArray(evidenceList)) {
        evidenceChainErrors.push("Evidence file does not contain an array");
      } else {
        const computedEvidenceHashes = evidenceList
          .map((e) => computeEvidenceHash(e))
          .sort();
        const scpEvidenceHashes = [...scp.evidenceChainHashes].sort();

        if (computedEvidenceHashes.length !== scpEvidenceHashes.length) {
          evidenceChainErrors.push(
            `Count mismatch: expected ${scpEvidenceHashes.length}, got ${computedEvidenceHashes.length}`,
          );
        } else {
          for (let i = 0; i < computedEvidenceHashes.length; i++) {
            if (computedEvidenceHashes[i] !== scpEvidenceHashes[i]) {
              evidenceChainErrors.push(
                `Hash mismatch at index ${i}: expected ${scpEvidenceHashes[i]}, got ${computedEvidenceHashes[i]}`,
              );
            }
          }
        }

        // Validate evidence chain linking
        if (plan && evidenceList.length > 0) {
          try {
            validateEvidenceChain(evidenceList, plan);
          } catch (error) {
            evidenceChainErrors.push(`Evidence chain validation failed: ${String(error)}`);
          }
        }
      }
    } catch (error) {
      evidenceChainErrors.push(`Failed to verify evidence chain: ${String(error)}`);
    }
  }

  report.checks.evidenceChain = {
    passed: evidenceChainErrors.length === 0,
    count: evidenceList.length,
    errors: evidenceChainErrors,
  };
  if (evidenceChainErrors.length > 0) {
    report.passed = false;
    report.errors.push(...evidenceChainErrors.map((e) => `EvidenceChain: ${e}`));
  }

  // Load and verify optional artifacts
  if (scp.policyEvaluationHash) {
    const policyEvalPath = join(sessionDir, "policy-evaluation.json");
    if (!existsSync(policyEvalPath)) {
      report.errors.push("PolicyEvaluation missing but hash present in SCP");
      report.passed = false;
      report.checks.policyEvaluation = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const policyEval: PolicyValidationResult = JSON.parse(
          readFileSync(policyEvalPath, "utf8"),
        );
        const computedHash = computePolicyEvaluationHash(policyEval);
        if (computedHash !== scp.policyEvaluationHash) {
          report.errors.push(
            `PolicyEvaluation hash mismatch: expected ${scp.policyEvaluationHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.policyEvaluation = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.policyEvaluationHash}, got ${computedHash}`,
          };
        } else {
          report.checks.policyEvaluation = {
            passed: true,
            hash: computedHash,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify PolicyEvaluation: ${String(error)}`);
        report.passed = false;
        report.checks.policyEvaluation = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.symbolIndexHash) {
    const symbolIndexPath = join(sessionDir, "symbol-index.json");
    if (!existsSync(symbolIndexPath)) {
      report.errors.push("SymbolIndex missing but hash present in SCP");
      report.passed = false;
      report.checks.symbolIndex = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const symbolIndex = JSON.parse(readFileSync(symbolIndexPath, "utf8"));
        const computedHash = sha256Hex(canonicalJson(symbolIndex));
        if (computedHash !== scp.symbolIndexHash) {
          report.errors.push(
            `SymbolIndex hash mismatch: expected ${scp.symbolIndexHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.symbolIndex = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.symbolIndexHash}, got ${computedHash}`,
          };
        } else {
          report.checks.symbolIndex = {
            passed: true,
            hash: computedHash,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify SymbolIndex: ${String(error)}`);
        report.passed = false;
        report.checks.symbolIndex = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.patchApplyReportHash) {
    const patchReportPath = join(sessionDir, "patch-apply-report.json");
    if (!existsSync(patchReportPath)) {
      report.errors.push("PatchApplyReport missing but hash present in SCP");
      report.passed = false;
      report.checks.patchApplyReport = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const patchReport: PatchApplyReport = JSON.parse(
          readFileSync(patchReportPath, "utf8"),
        );
        const computedHash = patchReport.reportHash;
        if (computedHash !== scp.patchApplyReportHash) {
          report.errors.push(
            `PatchApplyReport hash mismatch: expected ${scp.patchApplyReportHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.patchApplyReport = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.patchApplyReportHash}, got ${computedHash}`,
          };
        } else {
          report.checks.patchApplyReport = {
            passed: true,
            hash: computedHash,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify PatchApplyReport: ${String(error)}`);
        report.passed = false;
        report.checks.patchApplyReport = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.runnerIdentityHash) {
    const runnerIdentityPath = join(sessionDir, "runner-identity.json");
    if (!existsSync(runnerIdentityPath)) {
      report.errors.push("RunnerIdentity missing but hash present in SCP");
      report.passed = false;
      report.checks.runnerIdentity = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const runnerIdentity: RunnerIdentity = JSON.parse(
          readFileSync(runnerIdentityPath, "utf8"),
        );
        const computedHash = sha256Hex(canonicalJson(runnerIdentity));
        if (computedHash !== scp.runnerIdentityHash) {
          report.errors.push(
            `RunnerIdentity hash mismatch: expected ${scp.runnerIdentityHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.runnerIdentity = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.runnerIdentityHash}, got ${computedHash}`,
          };
        } else {
          report.checks.runnerIdentity = {
            passed: true,
            hash: computedHash,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify RunnerIdentity: ${String(error)}`);
        report.passed = false;
        report.checks.runnerIdentity = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.attestationHash) {
    const attestationPath = join(sessionDir, "runner-attestation.json");
    if (!existsSync(attestationPath)) {
      report.errors.push("Attestation missing but hash present in SCP");
      report.passed = false;
      report.checks.attestation = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const attestation: RunnerAttestation = JSON.parse(
          readFileSync(attestationPath, "utf8"),
        );
        const computedHash = computeAttestationPayloadHash(attestation);
        if (computedHash !== scp.attestationHash) {
          report.errors.push(
            `Attestation hash mismatch: expected ${scp.attestationHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.attestation = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.attestationHash}, got ${computedHash}`,
          };
        } else {
          // Verify signature if runner identity is available
          let signatureValid: boolean | undefined;
          if (scp.runnerIdentityHash && report.checks.runnerIdentity?.passed) {
            try {
              const runnerIdentityPath = join(sessionDir, "runner-identity.json");
              const runnerIdentity: RunnerIdentity = JSON.parse(
                readFileSync(runnerIdentityPath, "utf8"),
              );
              verifyAttestationSignature(attestation, runnerIdentity);
              signatureValid = true;
            } catch (error) {
              signatureValid = false;
              report.errors.push(`Attestation signature invalid: ${String(error)}`);
              report.passed = false;
            }
          }

          report.checks.attestation = {
            passed: true,
            hash: computedHash,
            signatureValid,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify Attestation: ${String(error)}`);
        report.passed = false;
        report.checks.attestation = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.approvalPolicyHash) {
    const approvalPolicyPath = join(sessionDir, "approval-policy.json");
    if (!existsSync(approvalPolicyPath)) {
      report.errors.push("ApprovalPolicy missing but hash present in SCP");
      report.passed = false;
      report.checks.approvalPolicy = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const approvalPolicy: ApprovalPolicy = JSON.parse(
          readFileSync(approvalPolicyPath, "utf8"),
        );
        const computedHash = sha256Hex(canonicalJson(approvalPolicy));
        if (computedHash !== scp.approvalPolicyHash) {
          report.errors.push(
            `ApprovalPolicy hash mismatch: expected ${scp.approvalPolicyHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.approvalPolicy = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.approvalPolicyHash}, got ${computedHash}`,
          };
        } else {
          report.checks.approvalPolicy = {
            passed: true,
            hash: computedHash,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify ApprovalPolicy: ${String(error)}`);
        report.passed = false;
        report.checks.approvalPolicy = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.approvalBundleHash) {
    const approvalBundlePath = join(sessionDir, "approval-bundle.json");
    if (!existsSync(approvalBundlePath)) {
      report.errors.push("ApprovalBundle missing but hash present in SCP");
      report.passed = false;
      report.checks.approvalBundle = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const approvalBundle: ApprovalBundle = JSON.parse(
          readFileSync(approvalBundlePath, "utf8"),
        );
        const computedHash = computeApprovalBundleHash(approvalBundle);
        if (computedHash !== scp.approvalBundleHash) {
          report.errors.push(
            `ApprovalBundle hash mismatch: expected ${scp.approvalBundleHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.approvalBundle = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.approvalBundleHash}, got ${computedHash}`,
          };
        } else {
          // Verify signatures if approval policy is available
          let signaturesValid: boolean | undefined;
          if (scp.approvalPolicyHash && report.checks.approvalPolicy?.passed) {
            try {
              const approvalPolicyPath = join(sessionDir, "approval-policy.json");
              const approvalPolicy: ApprovalPolicy = JSON.parse(
                readFileSync(approvalPolicyPath, "utf8"),
              );

              // Verify each signature
              let allValid = true;
              for (const signature of approvalBundle.signatures) {
                const approver = approvalPolicy.approvers.find(
                  (a) => a.approverId === signature.approverId && a.active,
                );
                if (!approver) {
                  allValid = false;
                  report.errors.push(
                    `Approval signature from unknown approver: ${signature.approverId}`,
                  );
                  continue;
                }

                try {
                  verifySignature(signature, approver.publicKeyPem);
                } catch (error) {
                  allValid = false;
                  report.errors.push(
                    `Approval signature invalid for ${signature.approverId}: ${String(error)}`,
                  );
                }
              }

              signaturesValid = allValid;
              if (!allValid) {
                report.passed = false;
              }
            } catch (error) {
              signaturesValid = false;
              report.errors.push(`Failed to verify approval signatures: ${String(error)}`);
              report.passed = false;
            }
          }

          report.checks.approvalBundle = {
            passed: true,
            hash: computedHash,
            signaturesValid,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify ApprovalBundle: ${String(error)}`);
        report.passed = false;
        report.checks.approvalBundle = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  if (scp.anchorHash) {
    const anchorPath = join(sessionDir, "session-anchor.json");
    if (!existsSync(anchorPath)) {
      report.errors.push("Anchor missing but hash present in SCP");
      report.passed = false;
      report.checks.anchor = {
        passed: false,
        hash: "",
        error: "File not found",
      };
    } else {
      try {
        const anchor: SessionAnchor = JSON.parse(readFileSync(anchorPath, "utf8"));
        const computedHash = sha256Hex(canonicalJson(anchor));
        if (computedHash !== scp.anchorHash) {
          report.errors.push(
            `Anchor hash mismatch: expected ${scp.anchorHash}, got ${computedHash}`,
          );
          report.passed = false;
          report.checks.anchor = {
            passed: false,
            hash: computedHash,
            error: `Expected ${scp.anchorHash}, got ${computedHash}`,
          };
        } else {
          report.checks.anchor = {
            passed: true,
            hash: computedHash,
          };
        }
      } catch (error) {
        report.errors.push(`Failed to verify Anchor: ${String(error)}`);
        report.passed = false;
        report.checks.anchor = {
          passed: false,
          hash: "",
          error: String(error),
        };
      }
    }
  }

  return finalizeVerificationReport(report);
}
