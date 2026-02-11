/**
 * Runner Identity Tests — Phase H
 *
 * Tests for runner identity schema, validation, and hash computation.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  RunnerIdentitySchema,
  validateRunnerIdentity,
  computeIdentityHash,
  type RunnerIdentity,
} from "../src/session/runner-identity.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

// Mock PEM public key (RSA)
const MOCK_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdefghijklmnopqrstuvwxyz
ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ
1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnop
QIDAQAB
-----END PUBLIC KEY-----`;

// Mock hex public key
const MOCK_PUBLIC_KEY_HEX = "a".repeat(128);

function minimalIdentity(overrides?: Partial<RunnerIdentity>): RunnerIdentity {
  return {
    runnerId: SESSION_ID,
    runnerVersion: "1.0.0",
    runnerPublicKey: MOCK_PUBLIC_KEY_PEM,
    environmentFingerprint: HASH,
    buildHash: HASH,
    allowedCapabilitiesSnapshot: ["read_file", "validate"],
    attestationTimestamp: TS,
    ...overrides,
  };
}

describe("Runner Identity", () => {
  describe("RunnerIdentitySchema", () => {
    it("should accept valid identity", () => {
      const identity = minimalIdentity();
      expect(() => RunnerIdentitySchema.parse(identity)).not.toThrow();
    });

    it("should reject missing runnerId", () => {
      const identity = minimalIdentity();
      delete (identity as Record<string, unknown>).runnerId;
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should reject invalid runnerId format", () => {
      const identity = minimalIdentity({ runnerId: "not-a-uuid" });
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should reject missing runnerVersion", () => {
      const identity = minimalIdentity();
      delete (identity as Record<string, unknown>).runnerVersion;
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should reject missing runnerPublicKey", () => {
      const identity = minimalIdentity();
      delete (identity as Record<string, unknown>).runnerPublicKey;
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should accept PEM format public key", () => {
      const identity = minimalIdentity({ runnerPublicKey: MOCK_PUBLIC_KEY_PEM });
      expect(() => RunnerIdentitySchema.parse(identity)).not.toThrow();
    });

    it("should accept hex format public key", () => {
      const identity = minimalIdentity({ runnerPublicKey: MOCK_PUBLIC_KEY_HEX });
      expect(() => RunnerIdentitySchema.parse(identity)).not.toThrow();
    });

    it("should reject invalid public key format", () => {
      const identity = minimalIdentity({ runnerPublicKey: "invalid-key" });
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should reject invalid environmentFingerprint format", () => {
      const identity = minimalIdentity({
        environmentFingerprint: "not-64-chars",
      });
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should reject invalid buildHash format", () => {
      const identity = minimalIdentity({ buildHash: "not-64-chars" });
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should reject invalid attestationTimestamp format", () => {
      const identity = minimalIdentity({
        attestationTimestamp: "not-iso8601",
      });
      expect(() => RunnerIdentitySchema.parse(identity)).toThrow();
    });

    it("should accept empty allowedCapabilitiesSnapshot", () => {
      const identity = minimalIdentity({ allowedCapabilitiesSnapshot: [] });
      expect(() => RunnerIdentitySchema.parse(identity)).not.toThrow();
    });

    it("should accept multiple capabilities in snapshot", () => {
      const identity = minimalIdentity({
        allowedCapabilitiesSnapshot: ["read_file", "validate", "compute_hash"],
      });
      expect(() => RunnerIdentitySchema.parse(identity)).not.toThrow();
    });
  });

  describe("validateRunnerIdentity", () => {
    it("should return validated identity for valid input", () => {
      const identity = minimalIdentity();
      const result = validateRunnerIdentity(identity);
      expect(result).toBeDefined();
      expect(result.runnerId).toBe(identity.runnerId);
    });

    it("should throw SessionError for invalid schema", () => {
      const identity = minimalIdentity({ runnerId: "not-a-uuid" });
      try {
        validateRunnerIdentity(identity);
        expect.fail("Should have thrown SessionError");
      } catch (e) {
        expect(e).toBeInstanceOf(SessionError);
        if (e instanceof SessionError) {
          expect(e.code).toBe("RUNNER_IDENTITY_INVALID");
        }
      }
    });

    it("should throw SessionError for missing required fields", () => {
      const identity = minimalIdentity();
      delete (identity as Record<string, unknown>).runnerVersion;
      expect(() => validateRunnerIdentity(identity)).toThrow(SessionError);
    });
  });

  describe("computeIdentityHash", () => {
    it("should compute deterministic hash", () => {
      const identity = minimalIdentity();
      const hash1 = computeIdentityHash(identity);
      const hash2 = computeIdentityHash(identity);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
      expect(/^[0-9a-f]{64}$/.test(hash1)).toBe(true);
    });

    it("should produce different hash for different runnerId", () => {
      const identity1 = minimalIdentity({ runnerId: SESSION_ID });
      const identity2 = minimalIdentity({
        runnerId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
      });
      const hash1 = computeIdentityHash(identity1);
      const hash2 = computeIdentityHash(identity2);
      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash for different version", () => {
      const identity1 = minimalIdentity({ runnerVersion: "1.0.0" });
      const identity2 = minimalIdentity({ runnerVersion: "2.0.0" });
      const hash1 = computeIdentityHash(identity1);
      const hash2 = computeIdentityHash(identity2);
      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash for different public key", () => {
      const identity1 = minimalIdentity({ runnerPublicKey: MOCK_PUBLIC_KEY_PEM });
      const identity2 = minimalIdentity({ runnerPublicKey: MOCK_PUBLIC_KEY_HEX });
      const hash1 = computeIdentityHash(identity1);
      const hash2 = computeIdentityHash(identity2);
      expect(hash1).not.toBe(hash2);
    });

    it("should produce different hash for different capabilities", () => {
      const identity1 = minimalIdentity({
        allowedCapabilitiesSnapshot: ["read_file"],
      });
      const identity2 = minimalIdentity({
        allowedCapabilitiesSnapshot: ["read_file", "validate"],
      });
      const hash1 = computeIdentityHash(identity1);
      const hash2 = computeIdentityHash(identity2);
      expect(hash1).not.toBe(hash2);
    });

    it("should produce same hash for same capabilities in different order", () => {
      const identity1 = minimalIdentity({
        allowedCapabilitiesSnapshot: ["read_file", "validate"],
      });
      const identity2 = minimalIdentity({
        allowedCapabilitiesSnapshot: ["validate", "read_file"],
      });
      const hash1 = computeIdentityHash(identity1);
      const hash2 = computeIdentityHash(identity2);
      expect(hash1).toBe(hash2); // Should be sorted
    });

    it("should ignore attestationTimestamp in hash", () => {
      const identity1 = minimalIdentity({ attestationTimestamp: TS });
      const identity2 = minimalIdentity({
        attestationTimestamp: "2026-02-12T12:00:00.000Z",
      });
      const hash1 = computeIdentityHash(identity1);
      const hash2 = computeIdentityHash(identity2);
      expect(hash1).toBe(hash2); // Timestamp should not affect hash
    });
  });
});
