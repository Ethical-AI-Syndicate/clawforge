import { describe, it, expect } from "vitest";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import {
  RunnerRequestSchema,
  RunnerEvidenceSchema,
  type RunnerRequest,
  type RunnerEvidence,
} from "../src/session/runner-contract.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const LOCK_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const DOD_ID = "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f";
const EVIDENCE_ID = "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

const validRequest: RunnerRequest = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: SESSION_ID,
  lockId: LOCK_ID,
  dodId: DOD_ID,
  goal: "Phase D goal",
  stepId: "step-d1",
  allowedCapabilities: ["read_only", "validate"],
  expectedEvidenceTypes: ["artifact_recorded"],
  verificationRequirements: ["Hash must match artifact"],
} as RunnerRequest;

const validEvidence: RunnerEvidence = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  sessionId: SESSION_ID,
  stepId: "step-d1",
  evidenceId: EVIDENCE_ID,
  timestamp: TS,
  evidenceType: "artifact_recorded",
  artifactHash: HASH,
  verificationMetadata: {},
  capabilityUsed: "read_only",
  humanConfirmationProof: "human-typed-confirmation-string",
} as RunnerEvidence;

describe("RunnerRequestSchema", () => {
  it("accepts valid request", () => {
    const r = RunnerRequestSchema.safeParse(validRequest);
    expect(r.success).toBe(true);
  });

  it("rejects missing sessionId", () => {
    const { sessionId: _, ...rest } = validRequest;
    expect(RunnerRequestSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing lockId", () => {
    const { lockId: _, ...rest } = validRequest;
    expect(RunnerRequestSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing dodId", () => {
    const { dodId: _, ...rest } = validRequest;
    expect(RunnerRequestSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing goal", () => {
    const { goal: _, ...rest } = validRequest;
    expect(RunnerRequestSchema.safeParse({ ...rest, goal: "" }).success).toBe(false);
  });

  it("rejects missing stepId", () => {
    const { stepId: _, ...rest } = validRequest;
    expect(RunnerRequestSchema.safeParse({ ...rest, stepId: "" }).success).toBe(false);
  });

  it("rejects empty allowedCapabilities", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      allowedCapabilities: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty expectedEvidenceTypes", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      expectedEvidenceTypes: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty verificationRequirements", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      verificationRequirements: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid sessionId format", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      sessionId: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("rejects invalid schemaVersion", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      schemaVersion: "2.0.0",
    });
    expect(r.success).toBe(false);
  });

  it("accepts single capability", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      allowedCapabilities: ["one"],
    });
    expect(r.success).toBe(true);
  });

  it("rejects capability over 200 chars", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      allowedCapabilities: ["x".repeat(201)],
    });
    expect(r.success).toBe(false);
  });

  it("rejects goal over 5000 chars", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      goal: "x".repeat(5001),
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 50 capabilities", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      allowedCapabilities: Array.from({ length: 51 }, (_, i) => `cap-${i}`),
    });
    expect(r.success).toBe(false);
  });

  it("accepts max length goal", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      goal: "x".repeat(5000),
    });
    expect(r.success).toBe(true);
  });

  it("rejects null request", () => {
    expect(RunnerRequestSchema.safeParse(null).success).toBe(false);
  });

  it("rejects non-object", () => {
    expect(RunnerRequestSchema.safeParse("string").success).toBe(false);
  });

  it("preserves unknown fields (passthrough)", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      extra: "allowed",
    });
    expect(r.success).toBe(true);
  });

  it("rejects stepId over 100 chars", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      stepId: "x".repeat(101),
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 20 expectedEvidenceTypes", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      expectedEvidenceTypes: Array.from({ length: 21 }, (_, i) => `t-${i}`),
    });
    expect(r.success).toBe(false);
  });

  it("rejects more than 50 verificationRequirements", () => {
    const r = RunnerRequestSchema.safeParse({
      ...validRequest,
      verificationRequirements: Array.from({ length: 51 }, () => "req"),
    });
    expect(r.success).toBe(false);
  });
});

describe("RunnerEvidenceSchema", () => {
  it("accepts valid evidence", () => {
    const r = RunnerEvidenceSchema.safeParse(validEvidence);
    expect(r.success).toBe(true);
  });

  it("rejects missing sessionId", () => {
    const { sessionId: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing evidenceId", () => {
    const { evidenceId: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing timestamp", () => {
    const { timestamp: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects invalid timestamp format", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      timestamp: "not-iso",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing artifactHash", () => {
    const { artifactHash: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects artifactHash not 64 hex chars", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      artifactHash: "short",
    });
    expect(r.success).toBe(false);
  });

  it("rejects artifactHash with invalid chars", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      artifactHash: "G".repeat(64),
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing capabilityUsed", () => {
    const { capabilityUsed: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing humanConfirmationProof", () => {
    const { humanConfirmationProof: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects empty humanConfirmationProof", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      humanConfirmationProof: "",
    });
    expect(r.success).toBe(false);
  });

  it("rejects missing evidenceType", () => {
    const { evidenceType: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse({ ...rest, evidenceType: "" }).success).toBe(false);
  });

  it("rejects missing stepId", () => {
    const { stepId: _, ...rest } = validEvidence;
    expect(RunnerEvidenceSchema.safeParse({ ...rest, stepId: "" }).success).toBe(false);
  });

  it("accepts verificationMetadata empty object", () => {
    const r = RunnerEvidenceSchema.safeParse(validEvidence);
    expect(r.success).toBe(true);
  });

  it("accepts verificationMetadata with keys", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      verificationMetadata: { key: "value" },
    });
    expect(r.success).toBe(true);
  });

  it("rejects null evidence", () => {
    expect(RunnerEvidenceSchema.safeParse(null).success).toBe(false);
  });

  it("rejects non-object evidence", () => {
    expect(RunnerEvidenceSchema.safeParse(42).success).toBe(false);
  });

  it("rejects invalid evidenceId (not UUID)", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      evidenceId: "not-uuid",
    });
    expect(r.success).toBe(false);
  });

  it("preserves unknown fields (passthrough)", () => {
    const r = RunnerEvidenceSchema.safeParse({
      ...validEvidence,
      extraField: true,
    });
    expect(r.success).toBe(true);
  });
});
