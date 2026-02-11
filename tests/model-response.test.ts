import { describe, it, expect } from "vitest";
import {
  ModelResponseArtifactSchema,
  ChangeProposalSchema,
  CitationSchema,
  computeResponseHash,
} from "../src/session/model-response.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";

describe("model-response", () => {
  const createValidResponse = (): any => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
    capsuleId: "223e4567-e89b-12d3-a456-426614174000",
    responseId: "323e4567-e89b-12d3-a456-426614174000",
    createdAt: "2024-01-01T00:00:00.000Z",
    model: {
      provider: "openai" as const,
      modelId: "gpt-4",
      seed: 42,
    },
    output: {
      summary: "This is a test summary",
      proposedChanges: [
        {
          changeId: "change-1",
          changeType: "edit_file" as const,
          targetPath: "src/file1.ts",
          patch: "--- a/src/file1.ts\n+++ b/src/file1.ts\n@@ -1,1 +1,2 @@\n line1\n+line2",
          referencedDoDItems: ["dod-item-1"],
          referencedPlanStepIds: ["step-1"],
          referencedSymbols: [],
          riskNotes: [],
        },
      ],
      citations: [
        {
          type: "file" as const,
          ref: "src/file1.ts",
          note: "Referenced file",
        },
      ],
    },
    hash: {
      responseHash: "a".repeat(64),
    },
  });

  it("validates valid response", () => {
    const response = createValidResponse();
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it("validates valid change proposal", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "edit_file",
      targetPath: "src/file1.ts",
      patch: "patch content",
      referencedDoDItems: ["dod-1"],
      referencedPlanStepIds: ["step-1"],
      referencedSymbols: [],
      riskNotes: [],
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(true);
  });

  it("validates valid citation", () => {
    const citation: any = {
      type: "file",
      ref: "src/file1.ts",
      note: "Reference note",
    };
    const result = CitationSchema.safeParse(citation);
    expect(result.success).toBe(true);
  });

  it("rejects response with refusal and proposedChanges", () => {
    const response = createValidResponse();
    response.output.refusal = { reason: "Cannot proceed" };
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("refusal"))).toBe(true);
    }
  });

  it("allows response with refusal and empty proposedChanges", () => {
    const response = createValidResponse();
    response.output.proposedChanges = [];
    response.output.refusal = { reason: "Cannot proceed" };
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it("rejects empty proposedChanges when no refusal", () => {
    const response = createValidResponse();
    response.output.proposedChanges = [];
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects empty citations", () => {
    const response = createValidResponse();
    response.output.citations = [];
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects changeType not in enum", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "invalid",
      targetPath: "src/file1.ts",
      patch: null,
      referencedDoDItems: ["dod-1"],
      referencedPlanStepIds: ["step-1"],
      referencedSymbols: [],
      riskNotes: [],
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it("allows no_change with null patch", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "no_change",
      targetPath: "src/file1.ts",
      patch: null,
      referencedDoDItems: ["dod-1"],
      referencedPlanStepIds: ["step-1"],
      referencedSymbols: [],
      riskNotes: [],
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(true);
  });

  it("rejects change with empty referencedDoDItems", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "edit_file",
      targetPath: "src/file1.ts",
      patch: "patch",
      referencedDoDItems: [],
      referencedPlanStepIds: ["step-1"],
      referencedSymbols: [],
      riskNotes: [],
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it("rejects change with empty referencedPlanStepIds", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "edit_file",
      targetPath: "src/file1.ts",
      patch: "patch",
      referencedDoDItems: ["dod-1"],
      referencedPlanStepIds: [],
      referencedSymbols: [],
      riskNotes: [],
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it("rejects citation type not in enum", () => {
    const citation: any = {
      type: "invalid",
      ref: "ref",
      note: "note",
    };
    const result = CitationSchema.safeParse(citation);
    expect(result.success).toBe(false);
  });

  it("rejects patch exceeding max length", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "edit_file",
      targetPath: "src/file1.ts",
      patch: "x".repeat(200001),
      referencedDoDItems: ["dod-1"],
      referencedPlanStepIds: ["step-1"],
      referencedSymbols: [],
      riskNotes: [],
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it("rejects too many riskNotes", () => {
    const change: any = {
      changeId: "change-1",
      changeType: "edit_file",
      targetPath: "src/file1.ts",
      patch: "patch",
      referencedDoDItems: ["dod-1"],
      referencedPlanStepIds: ["step-1"],
      referencedSymbols: [],
      riskNotes: Array(21).fill("note"),
    };
    const result = ChangeProposalSchema.safeParse(change);
    expect(result.success).toBe(false);
  });

  it("computes stable response hash", () => {
    const response = createValidResponse();
    const hash1 = computeResponseHash(response);
    const hash2 = computeResponseHash(response);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("response hash changes when content changes", () => {
    const response1 = createValidResponse();
    const response2 = createValidResponse();
    response2.output.summary = "Different summary";
    const hash1 = computeResponseHash(response1);
    const hash2 = computeResponseHash(response2);
    expect(hash1).not.toBe(hash2);
  });

  it("response hash excludes hash field", () => {
    const response1 = createValidResponse();
    const response2 = createValidResponse();
    response2.hash.responseHash = "different".repeat(8).slice(0, 64);
    const hash1 = computeResponseHash(response1);
    const hash2 = computeResponseHash(response2);
    expect(hash1).toBe(hash2); // Hash should be same because hash field is excluded
  });

  it("rejects invalid UUID formats", () => {
    const response = createValidResponse();
    response.sessionId = "not-a-uuid";
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects invalid ISO8601 datetime", () => {
    const response = createValidResponse();
    response.createdAt = "not-a-date";
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const response = createValidResponse();
    response.model.provider = "invalid" as any;
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects seed out of range", () => {
    const response = createValidResponse();
    response.model.seed = 2147483648; // > 2^31-1
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects summary exceeding max length", () => {
    const response = createValidResponse();
    response.output.summary = "x".repeat(5001);
    const result = ModelResponseArtifactSchema.safeParse(response);
    expect(result.success).toBe(false);
  });

  it("rejects citation note exceeding max length", () => {
    const citation: any = {
      type: "file",
      ref: "ref",
      note: "x".repeat(2001),
    };
    const result = CitationSchema.safeParse(citation);
    expect(result.success).toBe(false);
  });
});
