import { describe, it, expect } from "vitest";
import {
  SESSION_SCHEMA_VERSION,
  DoDItemSchema,
  DefinitionOfDoneSchema,
  DecisionLockSchema,
  ExecutionGateResultSchema,
  GateCheckSchema,
} from "../src/session/schemas.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const DOD_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const LOCK_ID = "c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f";
const CREATED_AT = "2026-02-10T12:00:00.000Z";
const ACTOR = { actorId: "user-001", actorType: "human" as const };

const VALID_ITEM_COMMAND_EXIT = {
  id: "tests-pass",
  description: "All unit tests pass with exit code 0",
  verificationMethod: "command_exit_code" as const,
  verificationCommand: "pnpm test",
  expectedExitCode: 0,
  notDoneConditions: ["Any test fails"],
};

const VALID_ITEM_FILE_EXISTS = {
  id: "config-exists",
  description: "Configuration file exists at expected path",
  verificationMethod: "file_exists" as const,
  targetPath: "/etc/app/config.json",
  notDoneConditions: ["File is missing"],
};

const VALID_ITEM_FILE_HASH = {
  id: "binary-matches",
  description: "Built binary matches expected SHA-256 hash",
  verificationMethod: "file_hash_match" as const,
  targetPath: "/dist/app.js",
  expectedHash: "a".repeat(64),
  notDoneConditions: ["Hash mismatch"],
};

const VALID_ITEM_COMMAND_OUTPUT = {
  id: "version-output",
  description: "CLI version output contains expected version string",
  verificationMethod: "command_output_match" as const,
  verificationCommand: "app --version",
  expectedOutput: "1.0.0",
  notDoneConditions: ["Wrong version"],
};

const VALID_ITEM_ARTIFACT = {
  id: "evidence-recorded",
  description: "Deployment manifest recorded as artifact in event store",
  verificationMethod: "artifact_recorded" as const,
  notDoneConditions: ["No artifact event found"],
};

const VALID_ITEM_CUSTOM = {
  id: "ux-review-complete",
  description: "UX review completed by design team",
  verificationMethod: "custom" as const,
  verificationProcedure:
    "Open the staging environment at https://staging.app.com, navigate to the login page, " +
    "verify the new password reset flow matches the approved mockup in Figma file XYZ-123.",
  notDoneConditions: ["Design team has not signed off"],
};

const VALID_DOD = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  dodId: DOD_ID,
  sessionId: SESSION_ID,
  title: "Add user authentication endpoint",
  items: [VALID_ITEM_COMMAND_EXIT, VALID_ITEM_FILE_EXISTS],
  createdAt: CREATED_AT,
  createdBy: ACTOR,
};

const VALID_LOCK_DRAFT = {
  schemaVersion: SESSION_SCHEMA_VERSION,
  lockId: LOCK_ID,
  sessionId: SESSION_ID,
  dodId: DOD_ID,
  goal: "Implement POST /api/auth/login endpoint with JWT authentication",
  nonGoals: ["OAuth2 integration", "Password reset flow"],
  interfaces: [
    {
      name: "POST /api/auth/login",
      description: "Accepts credentials, returns JWT token",
      type: "api" as const,
    },
  ],
  invariants: [
    "Passwords are never stored in plaintext",
    "JWT tokens expire after 24 hours",
  ],
  constraints: ["Must use existing bcrypt dependency"],
  failureModes: [
    {
      description: "Invalid credentials return 401",
      mitigation: "Standard HTTP error response with no credential hints",
    },
  ],
  risksAndTradeoffs: [
    {
      description: "JWT in localStorage is vulnerable to XSS",
      severity: "medium" as const,
      accepted: true,
    },
  ],
  status: "draft" as const,
  createdAt: CREATED_AT,
  createdBy: ACTOR,
};

const VALID_LOCK_APPROVED = {
  ...VALID_LOCK_DRAFT,
  status: "approved" as const,
  approvalMetadata: {
    approvedBy: "mike",
    approvedAt: CREATED_AT,
    approvalMethod: "cli-approve",
  },
};

// ===================================================================
// DoDItemSchema
// ===================================================================

describe("DoDItemSchema", () => {
  it("accepts valid item with command_exit_code", () => {
    const result = DoDItemSchema.safeParse(VALID_ITEM_COMMAND_EXIT);
    expect(result.success).toBe(true);
  });

  it("accepts valid item with file_exists", () => {
    const result = DoDItemSchema.safeParse(VALID_ITEM_FILE_EXISTS);
    expect(result.success).toBe(true);
  });

  it("accepts valid item with file_hash_match", () => {
    const result = DoDItemSchema.safeParse(VALID_ITEM_FILE_HASH);
    expect(result.success).toBe(true);
  });

  it("accepts valid item with command_output_match", () => {
    const result = DoDItemSchema.safeParse(VALID_ITEM_COMMAND_OUTPUT);
    expect(result.success).toBe(true);
  });

  it("accepts valid item with artifact_recorded", () => {
    const result = DoDItemSchema.safeParse(VALID_ITEM_ARTIFACT);
    expect(result.success).toBe(true);
  });

  it("accepts valid item with custom verification", () => {
    const result = DoDItemSchema.safeParse(VALID_ITEM_CUSTOM);
    expect(result.success).toBe(true);
  });

  it("preserves unknown fields (.passthrough())", () => {
    const result = DoDItemSchema.safeParse({
      ...VALID_ITEM_COMMAND_EXIT,
      futureField: "hello",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["futureField"]).toBe(
        "hello",
      );
    }
  });
});

// ===================================================================
// DefinitionOfDoneSchema
// ===================================================================

describe("DefinitionOfDoneSchema", () => {
  it("accepts valid DoD with multiple items", () => {
    const result = DefinitionOfDoneSchema.safeParse(VALID_DOD);
    expect(result.success).toBe(true);
  });

  it("rejects DoD with no items", () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects DoD with vague description "works as expected"', () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      items: [
        {
          ...VALID_ITEM_COMMAND_EXIT,
          description: "The feature works as expected",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects DoD with vague description "should be fine"', () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      items: [
        {
          ...VALID_ITEM_COMMAND_EXIT,
          description: "This should be fine for production",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects DoD with vague description "seems correct"', () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      items: [
        {
          ...VALID_ITEM_COMMAND_EXIT,
          description: "The output seems correct",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects DoD with vague description "looks good"', () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      items: [
        {
          ...VALID_ITEM_COMMAND_EXIT,
          description: "Everything looks good",
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects DoD with missing dodId", () => {
    const { dodId: _, ...noDodId } = VALID_DOD;
    const result = DefinitionOfDoneSchema.safeParse(noDodId);
    expect(result.success).toBe(false);
  });

  it("rejects DoD with missing sessionId", () => {
    const { sessionId: _, ...noSessionId } = VALID_DOD;
    const result = DefinitionOfDoneSchema.safeParse(noSessionId);
    expect(result.success).toBe(false);
  });

  it("rejects DoD with invalid createdAt", () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      createdAt: "not-a-date",
    });
    expect(result.success).toBe(false);
  });

  it("preserves unknown fields (.passthrough())", () => {
    const result = DefinitionOfDoneSchema.safeParse({
      ...VALID_DOD,
      futureField: 42,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)["futureField"]).toBe(42);
    }
  });
});

// ===================================================================
// DecisionLockSchema
// ===================================================================

describe("DecisionLockSchema", () => {
  it("accepts valid lock in draft status", () => {
    const result = DecisionLockSchema.safeParse(VALID_LOCK_DRAFT);
    expect(result.success).toBe(true);
  });

  it("accepts valid lock in approved status with approvalMetadata", () => {
    const result = DecisionLockSchema.safeParse(VALID_LOCK_APPROVED);
    expect(result.success).toBe(true);
  });

  it("rejects approved lock without approvalMetadata", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      status: "approved",
      // no approvalMetadata
    });
    expect(result.success).toBe(false);
  });

  it("rejects lock with empty goal", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      goal: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects lock with empty nonGoals", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      nonGoals: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects lock with empty invariants", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      invariants: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects lock with invalid dodId", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      dodId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects lock with invalid status value", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      status: "pending",
    });
    expect(result.success).toBe(false);
  });

  it("preserves unknown fields (.passthrough())", () => {
    const result = DecisionLockSchema.safeParse({
      ...VALID_LOCK_DRAFT,
      customExtension: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>)["customExtension"],
      ).toBe(true);
    }
  });
});

// ===================================================================
// ExecutionGateResultSchema
// ===================================================================

describe("ExecutionGateResultSchema", () => {
  it("accepts valid result with all checks passed", () => {
    const result = ExecutionGateResultSchema.safeParse({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      passed: true,
      checks: [
        { checkId: "dod-exists", description: "DoD exists", passed: true },
      ],
      evaluatedAt: CREATED_AT,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid result with some checks failed", () => {
    const result = ExecutionGateResultSchema.safeParse({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      passed: false,
      checks: [
        { checkId: "dod-exists", description: "DoD exists", passed: true },
        {
          checkId: "lock-approved",
          description: "Lock approved",
          passed: false,
          failureReason: "Lock status is draft",
        },
      ],
      evaluatedAt: CREATED_AT,
    });
    expect(result.success).toBe(true);
  });

  it("rejects result with no checks", () => {
    const result = ExecutionGateResultSchema.safeParse({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      passed: true,
      checks: [],
      evaluatedAt: CREATED_AT,
    });
    expect(result.success).toBe(false);
  });

  it("preserves unknown fields (.passthrough())", () => {
    const result = ExecutionGateResultSchema.safeParse({
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: SESSION_ID,
      passed: true,
      checks: [
        { checkId: "test", description: "Test check", passed: true },
      ],
      evaluatedAt: CREATED_AT,
      futureField: "preserved",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>)["futureField"],
      ).toBe("preserved");
    }
  });
});
