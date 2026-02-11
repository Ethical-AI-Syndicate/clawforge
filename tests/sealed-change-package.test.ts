/**
 * Sealed Change Package Tests — Phase P
 *
 * Tests for sealed change package schema validation, hash computation, and structure validation.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  SealedChangePackageSchema,
  computeSealedChangePackageHash,
  validateSealedChangePackageStructure,
  type SealedChangePackage,
} from "../src/session/sealed-change-package.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function minimalPackage(): Omit<SealedChangePackage, "packageHash"> {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    sealedAt: TS,
    sealedBy: { actorId: "user1", actorType: "human" },
    decisionLockHash: HASH,
    planHash: HASH,
    capsuleHash: HASH,
    snapshotHash: HASH,
    stepPacketHashes: [HASH],
    patchArtifactHashes: [HASH],
    reviewerReportHashes: [HASH],
    evidenceChainHashes: [HASH],
    packageHash: "", // Will be computed
  };
}

describe("Sealed Change Package Schema", () => {
  describe("Valid Package", () => {
    it("should accept valid package with required fields", () => {
      const pkgData = minimalPackage();
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });

    it("should accept package with all optional fields", () => {
      const pkgData = minimalPackage();
      pkgData.policySetHash = HASH_B;
      pkgData.policyEvaluationHash = HASH_B;
      pkgData.symbolIndexHash = HASH_B;
      pkgData.patchApplyReportHash = HASH_B;
      pkgData.runnerIdentityHash = HASH_B;
      pkgData.attestationHash = HASH_B;
      pkgData.approvalPolicyHash = HASH_B;
      pkgData.approvalBundleHash = HASH_B;
      pkgData.anchorHash = HASH_B;

      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });

    it("should accept package with empty arrays", () => {
      const pkgData = minimalPackage();
      pkgData.stepPacketHashes = [];
      pkgData.patchArtifactHashes = [];
      pkgData.reviewerReportHashes = [];
      pkgData.evidenceChainHashes = [];

      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });
  });

  describe("Hash Validation", () => {
    it("should reject wrong packageHash", () => {
      const pkgData = minimalPackage();
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash.slice(0, -1) + "X", // Wrong hash
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes("packageHash"))).toBe(true);
      }
    });

    it("should compute deterministic hash", () => {
      const pkgData = minimalPackage();
      const hash1 = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const hash2 = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different packages", () => {
      const pkgData1 = minimalPackage();
      const pkgData2 = minimalPackage();
      pkgData2.decisionLockHash = HASH_B;

      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);
      const hash2 = computeSealedChangePackageHash(pkgData2 as SealedChangePackage);
      expect(hash1).not.toBe(hash2);
    });

    it("should exclude packageHash from hash computation", () => {
      const pkgData1 = minimalPackage();
      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);
      
      const pkgData2 = minimalPackage();
      const pkg: SealedChangePackage = {
        ...pkgData2,
        packageHash: "x".repeat(64), // Different packageHash
      };
      
      // Changing packageHash should not affect computed hash
      const hash2 = computeSealedChangePackageHash(pkg);
      expect(hash1).toBe(hash2);
    });
  });

  describe("Required Fields", () => {
    it("should reject missing decisionLockHash", () => {
      const pkgData = minimalPackage();
      delete (pkgData as any).decisionLockHash;
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });

    it("should reject missing planHash", () => {
      const pkgData = minimalPackage();
      delete (pkgData as any).planHash;
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });

    it("should reject missing capsuleHash", () => {
      const pkgData = minimalPackage();
      delete (pkgData as any).capsuleHash;
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });

    it("should reject missing snapshotHash", () => {
      const pkgData = minimalPackage();
      delete (pkgData as any).snapshotHash;
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });

    it("should reject missing stepPacketHashes", () => {
      const pkgData = minimalPackage();
      delete (pkgData as any).stepPacketHashes;
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: "",
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });
  });

  describe("Array Sorting", () => {
    it("should sort stepPacketHashes deterministically", () => {
      const pkgData1 = minimalPackage();
      pkgData1.stepPacketHashes = [HASH_C, HASH_B, HASH];
      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);

      const pkgData2 = minimalPackage();
      pkgData2.stepPacketHashes = [HASH, HASH_B, HASH_C];
      const hash2 = computeSealedChangePackageHash(pkgData2 as SealedChangePackage);

      expect(hash1).toBe(hash2);
    });

    it("should sort patchArtifactHashes deterministically", () => {
      const pkgData1 = minimalPackage();
      pkgData1.patchArtifactHashes = [HASH_C, HASH_B, HASH];
      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);

      const pkgData2 = minimalPackage();
      pkgData2.patchArtifactHashes = [HASH, HASH_B, HASH_C];
      const hash2 = computeSealedChangePackageHash(pkgData2 as SealedChangePackage);

      expect(hash1).toBe(hash2);
    });

    it("should sort reviewerReportHashes deterministically", () => {
      const pkgData1 = minimalPackage();
      pkgData1.reviewerReportHashes = [HASH_C, HASH_B, HASH];
      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);

      const pkgData2 = minimalPackage();
      pkgData2.reviewerReportHashes = [HASH, HASH_B, HASH_C];
      const hash2 = computeSealedChangePackageHash(pkgData2 as SealedChangePackage);

      expect(hash1).toBe(hash2);
    });

    it("should sort evidenceChainHashes deterministically", () => {
      const pkgData1 = minimalPackage();
      pkgData1.evidenceChainHashes = [HASH_C, HASH_B, HASH];
      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);

      const pkgData2 = minimalPackage();
      pkgData2.evidenceChainHashes = [HASH, HASH_B, HASH_C];
      const hash2 = computeSealedChangePackageHash(pkgData2 as SealedChangePackage);

      expect(hash1).toBe(hash2);
    });
  });

  describe("Optional Fields", () => {
    it("should accept package without optional fields", () => {
      const pkgData = minimalPackage();
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });

    it("should include optional fields in hash if present", () => {
      const pkgData1 = minimalPackage();
      const hash1 = computeSealedChangePackageHash(pkgData1 as SealedChangePackage);

      const pkgData2 = minimalPackage();
      pkgData2.policySetHash = HASH_B;
      const hash2 = computeSealedChangePackageHash(pkgData2 as SealedChangePackage);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Structure Validation", () => {
    it("should validate valid package structure", () => {
      const pkgData = minimalPackage();
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      expect(() => validateSealedChangePackageStructure(pkg)).not.toThrow();
    });

    it("should reject invalid package structure", () => {
      const pkgData = minimalPackage();
      pkgData.decisionLockHash = "invalid-hash"; // Invalid hash format
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: "",
      } as any;

      expect(() => validateSealedChangePackageStructure(pkg)).toThrow(SessionError);
      try {
        validateSealedChangePackageStructure(pkg);
      } catch (error) {
        if (error instanceof SessionError) {
          expect(error.code).toBe("SEAL_INVALID");
        }
      }
    });

    it("should reject package with hash mismatch", () => {
      const pkgData = minimalPackage();
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash.slice(0, -1) + "X", // Wrong hash
      };

      expect(() => validateSealedChangePackageStructure(pkg)).toThrow(SessionError);
      try {
        validateSealedChangePackageStructure(pkg);
      } catch (error) {
        if (error instanceof SessionError) {
          expect(error.code).toBe("SEAL_INVALID");
        }
      }
    });
  });

  describe("Hash Format Validation", () => {
    it("should reject invalid hash format", () => {
      const pkgData = minimalPackage();
      pkgData.decisionLockHash = "invalid"; // Not 64 hex chars
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });

    it("should reject hash with uppercase letters", () => {
      const pkgData = minimalPackage();
      pkgData.decisionLockHash = HASH.toUpperCase(); // Uppercase
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });
  });

  describe("Actor Validation", () => {
    it("should accept human actor", () => {
      const pkgData = minimalPackage();
      pkgData.sealedBy = { actorId: "user1", actorType: "human" };
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });

    it("should accept system actor", () => {
      const pkgData = minimalPackage();
      pkgData.sealedBy = { actorId: "system1", actorType: "system" };
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      };

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(true);
    });

    it("should reject invalid actor type", () => {
      const pkgData = minimalPackage();
      pkgData.sealedBy = { actorId: "user1", actorType: "invalid" as any };
      const hash = computeSealedChangePackageHash(pkgData as SealedChangePackage);
      const pkg: SealedChangePackage = {
        ...pkgData,
        packageHash: hash,
      } as any;

      const result = SealedChangePackageSchema.safeParse(pkg);
      expect(result.success).toBe(false);
    });
  });
});
