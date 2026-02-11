import { describe, it, expect } from "vitest";
import {
  SessionAnchorSchema,
  validateAnchor,
} from "../src/session/session-anchor.js";
import { SessionError } from "../src/session/errors.js";

describe("session-anchor", () => {
  const validAnchor = {
    sessionId: "123e4567-e89b-4123-a456-426614174000",
    planHash: "a".repeat(64),
    lockId: "323e4567-e89b-4123-a456-426614174001",
    finalEvidenceHash: "b".repeat(64),
  };

  it("validates anchor schema", () => {
    const result = SessionAnchorSchema.safeParse(validAnchor);
    expect(result.success).toBe(true);
  });

  it("validates anchor bindings when all match", () => {
    expect(() =>
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      ),
    ).not.toThrow();
  });

  it("throws ANCHOR_INVALID when schema invalid", () => {
    const invalid = {
      sessionId: "not-a-uuid",
      planHash: "short",
      lockId: "also-not-uuid",
      finalEvidenceHash: "also-short",
    };
    expect(() =>
      validateAnchor(
        invalid,
        validAnchor.sessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      ),
    ).toThrow(SessionError);
    try {
      validateAnchor(
        invalid,
        validAnchor.sessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("ANCHOR_INVALID");
    }
  });

  it("throws ANCHOR_INVALID when sessionId mismatch", () => {
    const differentSessionId = "999e4567-e89b-4123-a456-426614174000";
    expect(() =>
      validateAnchor(
        validAnchor,
        differentSessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      ),
    ).toThrow(SessionError);
    try {
      validateAnchor(
        validAnchor,
        differentSessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("ANCHOR_INVALID");
      expect((e as SessionError).details.field).toBe("sessionId");
    }
  });

  it("throws ANCHOR_INVALID when planHash mismatch", () => {
    const differentHash = "c".repeat(64);
    expect(() =>
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        differentHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      ),
    ).toThrow(SessionError);
    try {
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        differentHash,
        validAnchor.lockId,
        validAnchor.finalEvidenceHash,
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("ANCHOR_INVALID");
      expect((e as SessionError).details.field).toBe("planHash");
    }
  });

  it("throws ANCHOR_INVALID when lockId mismatch", () => {
    const differentLockId = "999e4567-e89b-4123-a456-426614174002";
    expect(() =>
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        validAnchor.planHash,
        differentLockId,
        validAnchor.finalEvidenceHash,
      ),
    ).toThrow(SessionError);
    try {
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        validAnchor.planHash,
        differentLockId,
        validAnchor.finalEvidenceHash,
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("ANCHOR_INVALID");
      expect((e as SessionError).details.field).toBe("lockId");
    }
  });

  it("throws ANCHOR_INVALID when finalEvidenceHash mismatch", () => {
    const differentHash = "d".repeat(64);
    expect(() =>
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        differentHash,
      ),
    ).toThrow(SessionError);
    try {
      validateAnchor(
        validAnchor,
        validAnchor.sessionId,
        validAnchor.planHash,
        validAnchor.lockId,
        differentHash,
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("ANCHOR_INVALID");
      expect((e as SessionError).details.field).toBe("finalEvidenceHash");
    }
  });
});
