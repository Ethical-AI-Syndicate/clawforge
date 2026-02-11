/**
 * Step Packet Tests — Phase O
 *
 * Tests for step packet schema validation, hash computation, size limits, and forbidden fields.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  StepPacketSchema,
  PacketReceiptSchema,
  computeStepPacketHash,
  type StepPacket,
  type PacketReceipt,
} from "../src/session/step-packet.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const DOD_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const STEP_ID = "step-1";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);
const GOAL = "Implement feature X with Y constraints";

function minimalPacket(): Omit<StepPacket, "packetHash"> {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    lockId: LOCK_ID,
    stepId: STEP_ID,
    planHash: HASH,
    capsuleHash: HASH,
    snapshotHash: HASH,
    goalReference: GOAL,
    dodId: DOD_ID,
    dodItemRefs: ["dod-1"],
    allowedFiles: ["file1.ts"],
    allowedSymbols: ["file1.ts#export1"],
    requiredCapabilities: ["read_file"],
    reviewerSequence: ["static", "security", "qa"],
    context: {
      fileDigests: [{ path: "file1.ts", sha256: HASH }],
    },
    createdAt: TS,
  };
}

describe("Step Packet Schema", () => {
  describe("Valid Packet", () => {
    it("should accept valid packet", () => {
      const packetData = minimalPacket();
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(true);
    });

    it("should accept packet with excerpts", () => {
      const packetData = minimalPacket();
      packetData.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 10,
          text: "export const x = 1;",
        },
      ];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(true);
    });

    it("should accept packet without requiredCapabilities", () => {
      const packetData = minimalPacket();
      delete packetData.requiredCapabilities;
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(true);
    });
  });

  describe("Hash Validation", () => {
    it("should reject wrong packetHash", () => {
      const packetData = minimalPacket();
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash.slice(0, -1) + "X", // Wrong hash
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes("packetHash"))).toBe(true);
      }
    });

    it("should compute deterministic hash", () => {
      const packetData = minimalPacket();
      const hash1 = computeStepPacketHash(packetData as StepPacket);
      const hash2 = computeStepPacketHash(packetData as StepPacket);
      expect(hash1).toBe(hash2);
    });

    it("should produce different hash for different packets", () => {
      const packetData1 = minimalPacket();
      const packetData2 = minimalPacket();
      packetData2.stepId = "step-2";

      const hash1 = computeStepPacketHash(packetData1 as StepPacket);
      const hash2 = computeStepPacketHash(packetData2 as StepPacket);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("Size Limits", () => {
    it("should reject oversize packet (>200KB)", () => {
      const packetData = minimalPacket();
      // Create large text to exceed 200KB
      const largeText = "x".repeat(200 * 1024);
      packetData.goalReference = largeText;
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes("200KB"))).toBe(true);
      }
    });

    it("should reject oversize excerpt (>2000 chars)", () => {
      const packetData = minimalPacket();
      packetData.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 10,
          text: "x".repeat(2001), // Exceeds 2000 chars
        },
      ];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes("2000"))).toBe(true);
      }
    });
  });

  describe("Path Validation", () => {
    it("should reject path with traversal", () => {
      const packetData = minimalPacket();
      packetData.allowedFiles = ["../file.ts"];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });

    it("should reject absolute path", () => {
      const packetData = minimalPacket();
      packetData.allowedFiles = ["/absolute/path.ts"];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });

    it("should reject path with backslashes", () => {
      const packetData = minimalPacket();
      packetData.allowedFiles = ["path\\file.ts"];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });
  });

  describe("Forbidden Fields", () => {
    it("should reject packet with command field", () => {
      const packetData = minimalPacket();
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
        command: "rm -rf /", // Forbidden field
      } as any;

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message.includes("forbidden field"))).toBe(true);
      }
    });

    it("should reject packet with exec field", () => {
      const packetData = minimalPacket();
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
        exec: "spawn", // Forbidden field
      } as any;

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });

    it("should reject packet with http field", () => {
      const packetData = minimalPacket();
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
        http: "https://evil.com", // Forbidden field
      } as any;

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });
  });

  describe("Excerpt Validation", () => {
    it("should reject excerpt with startLine > endLine", () => {
      const packetData = minimalPacket();
      packetData.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 10,
          endLine: 5, // Invalid
          text: "test",
        },
      ];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });

    it("should accept valid excerpt", () => {
      const packetData = minimalPacket();
      packetData.context.excerpts = [
        {
          path: "file1.ts",
          startLine: 1,
          endLine: 10,
          text: "export const x = 1;",
        },
      ];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(true);
    });
  });

  describe("Reviewer Sequence", () => {
    it("should reject reviewerSequence with <3 reviewers", () => {
      const packetData = minimalPacket();
      packetData.reviewerSequence = ["static", "security"]; // Only 2
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(false);
    });

    it("should accept reviewerSequence with >=3 reviewers", () => {
      const packetData = minimalPacket();
      packetData.reviewerSequence = ["static", "security", "qa", "e2e"];
      const hash = computeStepPacketHash(packetData as StepPacket);
      const packet: StepPacket = {
        ...packetData,
        packetHash: hash,
      };

      const result = StepPacketSchema.safeParse(packet);
      expect(result.success).toBe(true);
    });
  });

  describe("Packet Receipt Schema", () => {
    it("should accept valid receipt", () => {
      const receipt: PacketReceipt = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: STEP_ID,
        packetHash: HASH,
        timestamp: TS,
        nonce: uuidv4(),
        producedArtifacts: [
          { type: "file", path: "output.ts", hash: HASH },
        ],
      };

      const result = PacketReceiptSchema.safeParse(receipt);
      expect(result.success).toBe(true);
    });

    it("should accept receipt without optional fields", () => {
      const receipt: PacketReceipt = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: STEP_ID,
        packetHash: HASH,
        timestamp: TS,
        nonce: uuidv4(),
        producedArtifacts: [],
      };

      const result = PacketReceiptSchema.safeParse(receipt);
      expect(result.success).toBe(true);
    });
  });
});
