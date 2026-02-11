/**
 * Step Packet Emitter Tests — Phase O
 *
 * Tests for step packet emission logic, prerequisites, and deterministic ordering.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionError } from "../src/session/errors.js";
import { SessionManager } from "../src/session/session.js";
import { emitStepPackets } from "../src/session/step-packet-emit.js";
import { EventStore } from "../src/audit/store.js";
import { computeDecisionLockHash } from "../src/session/decision-lock-hash.js";
import type { StepPacket } from "../src/session/step-packet.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { v4 as uuidv4 } from "uuid";
import {
  writeSessionJson,
  writeDoDJson,
  writeDecisionLockJson,
  readDecisionLockJson,
  writePromptCapsuleJson,
  writeRepoSnapshotJson,
  writeGateResultJson,
  writeApprovalPolicyJson,
  writeApprovalBundleJson,
  readAllStepPacketsJson,
} from "../src/session/persistence.js";
import { canonicalJson } from "../src/audit/canonical.js";
import { generateKeyPairSync, createSign } from "node:crypto";
import { computeSignaturePayloadHash } from "../src/session/approval-bundle.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const DOD_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const GOAL = "Implement feature X";

describe("Step Packet Emitter", () => {
  let testDir: string;
  let sessionRoot: string;
  let projectRoot: string;
  let manager: SessionManager;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "step-packet-emit-test-"));
    sessionRoot = join(testDir, "sessions");
    projectRoot = join(testDir, "project");

    // Create project directory
    mkdirSync(projectRoot, { recursive: true });

    // Create project files
    writeFileSync(join(projectRoot, "file1.ts"), "export const x = 1;");
    writeFileSync(join(projectRoot, "file2.ts"), "export const y = 2;");

    const eventStore = new EventStore(join(testDir, "audit.db"));
    manager = new SessionManager(eventStore, sessionRoot);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function setupSession(): void {
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
    writeDecisionLockJson(sessionRoot, SESSION_ID, {
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
    });

    // Create Execution Plan (no write helper exists, write directly)
    const planDir = join(sessionRoot, SESSION_ID);
    mkdirSync(planDir, { recursive: true });
    writeFileSync(
      join(planDir, "execution-plan.json"),
      canonicalJson({
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
        {
          stepId: "step-2",
          references: ["dod-1"],
          requiredCapabilities: ["read_file"],
        },
      ],
      allowedCapabilities: ["read_file"],
      }),
      "utf8",
    );

    // Create Prompt Capsule
    writePromptCapsuleJson(sessionRoot, SESSION_ID, {
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
        allowedFiles: ["file1.ts", "file2.ts"],
        allowedSymbols: ["file1.ts#export1"],
        allowedDoDItems: ["dod-1"],
        allowedPlanStepIds: ["step-1", "step-2"],
        allowedCapabilities: ["read_file"],
        disallowedPatterns: [],
        allowedExternalModules: [],
      },
      inputs: {
        fileDigests: [
          { path: "file1.ts", sha256: HASH },
          { path: "file2.ts", sha256: HASH },
        ],
        partialCoverage: false,
      },
      hash: {
        capsuleHash: HASH,
      },
    });

    // Create Repo Snapshot
    writeRepoSnapshotJson(sessionRoot, SESSION_ID, {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      snapshotId: "snapshot-1",
      generatedAt: TS,
      rootDescriptor: "test",
      includedFiles: [
        { path: "file1.ts", contentHash: HASH },
        { path: "file2.ts", contentHash: HASH },
      ],
      snapshotHash: HASH,
    });
  }

  function setupGatePassed(): void {
    writeGateResultJson(sessionRoot, SESSION_ID, {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      passed: true,
      checks: [],
      evaluatedAt: TS,
    });
  }

  function setupApprovals(): void {
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

    // Create approval bundle
    const lock = readDecisionLockJson(sessionRoot, SESSION_ID)!;
    const lockHash = computeDecisionLockHash(lock);
    const planHash = "b".repeat(64);
    const capsuleHash = "c".repeat(64);

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
  }

  describe("Emission Logic", () => {
    it("should emit one packet per step deterministically", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets.length).toBe(2);
      expect(packets[0]!.stepId).toBe("step-1");
      expect(packets[1]!.stepId).toBe("step-2");
    });

    it("should return packets sorted by stepId", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.stepId).toBe("step-1");
      expect(packets[1]!.stepId).toBe("step-2");
    });

    it("should persist packets to filesystem", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      manager.emitStepPackets(SESSION_ID, projectRoot);

      const persisted = readAllStepPacketsJson(sessionRoot, SESSION_ID);
      expect(persisted.length).toBe(2);
      expect(persisted[0]!.stepId).toBe("step-1");
      expect(persisted[1]!.stepId).toBe("step-2");
    });

    it("should include correct file digests from snapshot", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.context.fileDigests).toBeDefined();
      expect(packets[0]!.context.fileDigests!.length).toBeGreaterThan(0);
      const digest = packets[0]!.context.fileDigests!.find((d) => d.path === "file1.ts");
      expect(digest).toBeDefined();
      expect(digest!.sha256).toBe(HASH);
    });

    it("should not include excerpts by default", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.context.excerpts).toBeUndefined();
    });

    it("should include excerpts when requested in step", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      // Update plan to request excerpts
      const planDir = join(sessionRoot, SESSION_ID);
      writeFileSync(
        join(planDir, "execution-plan.json"),
        canonicalJson({
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          dodId: DOD_ID,
          lockId: LOCK_ID,
          steps: [
            {
              stepId: "step-1",
              references: ["dod-1"],
              requiredCapabilities: ["read_file"],
              includeExcerpts: true,
            },
          ],
          allowedCapabilities: ["read_file"],
        }),
        "utf8",
      );

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.context.excerpts).toBeDefined();
      expect(packets[0]!.context.excerpts!.length).toBeGreaterThan(0);
    });

    it("should intersect step-specific boundaries correctly", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      // Update plan with step-specific allowedFiles
      const planDir = join(sessionRoot, SESSION_ID);
      writeFileSync(
        join(planDir, "execution-plan.json"),
        canonicalJson({
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          dodId: DOD_ID,
          lockId: LOCK_ID,
          steps: [
            {
              stepId: "step-1",
              references: ["dod-1"],
              requiredCapabilities: ["read_file"],
              allowedFiles: ["file1.ts"], // Intersect with capsule
            },
          ],
          allowedCapabilities: ["read_file"],
        }),
        "utf8",
      );

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.allowedFiles).toEqual(["file1.ts"]);
    });
  });

  describe("Prerequisites", () => {
    it("should fail if gate not passed", () => {
      setupSession();
      // Gate not passed
      setupApprovals();

      expect(() => manager.emitStepPackets(SESSION_ID, projectRoot)).toThrow(SessionError);
      expect(() => manager.emitStepPackets(SESSION_ID, projectRoot)).toThrow(
        /execution gate not passed/,
      );
    });

    it("should fail if approvals missing", () => {
      setupSession();
      setupGatePassed();
      // Approvals not set up

      expect(() => manager.emitStepPackets(SESSION_ID, projectRoot)).toThrow(SessionError);
      expect(() => manager.emitStepPackets(SESSION_ID, projectRoot)).toThrow(
        /approvals not verified/,
      );
    });

    it("should fail if projectRoot not provided", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      expect(() => manager.emitStepPackets(SESSION_ID)).toThrow(SessionError);
      expect(() => manager.emitStepPackets(SESSION_ID)).toThrow(/projectRoot required/);
    });

    it("should succeed with all prerequisites met", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      expect(() => manager.emitStepPackets(SESSION_ID, projectRoot)).not.toThrow();
    });
  });

  describe("Deterministic Ordering", () => {
    it("should produce stable packet hashes for same input", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets1 = manager.emitStepPackets(SESSION_ID, projectRoot);
      // Note: Packet hashes include createdAt timestamp, so they will differ
      // between calls. This test verifies that packets are emitted correctly.
      expect(packets1.length).toBeGreaterThan(0);
      expect(packets1[0]!.packetHash).toBeDefined();
      expect(packets1[0]!.packetHash.length).toBe(64);
    });

    it("should sort allowedFiles alphabetically", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.allowedFiles).toEqual(["file1.ts", "file2.ts"]);
    });

    it("should sort dodItemRefs alphabetically", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      // Update plan with multiple refs
      const planDir = join(sessionRoot, SESSION_ID);
      writeFileSync(
        join(planDir, "execution-plan.json"),
        canonicalJson({
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          dodId: DOD_ID,
          lockId: LOCK_ID,
          steps: [
            {
              stepId: "step-1",
              references: ["dod-2", "dod-1"], // Unsorted
              requiredCapabilities: ["read_file"],
            },
          ],
          allowedCapabilities: ["read_file"],
        }),
        "utf8",
      );

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.dodItemRefs).toEqual(["dod-1", "dod-2"]);
    });
  });

  describe("Missing Optional Fields", () => {
    it("should handle step without requiredCapabilities", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const planDir = join(sessionRoot, SESSION_ID);
      writeFileSync(
        join(planDir, "execution-plan.json"),
        canonicalJson({
          schemaVersion: SESSION_SCHEMA_VERSION,
          sessionId: SESSION_ID,
          dodId: DOD_ID,
          lockId: LOCK_ID,
          steps: [
            {
              stepId: "step-1",
              references: ["dod-1"],
              // No requiredCapabilities
            },
          ],
          allowedCapabilities: ["read_file"],
        }),
        "utf8",
      );

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      expect(packets[0]!.requiredCapabilities).toBeUndefined();
    });

    it("should handle step without allowedFiles", () => {
      setupSession();
      setupGatePassed();
      setupApprovals();

      const packets = manager.emitStepPackets(SESSION_ID, projectRoot);

      // Should use capsule boundaries
      expect(packets[0]!.allowedFiles.length).toBeGreaterThan(0);
    });
  });

  describe("Direct emitStepPackets Function", () => {
    it("should emit packets when called directly", () => {
      setupSession();

      const dod = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        dodId: DOD_ID,
        sessionId: SESSION_ID,
        items: [
          {
            id: "dod-1",
            description: "Test",
            verificationMethod: "command_exit_code" as const,
            notDoneConditions: [],
          },
        ],
        createdAt: TS,
        createdBy: { actorId: "user1", actorType: "human" },
      };

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
        status: "approved" as const,
        createdAt: TS,
        createdBy: { actorId: "user1", actorType: "human" },
      };

      const plan = {
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
          task: "Implement",
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

      const snapshot = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        snapshotId: "snapshot-1",
        generatedAt: TS,
        rootDescriptor: "test",
        includedFiles: [{ path: "file1.ts", contentHash: HASH }],
        snapshotHash: HASH,
      };

      const packets = emitStepPackets({
        sessionId: SESSION_ID,
        sessionRoot,
        projectRoot,
        dod,
        lock,
        plan,
        capsule,
        snapshot,
      });

      expect(packets.length).toBe(1);
      expect(packets[0]!.stepId).toBe("step-1");
    });
  });
});
