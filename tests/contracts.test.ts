import { describe, it, expect } from "vitest";
import {
  IntentContractSchema,
  StepContractSchema,
  WorkerTaskContractSchema,
} from "../src/contracts/schemas.js";
import {
  parseSemver,
  isSupportedSchemaVersion,
  redactSensitive,
} from "../src/contracts/validation.js";
import { migrate, getMigration } from "../src/contracts/migration.js";

// ---------------------------------------------------------------------------
// Fixtures — valid contracts
// ---------------------------------------------------------------------------

const VALID_INTENT = {
  schemaVersion: "1.0.0",
  intentId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  title: "Test Intent",
  description: "A test intent for validation",
  actor: { actorId: "user-001", actorType: "human" as const },
  constraints: { maxSteps: 10, timeoutMs: 60000, providers: [] as string[] },
  inputParams: {} as Record<string, unknown>,
  tags: ["test"],
  createdAt: "2026-02-09T12:00:00.000Z",
};

const VALID_STEP = {
  schemaVersion: "1.0.0",
  stepId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  intentId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  stepIndex: 0,
  name: "Test Step",
  description: "A test step",
  toolName: "test-tool",
  toolParams: {} as Record<string, unknown>,
  expectedOutputSchema: null,
  requiresApproval: false,
  retryPolicy: { maxRetries: 3, backoffMs: 1000 },
  dependsOn: [] as string[],
  createdAt: "2026-02-09T12:00:00.000Z",
};

const VALID_TASK = {
  schemaVersion: "1.0.0",
  taskId: "c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f",
  stepId: "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e",
  runId: "d4e5f6a7-b8c9-4d0e-af1f-3a4b5c6d7e8f",
  workerType: "code-gen",
  instructions: "Generate a hello world program",
  inputRefs: [] as string[],
  constraints: {
    maxDurationMs: 30000,
    maxOutputBytes: 1048576,
    sandboxed: true,
  },
  outputSchema: null,
  createdAt: "2026-02-09T12:00:00.000Z",
};

// ===================================================================
// IntentContract
// ===================================================================

describe("IntentContractSchema", () => {
  it("accepts a valid intent contract", () => {
    const result = IntentContractSchema.safeParse(VALID_INTENT);
    expect(result.success).toBe(true);
  });

  it("rejects unsupported major version 2", () => {
    const result = IntentContractSchema.safeParse({
      ...VALID_INTENT,
      schemaVersion: "2.0.0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported major version 0", () => {
    const result = IntentContractSchema.safeParse({
      ...VALID_INTENT,
      schemaVersion: "0.9.0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-semver schemaVersion", () => {
    const result = IntentContractSchema.safeParse({
      ...VALID_INTENT,
      schemaVersion: "latest",
    });
    expect(result.success).toBe(false);
  });

  it("accepts minor version bumps within major 1", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        schemaVersion: "1.5.3",
      }).success,
    ).toBe(true);
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        schemaVersion: "1.99.0",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid UUID for intentId", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        intentId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejects UUID v1 (version digit != 4)", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        intentId: "550e8400-e29b-11d4-a716-446655440000",
      }).success,
    ).toBe(false);
  });

  it("rejects title > 500 chars", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        title: "x".repeat(501),
      }).success,
    ).toBe(false);
  });

  it("rejects empty title", () => {
    expect(
      IntentContractSchema.safeParse({ ...VALID_INTENT, title: "" }).success,
    ).toBe(false);
  });

  it("accepts empty description", () => {
    expect(
      IntentContractSchema.safeParse({ ...VALID_INTENT, description: "" })
        .success,
    ).toBe(true);
  });

  it("rejects description > 5000 chars", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        description: "d".repeat(5001),
      }).success,
    ).toBe(false);
  });

  it("rejects maxSteps < 1", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        constraints: { ...VALID_INTENT.constraints, maxSteps: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects maxSteps > 1000", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        constraints: { ...VALID_INTENT.constraints, maxSteps: 1001 },
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer maxSteps", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        constraints: { ...VALID_INTENT.constraints, maxSteps: 5.5 },
      }).success,
    ).toBe(false);
  });

  it("rejects > 20 providers", () => {
    const providers = Array.from({ length: 21 }, (_, i) => `prov-${i}`);
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        constraints: { ...VALID_INTENT.constraints, providers },
      }).success,
    ).toBe(false);
  });

  it("rejects > 50 inputParams keys", () => {
    const params: Record<string, string> = {};
    for (let i = 0; i < 51; i++) params[`k${i}`] = "v";
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        inputParams: params,
      }).success,
    ).toBe(false);
  });

  it("rejects inputParams key > 200 chars", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        inputParams: { ["k".repeat(201)]: "v" },
      }).success,
    ).toBe(false);
  });

  it("rejects > 20 tags", () => {
    const tags = Array.from({ length: 21 }, (_, i) => `t${i}`);
    expect(
      IntentContractSchema.safeParse({ ...VALID_INTENT, tags }).success,
    ).toBe(false);
  });

  it("rejects tag > 100 chars", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        tags: ["x".repeat(101)],
      }).success,
    ).toBe(false);
  });

  it("rejects invalid createdAt", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        createdAt: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("rejects createdAt without Z suffix", () => {
    expect(
      IntentContractSchema.safeParse({
        ...VALID_INTENT,
        createdAt: "2026-02-09T12:00:00.000+05:00",
      }).success,
    ).toBe(false);
  });

  it("preserves unknown fields (forward compatibility)", () => {
    const input = { ...VALID_INTENT, futureField: "from-v1.1.0" };
    const result = IntentContractSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["futureField"]).toBe(
        "from-v1.1.0",
      );
    }
  });
});

// ===================================================================
// StepContract
// ===================================================================

describe("StepContractSchema", () => {
  it("accepts a valid step contract", () => {
    expect(StepContractSchema.safeParse(VALID_STEP).success).toBe(true);
  });

  it("rejects unsupported major version", () => {
    expect(
      StepContractSchema.safeParse({
        ...VALID_STEP,
        schemaVersion: "3.0.0",
      }).success,
    ).toBe(false);
  });

  it("rejects negative stepIndex", () => {
    expect(
      StepContractSchema.safeParse({ ...VALID_STEP, stepIndex: -1 }).success,
    ).toBe(false);
  });

  it("rejects stepIndex > 999", () => {
    expect(
      StepContractSchema.safeParse({ ...VALID_STEP, stepIndex: 1000 }).success,
    ).toBe(false);
  });

  it("rejects empty name", () => {
    expect(
      StepContractSchema.safeParse({ ...VALID_STEP, name: "" }).success,
    ).toBe(false);
  });

  it("rejects maxRetries > 10", () => {
    expect(
      StepContractSchema.safeParse({
        ...VALID_STEP,
        retryPolicy: { maxRetries: 11, backoffMs: 1000 },
      }).success,
    ).toBe(false);
  });

  it("rejects backoffMs < 100", () => {
    expect(
      StepContractSchema.safeParse({
        ...VALID_STEP,
        retryPolicy: { maxRetries: 1, backoffMs: 50 },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid UUID in dependsOn", () => {
    expect(
      StepContractSchema.safeParse({
        ...VALID_STEP,
        dependsOn: ["not-uuid"],
      }).success,
    ).toBe(false);
  });

  it("rejects empty expectedOutputSchema object", () => {
    expect(
      StepContractSchema.safeParse({
        ...VALID_STEP,
        expectedOutputSchema: {},
      }).success,
    ).toBe(false);
  });

  it("accepts non-empty expectedOutputSchema", () => {
    expect(
      StepContractSchema.safeParse({
        ...VALID_STEP,
        expectedOutputSchema: { type: "string" },
      }).success,
    ).toBe(true);
  });

  it("preserves unknown fields", () => {
    const result = StepContractSchema.safeParse({
      ...VALID_STEP,
      newField: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["newField"]).toBe(42);
    }
  });
});

// ===================================================================
// WorkerTaskContract
// ===================================================================

describe("WorkerTaskContractSchema", () => {
  it("accepts a valid worker task contract", () => {
    expect(WorkerTaskContractSchema.safeParse(VALID_TASK).success).toBe(true);
  });

  it("rejects unsupported major version", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        schemaVersion: "2.1.0",
      }).success,
    ).toBe(false);
  });

  it("rejects workerType with spaces", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        workerType: "invalid type",
      }).success,
    ).toBe(false);
  });

  it("accepts workerType with dots, dashes, underscores", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        workerType: "code-gen.v2_beta",
      }).success,
    ).toBe(true);
  });

  it("rejects empty workerType", () => {
    expect(
      WorkerTaskContractSchema.safeParse({ ...VALID_TASK, workerType: "" })
        .success,
    ).toBe(false);
  });

  it("rejects instructions > 10000 chars", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        instructions: "i".repeat(10001),
      }).success,
    ).toBe(false);
  });

  it("accepts empty instructions", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        instructions: "",
      }).success,
    ).toBe(true);
  });

  it("rejects maxDurationMs < 1", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        constraints: { ...VALID_TASK.constraints, maxDurationMs: 0 },
      }).success,
    ).toBe(false);
  });

  it("rejects maxOutputBytes > 100 MB", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        constraints: {
          ...VALID_TASK.constraints,
          maxOutputBytes: 104_857_601,
        },
      }).success,
    ).toBe(false);
  });

  it("rejects empty outputSchema object", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        outputSchema: {},
      }).success,
    ).toBe(false);
  });

  it("accepts non-empty outputSchema", () => {
    expect(
      WorkerTaskContractSchema.safeParse({
        ...VALID_TASK,
        outputSchema: { type: "object", properties: {} },
      }).success,
    ).toBe(true);
  });

  it("rejects > 100 inputRefs", () => {
    const inputRefs = Array.from({ length: 101 }, (_, i) => `ref-${i}`);
    expect(
      WorkerTaskContractSchema.safeParse({ ...VALID_TASK, inputRefs }).success,
    ).toBe(false);
  });

  it("preserves unknown fields", () => {
    const result = WorkerTaskContractSchema.safeParse({
      ...VALID_TASK,
      extra: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["extra"]).toBe(true);
    }
  });
});

// ===================================================================
// parseSemver
// ===================================================================

describe("parseSemver", () => {
  it("parses valid semver strings", () => {
    expect(parseSemver("1.0.0")).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(parseSemver("2.13.4")).toEqual({ major: 2, minor: 13, patch: 4 });
    expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
  });

  it("returns null for invalid strings", () => {
    expect(parseSemver("not-semver")).toBeNull();
    expect(parseSemver("1.0")).toBeNull();
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("1.0.0-beta")).toBeNull(); // pre-release not supported
    expect(parseSemver("v1.0.0")).toBeNull(); // no leading v
  });
});

// ===================================================================
// isSupportedSchemaVersion
// ===================================================================

describe("isSupportedSchemaVersion", () => {
  it("returns true for major version 1", () => {
    expect(isSupportedSchemaVersion("1.0.0")).toBe(true);
    expect(isSupportedSchemaVersion("1.99.12")).toBe(true);
  });

  it("returns false for major version 0", () => {
    expect(isSupportedSchemaVersion("0.1.0")).toBe(false);
  });

  it("returns false for major version 2+", () => {
    expect(isSupportedSchemaVersion("2.0.0")).toBe(false);
    expect(isSupportedSchemaVersion("10.0.0")).toBe(false);
  });

  it("returns false for garbage input", () => {
    expect(isSupportedSchemaVersion("foo")).toBe(false);
  });
});

// ===================================================================
// redactSensitive
// ===================================================================

describe("redactSensitive", () => {
  it("redacts values with sensitive prefixes", () => {
    expect(redactSensitive("sk-abc123")).toBe("[REDACTED]");
    expect(redactSensitive("ghp_xxxxxxxxxxxxxxxxxxxx")).toBe("[REDACTED]");
    expect(redactSensitive("bearer token123")).toBe("[REDACTED]");
    expect(redactSensitive("AKIAIOSFODNN7EXAMPLE")).toBe("[REDACTED]");
    expect(redactSensitive("pk-live_abc")).toBe("[REDACTED]");
    expect(redactSensitive("gho_something")).toBe("[REDACTED]");
    expect(redactSensitive("token-xyz")).toBe("[REDACTED]");
    expect(redactSensitive("key-abc")).toBe("[REDACTED]");
  });

  it("does not redact normal short strings", () => {
    expect(redactSensitive("hello world")).toBe("hello world");
    expect(redactSensitive("just a normal string")).toBe(
      "just a normal string",
    );
    expect(redactSensitive("")).toBe("");
  });

  it("redacts values under sensitive keys in objects", () => {
    const result = redactSensitive({
      password: "secret123",
      name: "Alice",
    }) as Record<string, unknown>;
    expect(result["password"]).toBe("[REDACTED]");
    expect(result["name"]).toBe("Alice");
  });

  it("redacts case-insensitively for key names", () => {
    const result = redactSensitive({
      PASSWORD: "x",
      ApiKey: "y",
      Authorization: "z",
      api_key: "w",
    }) as Record<string, unknown>;
    expect(result["PASSWORD"]).toBe("[REDACTED]");
    expect(result["ApiKey"]).toBe("[REDACTED]");
    expect(result["Authorization"]).toBe("[REDACTED]");
    expect(result["api_key"]).toBe("[REDACTED]");
  });

  it("redacts recursively in nested objects", () => {
    const result = redactSensitive({
      outer: { apiKey: "mykey", data: "safe" },
    }) as Record<string, unknown>;
    const outer = result["outer"] as Record<string, unknown>;
    expect(outer["apiKey"]).toBe("[REDACTED]");
    expect(outer["data"]).toBe("safe");
  });

  it("redacts in arrays", () => {
    const result = redactSensitive(["normal", "sk-secret"]) as string[];
    expect(result[0]).toBe("normal");
    expect(result[1]).toBe("[REDACTED]");
  });

  it("applies custom patterns", () => {
    expect(redactSensitive("custom-secret-value", [/^custom-/])).toBe(
      "[REDACTED]",
    );
  });

  it("preserves non-string primitives", () => {
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(true)).toBe(true);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  it("does not mutate input", () => {
    const input = { password: "secret", name: "Alice" };
    redactSensitive(input);
    expect(input.password).toBe("secret");
  });

  it("redacts base64-like high-entropy strings (40+ chars)", () => {
    const key = "aB3dE6gH9jK2mN5pQ8sT1uW4xY7zA0cF3hI6kL8nO1q";
    expect(redactSensitive(key)).toBe("[REDACTED]");
  });

  it("does not redact short alphanumeric strings", () => {
    expect(redactSensitive("shortValue123")).toBe("shortValue123");
  });
});

// ===================================================================
// Migration
// ===================================================================

describe("migration", () => {
  it("migrates IntentContract 1.0.0 → 1.1.0 (adds default priority)", () => {
    const result = migrate("IntentContract", "1.0.0", "1.1.0", {
      ...VALID_INTENT,
    });
    expect(result["schemaVersion"]).toBe("1.1.0");
    expect(result["priority"]).toBe("normal");
  });

  it("preserves existing priority during migration", () => {
    const result = migrate("IntentContract", "1.0.0", "1.1.0", {
      ...VALID_INTENT,
      priority: "high",
    });
    expect(result["priority"]).toBe("high");
  });

  it("preserves all original fields during migration", () => {
    const result = migrate("IntentContract", "1.0.0", "1.1.0", {
      ...VALID_INTENT,
    });
    expect(result["intentId"]).toBe(VALID_INTENT.intentId);
    expect(result["title"]).toBe(VALID_INTENT.title);
  });

  it("getMigration returns undefined for unknown migration", () => {
    expect(getMigration("IntentContract", "1.0.0", "3.0.0")).toBeUndefined();
  });

  it("migrate throws for unknown migration", () => {
    expect(() =>
      migrate("StepContract", "1.0.0", "2.0.0", { ...VALID_STEP }),
    ).toThrow("No migration registered");
  });
});
