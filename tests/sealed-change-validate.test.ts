/**
 * Sealed Change Package Validator Tests — Phase P
 *
 * Tests for comprehensive artifact integrity verification and tamper detection.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionError } from "../src/session/errors.js";
import { validateSealedChangePackage } from "../src/session/sealed-change-validate.js";
import { SealedChangePackageSchema } from "../src/session/sealed-change-package.js";
import { computeSealedChangePackageHash } from "../src/session/sealed-change-package.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import {
  writeSessionJson,
  writeDoDJson,
  writeDecisionLockJson,
  writeExecutionPlanJson,
  writePromptCapsuleJson,
  writeRepoSnapshotJson,
  writeGateResultJson,
  writeApprovalPolicyJson,
  writeApprovalBundleJson,
  writeSealedChangePackageJson,
  writeStepPacketJson,
  writeRunnerEvidenceJson,
  writeReviewerReportJson,
  writePatchApplyReportJson,
  writeSessionAnchorJson,
  writeRunnerIdentityJson,
  writeRunnerAttestationJson,
  writeSymbolIndexJson,
  writePolicyEvaluationJson,
  readDecisionLockJson,
  readExecutionPlanJson,
  readPromptCapsuleJson,
  readRepoSnapshotJson,
  readAllStepPacketsJson,
  readReviewerReports,
  readRunnerEvidenceJson,
} from "../src/session/persistence.js";
import { canonicalJson } from "../src/audit/canonical.js";
import { sha256Hex } from "../src/session/crypto.js";
import { computeDecisionLockHash } from "../src/session/decision-lock-hash.js";
import { computePlanHash } from "../src/session/plan-hash.js";
import { computeCapsuleHash } from "../src/session/prompt-capsule.js";
import { computeSnapshotHash } from "../src/session/repo-snapshot.js";
import { computeStepPacketHash } from "../src/session/step-packet.js";
import { computeEvidenceHash } from "../src/session/evidence-chain.js";
import { computeAttestationPayloadHash } from "../src/session/runner-attestation.js";
import { computeBundleHash as computeApprovalBundleHash, computeSignaturePayloadHash } from "../src/session/approval-bundle.js";
import { generateKeyPairSync, createSign } from "node:crypto";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const DOD_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const GOAL = "Implement feature X";

describe("Sealed Change Package Validator", () => {
  let testDir: string;
  let sessionRoot: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "sealed-validate-test-"));
    sessionRoot = join(testDir, "sessions");
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function setupMinimalSession(): void {
    // Create session
    writeSessionJson(sessionRoot, SESSION_ID, {
      sessionId: SESSION_ID,
      title: "Test Session",
      description: "Test",
      explorationRunId: "run-1",
      createdAt: TS,
      createdBy: { actorId: "user1", actorType: "human" },
    });

    // Create DoD
    writeDoDJson(sessionRoot, SESSION_ID, {
      schemaVersion: SESSION_SCHEMA_VERSION,
      dodId: DOD_ID,
      sessionId: SESSION_ID,
      items: [
        {
          id: "dod-1",
          description: "Test passes",
          verificationMethod: "command_exit_code",
          notDoneConditions: [],
        },
      ],
      createdAt: TS,
      createdBy: { actorId: "user1", actorType: "human" },
    });

    // Create Decision Lock
    const lock = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      lockId: LOCK_ID,
      sessionId: SESSION_ID,
      dodId: DOD_ID,
      goal: GOAL,
      nonGoals: [],
      interfaces: [],
      invariants: [],
      constraints: [],
      failureModes: [],
      risksAndTradeoffs: [],
      status: "approved",
      createdAt: TS,
      createdBy: { actorId: "user1", actorType: "human" },
    };
    writeDecisionLockJson(sessionRoot, SESSION_ID, lock);

    // Create Execution Plan
    const plan = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      dodId: DOD_ID,
      lockId: LOCK_ID,
      steps: [
        {
          stepId: "step-1",
          references: ["dod-1"],
          requiredCapabilities: ["read_file"],
        },
      ],
      allowedCapabilities: ["read_file"],
    };
    writeFileSync(
      join(sessionRoot, SESSION_ID, "execution-plan.json"),
      canonicalJson(plan),
      "utf8",
    );

    // Create Prompt Capsule
    const capsule = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      capsuleId: "capsule-1",
      lockId: LOCK_ID,
      planHash: HASH,
      createdAt: TS,
      createdBy: { actorId: "user1", actorType: "human" },
      model: {
        provider: "openai",
        model: "gpt-4",
        temperature: 0.7,
        maxTokens: 2000,
      },
      intent: {
        task: "Implement feature",
        constraints: [],
      },
      context: {
        relevantFiles: [],
        relevantSymbols: [],
      },
      boundaries: {
        allowedFiles: ["file1.ts"],
        allowedSymbols: [],
        allowedDoDItems: ["dod-1"],
        allowedPlanStepIds: ["step-1"],
        allowedCapabilities: ["read_file"],
        disallowedPatterns: [],
        allowedExternalModules: [],
      },
      inputs: {
        fileDigests: [{ path: "file1.ts", sha256: HASH }],
        partialCoverage: false,
      },
      hash: {
        capsuleHash: HASH,
      },
    };
    writePromptCapsuleJson(sessionRoot, SESSION_ID, capsule);

    // Create Repo Snapshot
    const snapshot = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      snapshotId: "snapshot-1",
      generatedAt: TS,
      rootDescriptor: "test",
      includedFiles: [{ path: "file1.ts", contentHash: HASH }],
      snapshotHash: HASH,
    };
    writeRepoSnapshotJson(sessionRoot, SESSION_ID, snapshot);

    // Create Step Packet
    const stepPacket = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      lockId: LOCK_ID,
      stepId: "step-1",
      planHash: HASH,
      capsuleHash: HASH,
      snapshotHash: HASH,
      goalReference: GOAL,
      dodId: DOD_ID,
      dodItemRefs: ["dod-1"],
      allowedFiles: ["file1.ts"],
      allowedSymbols: [],
      requiredCapabilities: ["read_file"],
      reviewerSequence: ["static", "security", "qa"],
      context: {
        fileDigests: [{ path: "file1.ts", sha256: HASH }],
      },
      createdAt: TS,
      packetHash: "",
    };
    const packetHash = computeStepPacketHash(stepPacket as any);
    stepPacket.packetHash = packetHash;
    writeStepPacketJson(sessionRoot, SESSION_ID, stepPacket as any);

    // Create Patch Artifact
    const patchArtifact = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      stepId: "step-1",
      patchId: uuidv4(),
      filesChanged: [
        {
          path: "file1.ts",
          changeType: "modify" as const,
          diff: "--- a/file1.ts\n+++ b/file1.ts\n@@ -1 +1 @@\n-old\n+new",
        },
      ],
      declaredImports: [],
      declaredNewDependencies: [],
    };
    writeFileSync(
      join(sessionRoot, SESSION_ID, "patch-step-1.json"),
      canonicalJson(patchArtifact),
      "utf8",
    );

    // Create Reviewer Report
    const reviewerReport = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      stepId: "step-1",
      reviewerRole: "static" as const,
      passed: true,
      violations: [],
      notes: [],
    };
    writeReviewerReportJson(sessionRoot, SESSION_ID, "step-1", "static", reviewerReport);

    // Create Evidence (use actual plan hash so chain validates)
    const actualPlanHash = computePlanHash(plan);
    const evidence = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      stepId: "step-1",
      evidenceId: uuidv4(),
      timestamp: TS,
      evidenceType: "test_result",
      artifactHash: HASH,
      verificationMetadata: {},
      capabilityUsed: "read_file",
      humanConfirmationProof: "proof",
      planHash: actualPlanHash,
      prevEvidenceHash: null,
    };
    const evidenceHash = computeEvidenceHash(evidence);
    (evidence as any).evidenceHash = evidenceHash;
    writeRunnerEvidenceJson(sessionRoot, SESSION_ID, [evidence]);
  }

  /** Build SCP from artifacts on disk (session dir = join(sessionRoot, SESSION_ID)). */
  function createValidSCP(sessionRootPath: string): any {
    const lock = readDecisionLockJson(sessionRootPath, SESSION_ID);
    const planJson = readExecutionPlanJson(sessionRootPath, SESSION_ID);
    const capsule = readPromptCapsuleJson(sessionRootPath, SESSION_ID);
    const snapshot = readRepoSnapshotJson(sessionRootPath, SESSION_ID);
    if (!lock || !planJson || !capsule || !snapshot) {
      throw new Error("setupMinimalSession must run first");
    }
    const plan = planJson as { steps?: { stepId: string }[] };
    const stepPackets = readAllStepPacketsJson(sessionRootPath, SESSION_ID);
    const sessionDir = join(sessionRootPath, SESSION_ID);
    const patchHashes: string[] = [];
    if (plan.steps) {
      for (const step of plan.steps) {
        const patchPath = join(sessionDir, `patch-${step.stepId}.json`);
        if (existsSync(patchPath)) {
          const patch = JSON.parse(readFileSync(patchPath, "utf8"));
          patchHashes.push(sha256Hex(canonicalJson(patch)));
        }
      }
    }
    const reviewerHashes: string[] = [];
    if (plan.steps) {
      for (const step of plan.steps) {
        const reports = readReviewerReports(sessionRootPath, SESSION_ID, step.stepId);
        for (const r of reports) {
          reviewerHashes.push(sha256Hex(canonicalJson(r)));
        }
      }
    }
    const evidenceList = readRunnerEvidenceJson(sessionRootPath, SESSION_ID);
    const evidenceHashes = evidenceList
      ? evidenceList.map((e) => computeEvidenceHash(e)).sort()
      : [];

    const scpData = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      sealedAt: TS,
      sealedBy: { actorId: "user1", actorType: "human" as const },
      decisionLockHash: computeDecisionLockHash(lock),
      planHash: computePlanHash(plan),
      capsuleHash: computeCapsuleHash(capsule),
      snapshotHash: computeSnapshotHash(snapshot),
      stepPacketHashes: stepPackets.map((p) => computeStepPacketHash(p)).sort(),
      patchArtifactHashes: patchHashes.sort(),
      reviewerReportHashes: reviewerHashes.sort(),
      evidenceChainHashes: evidenceHashes,
      packageHash: "",
    };

    const packageHash = computeSealedChangePackageHash(scpData as any);
    return {
      ...scpData,
      packageHash,
    };
  }

  describe("Valid Package", () => {
    it("should validate fully valid session", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).not.toThrow();
    });
  });

  describe("Tamper Detection", () => {
    it("should reject tampered patch artifact", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      // Tamper patch artifact
      const patchPath = join(sessionRoot, SESSION_ID, "patch-step-1.json");
      const patchContent = readFileSync(patchPath, "utf8");
      const patch = JSON.parse(patchContent);
      patch.filesChanged[0].diff = "TAMPERED";
      writeFileSync(patchPath, canonicalJson(patch), "utf8");

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/hash mismatch/);
    });

    it("should reject tampered execution plan", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      // Tamper execution plan
      const planPath = join(sessionRoot, SESSION_ID, "execution-plan.json");
      const planContent = readFileSync(planPath, "utf8");
      const plan = JSON.parse(planContent);
      plan.steps[0].stepId = "step-TAMPERED";
      writeFileSync(planPath, canonicalJson(plan), "utf8");

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/hash mismatch/);
    });

    it("should reject tampered evidence chain", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      // Tamper evidence
      const evidenceList = [
        {
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          stepId: "step-1",
          evidenceId: uuidv4(),
          timestamp: TS,
          evidenceType: "TAMPERED",
          artifactHash: HASH,
          verificationMetadata: {},
          capabilityUsed: "read_file",
          humanConfirmationProof: "proof",
          planHash: HASH,
          prevEvidenceHash: null,
        },
      ];
      writeRunnerEvidenceJson(sessionRoot, SESSION_ID, evidenceList);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/hash mismatch/);
    });

    it("should reject tampered approvals", () => {
      setupMinimalSession();
      
      // Generate test key pair
      const { publicKey, privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      // Create approval policy
      writeApprovalPolicyJson(sessionRoot, SESSION_ID, {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        policyId: "policy-1",
        allowedAlgorithms: ["RSA-SHA256"],
        approvers: [
          {
            approverId: "approver-1",
            role: "tech_lead",
            publicKeyPem: publicKey,
            active: true,
          },
        ],
        rules: [
          {
            artifactType: "decision_lock",
            requiredRoles: ["tech_lead"],
            quorum: { type: "m_of_n", m: 1, n: 1 },
            requireDistinctApprovers: true,
          },
        ],
        createdAt: TS,
      });

      const lock = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        lockId: LOCK_ID,
        sessionId: SESSION_ID,
        dodId: DOD_ID,
        goal: GOAL,
        nonGoals: [],
        interfaces: [],
        invariants: [],
        constraints: [],
        failureModes: [],
        risksAndTradeoffs: [],
        status: "approved",
        createdAt: TS,
        createdBy: { actorId: "user1", actorType: "human" },
      };
      const lockHash = computeDecisionLockHash(lock);

      // Create approval bundle
      const signaturePayload = {
        signatureId: uuidv4(),
        approverId: "approver-1",
        role: "tech_lead",
        algorithm: "RSA-SHA256" as const,
        artifactType: "decision_lock" as const,
        artifactHash: lockHash,
        sessionId: SESSION_ID,
        timestamp: TS,
        nonce: uuidv4(),
      };

      const payloadHash = computeSignaturePayloadHash({
        ...signaturePayload,
        signature: "",
        payloadHash: "",
      });

      const sign = createSign("RSA-SHA256");
      sign.update(payloadHash, "hex");
      sign.end();
      const signature = sign.sign(privateKey, "base64");

      writeApprovalBundleJson(sessionRoot, SESSION_ID, {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        bundleId: "bundle-1",
        signatures: [
          {
            ...signaturePayload,
            signature,
            payloadHash,
          },
        ],
        bundleHash: "bundle-hash",
      });

      const scp = createValidSCP(sessionRoot);
      scp.approvalPolicyHash = sha256Hex(canonicalJson({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        policyId: "policy-1",
        allowedAlgorithms: ["RSA-SHA256"],
        approvers: [
          {
            approverId: "approver-1",
            role: "tech_lead",
            publicKeyPem: publicKey,
            active: true,
          },
        ],
        rules: [
          {
            artifactType: "decision_lock",
            requiredRoles: ["tech_lead"],
            quorum: { type: "m_of_n", m: 1, n: 1 },
            requireDistinctApprovers: true,
          },
        ],
        createdAt: TS,
      }));
      scp.approvalBundleHash = computeApprovalBundleHash({
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        bundleId: "bundle-1",
        signatures: [
          {
            ...signaturePayload,
            signature,
            payloadHash,
          },
        ],
        bundleHash: "bundle-hash",
      });
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      // Tamper approval bundle (artifactHash is included in bundle hash)
      const bundlePath = join(sessionRoot, SESSION_ID, "approval-bundle.json");
      const bundleContent = readFileSync(bundlePath, "utf8");
      const bundle = JSON.parse(bundleContent);
      bundle.signatures[0].artifactHash = "b".repeat(64);
      writeFileSync(bundlePath, canonicalJson(bundle), "utf8");

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/hash mismatch/);
    });

    it("should reject tampered anchor", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      
      const anchor = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        anchorId: uuidv4(),
        createdAt: TS,
        createdBy: { actorId: "user1", actorType: "human" },
        evidenceHashes: [HASH],
        planHash: HASH,
      };
      writeSessionAnchorJson(sessionRoot, SESSION_ID, anchor);
      scp.anchorHash = sha256Hex(canonicalJson(anchor));
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      // Tamper anchor
      const anchorPath = join(sessionRoot, SESSION_ID, "session-anchor.json");
      const tamperedAnchor = { ...anchor, evidenceHashes: ["TAMPERED"] };
      writeFileSync(anchorPath, canonicalJson(tamperedAnchor), "utf8");

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/hash mismatch/);
    });
  });

  describe("Missing Artifacts", () => {
    it("should reject missing step packet", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      // SCP claims 0 step packets but disk has 1 -> count mismatch
      scp.stepPacketHashes = [];
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/count mismatch/);
    });

    it("should reject missing patch artifact", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);
      rmSync(join(sessionRoot, SESSION_ID, "patch-step-1.json"), { force: true });

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/count mismatch/);
    });

    it("should reject missing reviewer report", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);
      const sessionDir = join(sessionRoot, SESSION_ID);
      const reviewerFile = readdirSync(sessionDir).find((f) => f.startsWith("reviewer-step-1-"));
      if (reviewerFile) rmSync(join(sessionDir, reviewerFile), { force: true });

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/count mismatch/);
    });

    it("should reject missing evidence item", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);
      rmSync(join(sessionRoot, SESSION_ID, "runner-evidence.json"), { force: true });

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/count mismatch/);
    });

    it("should reject missing DecisionLock", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      // Delete DecisionLock
      const lockPath = join(sessionRoot, SESSION_ID, "decision-lock.json");
      rmSync(lockPath, { force: true });

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/missing/);
    });
  });

  describe("Binding Violations", () => {
    it("should reject step packet hash not in array", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      // Add extra step packet hash (valid 64-char hex) so SCP lists 2, disk has 1
      scp.stepPacketHashes.push("b".repeat(64));
      scp.stepPacketHashes.sort();
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/count mismatch/);
    });

    it("should reject patch artifact hash not in array", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      // Add extra patch artifact hash (valid 64-char hex) so SCP lists 2, disk has 1
      scp.patchArtifactHashes.push("b".repeat(64));
      scp.patchArtifactHashes.sort();
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/count mismatch/);
    });
  });

  describe("Optional Artifacts", () => {
    it("should handle missing optional artifacts correctly", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      // Don't include optional hashes
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).not.toThrow();
    });

    it("should validate optional artifacts if present", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      
      // Add symbol index
      const symbolIndex = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        generatedAt: TS,
        exports: [],
        imports: [],
      };
      writeSymbolIndexJson(sessionRoot, SESSION_ID, symbolIndex);
      scp.symbolIndexHash = sha256Hex(canonicalJson(symbolIndex));
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).not.toThrow();
    });

    it("should reject optional artifact hash mismatch", () => {
      setupMinimalSession();
      const scp = createValidSCP(sessionRoot);
      
      // Add symbol index
      const symbolIndex = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        generatedAt: TS,
        exports: [],
        imports: [],
      };
      writeSymbolIndexJson(sessionRoot, SESSION_ID, symbolIndex);
      scp.symbolIndexHash = "b".repeat(64); // valid hex but wrong value
      scp.packageHash = computeSealedChangePackageHash(scp);
      writeSealedChangePackageJson(sessionRoot, SESSION_ID, scp);

      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(SessionError);
      expect(() => validateSealedChangePackage(SESSION_ID, sessionRoot)).toThrow(/hash mismatch/);
    });
  });
});
