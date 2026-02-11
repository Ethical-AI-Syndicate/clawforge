import { describe, it, expect } from "vitest";
import { PromptCapsuleSchema, computeCapsuleHash } from "../src/session/prompt-capsule.js";
import { SessionError } from "../src/session/errors.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";

describe("prompt-capsule", () => {
  const createValidCapsule = (): any => ({
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: "123e4567-e89b-12d3-a456-426614174000",
    capsuleId: "223e4567-e89b-12d3-a456-426614174000",
    lockId: "323e4567-e89b-12d3-a456-426614174000",
    planHash: "a".repeat(64),
    createdAt: "2024-01-01T00:00:00.000Z",
    createdBy: {
      actorId: "test",
      actorType: "human" as const,
    },
    model: {
      provider: "openai" as const,
      modelId: "gpt-4",
      temperature: 0,
      topP: 1,
      seed: 42,
    },
    intent: {
      goalExcerpt: "Test goal excerpt",
      taskType: "code_change" as const,
      forbiddenBehaviors: ["no new files", "no execution", "no network"],
    },
    context: {
      systemPrompt: "You are a helpful assistant.",
      userPrompt: "Please make changes.",
      constraints: ["constraint1", "constraint2", "constraint3"],
    },
    boundaries: {
      allowedFiles: ["src/file1.ts", "src/file2.ts"],
      allowedSymbols: ["src/file1.ts#export1"],
      allowedDoDItems: ["dod-item-1"],
      allowedPlanStepIds: ["step-1"],
      allowedCapabilities: ["read_file"],
      disallowedPatterns: ["TODO", "FIXME", "TBD", "PLACEHOLDER", "XXX"],
      allowedExternalModules: ["lodash"],
    },
    inputs: {
      fileDigests: [
        { path: "src/file1.ts", sha256: "a".repeat(64) },
        { path: "src/file2.ts", sha256: "b".repeat(64) },
      ],
      partialCoverage: false,
    },
    hash: {
      capsuleHash: "c".repeat(64),
    },
  });

  it("validates valid capsule", () => {
    const capsule = createValidCapsule();
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(true);
  });

  it("rejects temperature != 0", () => {
    const capsule = createValidCapsule();
    capsule.model.temperature = 0.1;
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("temperature"))).toBe(true);
    }
  });

  it("rejects topP != 1", () => {
    const capsule = createValidCapsule();
    capsule.model.topP = 0.9;
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("topP"))).toBe(true);
    }
  });

  it("rejects missing seed", () => {
    const capsule = createValidCapsule();
    delete capsule.model.seed;
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects allowedFiles with '../'", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedFiles.push("../secrets.ts");
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes(".."))).toBe(true);
    }
  });

  it("rejects absolute paths in allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedFiles.push("/absolute/path.ts");
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("absolute"))).toBe(true);
    }
  });

  it("rejects backslashes in allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedFiles.push("src\\file.ts");
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("backslash"))).toBe(true);
    }
  });

  it("rejects duplicate allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedFiles.push("src/file1.ts");
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("duplicate"))).toBe(true);
    }
  });

  it("rejects empty strings in disallowedPatterns", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.disallowedPatterns.push("");
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects fileDigests with paths not in allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.inputs.fileDigests.push({ path: "src/unknown.ts", sha256: "c".repeat(64) });
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("subset"))).toBe(true);
    }
  });

  it("rejects partialCoverage=false when fileDigests don't cover all allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.inputs.fileDigests.pop(); // Remove one digest
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes("partialCoverage"))).toBe(true);
    }
  });

  it("allows partialCoverage=true when fileDigests don't cover all allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.inputs.fileDigests.pop();
    capsule.inputs.partialCoverage = true;
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(true);
  });

  it("computes stable capsule hash", () => {
    const capsule = createValidCapsule();
    const hash1 = computeCapsuleHash(capsule);
    const hash2 = computeCapsuleHash(capsule);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("capsule hash changes when content changes", () => {
    const capsule1 = createValidCapsule();
    const capsule2 = createValidCapsule();
    capsule2.intent.goalExcerpt = "Different goal";
    const hash1 = computeCapsuleHash(capsule1);
    const hash2 = computeCapsuleHash(capsule2);
    expect(hash1).not.toBe(hash2);
  });

  it("capsule hash excludes hash field", () => {
    const capsule1 = createValidCapsule();
    const capsule2 = createValidCapsule();
    capsule2.hash.capsuleHash = "different".repeat(8).slice(0, 64);
    const hash1 = computeCapsuleHash(capsule1);
    const hash2 = computeCapsuleHash(capsule2);
    expect(hash1).toBe(hash2); // Hash should be same because hash field is excluded
  });

  it("rejects invalid sha256 in fileDigests", () => {
    const capsule = createValidCapsule();
    capsule.inputs.fileDigests[0].sha256 = "invalid";
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects invalid UUID formats", () => {
    const capsule = createValidCapsule();
    capsule.sessionId = "not-a-uuid";
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects invalid ISO8601 datetime", () => {
    const capsule = createValidCapsule();
    capsule.createdAt = "not-a-date";
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects invalid taskType", () => {
    const capsule = createValidCapsule();
    capsule.intent.taskType = "invalid" as any;
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider", () => {
    const capsule = createValidCapsule();
    capsule.model.provider = "invalid" as any;
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects seed out of range", () => {
    const capsule = createValidCapsule();
    capsule.model.seed = 2147483648; // > 2^31-1
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects too few forbiddenBehaviors", () => {
    const capsule = createValidCapsule();
    capsule.intent.forbiddenBehaviors = ["only one"];
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects too few constraints", () => {
    const capsule = createValidCapsule();
    capsule.context.constraints = ["only one"];
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects too few disallowedPatterns", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.disallowedPatterns = ["only one"];
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects empty allowedFiles", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedFiles = [];
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects empty allowedDoDItems", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedDoDItems = [];
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });

  it("rejects empty allowedPlanStepIds", () => {
    const capsule = createValidCapsule();
    capsule.boundaries.allowedPlanStepIds = [];
    const result = PromptCapsuleSchema.safeParse(capsule);
    expect(result.success).toBe(false);
  });
});
