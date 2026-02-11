import { describe, it, expect } from "vitest";
import { evaluateExecutionGate } from "../src/session/gate.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type {
  DefinitionOfDone,
  DecisionLock,
} from "../src/session/schemas.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const DOD_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const LOCK_ID = "c3d4e5f6-a7b8-4c9d-ae1f-2a3b4c5d6e7f";
const CREATED_AT = "2026-02-10T12:00:00.000Z";
const ACTOR = { actorId: "user-001", actorType: "human" as const };

function validDoD(overrides?: Partial<DefinitionOfDone>): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: DOD_ID,
    sessionId: SESSION_ID,
    title: "Implement auth endpoint",
    items: [
      {
        id: "tests-pass",
        description: "All unit tests pass with exit code 0",
        verificationMethod: "command_exit_code",
        verificationCommand: "pnpm test",
        expectedExitCode: 0,
        notDoneConditions: ["Any test fails"],
      },
    ],
    createdAt: CREATED_AT,
    createdBy: ACTOR,
    ...overrides,
  } as DefinitionOfDone;
}

function validLock(overrides?: Partial<DecisionLock>): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: LOCK_ID,
    sessionId: SESSION_ID,
    dodId: DOD_ID,
    goal: "Implement POST /api/auth/login endpoint with JWT",
    nonGoals: ["OAuth2 integration"],
    interfaces: [
      {
        name: "POST /api/auth/login",
        description: "Accepts credentials, returns JWT",
        type: "api",
      },
    ],
    invariants: ["Passwords never stored in plaintext"],
    constraints: ["Must use existing bcrypt dependency"],
    failureModes: [
      {
        description: "Invalid credentials",
        mitigation: "Return 401 with no hints",
      },
    ],
    risksAndTradeoffs: [
      {
        description: "JWT in localStorage vulnerable to XSS",
        severity: "medium",
        accepted: true,
      },
    ],
    status: "approved",
    approvalMetadata: {
      approvedBy: "mike",
      approvedAt: CREATED_AT,
      approvalMethod: "cli-approve",
    },
    createdAt: CREATED_AT,
    createdBy: ACTOR,
    ...overrides,
  } as DecisionLock;
}

// ---------------------------------------------------------------------------
// Helper to find a check by ID
// ---------------------------------------------------------------------------

function findCheck(
  result: ReturnType<typeof evaluateExecutionGate>,
  checkId: string,
) {
  return result.checks.find((c) => c.checkId === checkId);
}

function findCheckPrefix(
  result: ReturnType<typeof evaluateExecutionGate>,
  prefix: string,
) {
  return result.checks.filter((c) => c.checkId.startsWith(prefix));
}

// ===================================================================
// evaluateExecutionGate
// ===================================================================

describe("evaluateExecutionGate", () => {
  // --- Happy path ---

  it("passes for a fully valid DoD + approved Lock", () => {
    const result = evaluateExecutionGate(validDoD(), validLock());
    expect(result.passed).toBe(true);
    expect(result.checks.every((c) => c.passed)).toBe(true);
  });

  // --- DoD existence and structure ---

  it("fails when DoD is null", () => {
    const result = evaluateExecutionGate(null, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-exists")?.passed).toBe(false);
  });

  it("fails when DoD has no items", () => {
    const result = evaluateExecutionGate(
      validDoD({ items: [] }),
      validLock(),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-has-items")?.passed).toBe(false);
  });

  // --- DoD item verifiability: command_exit_code ---

  it("fails when DoD item lacks verificationCommand (command_exit_code)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing command",
          verificationMethod: "command_exit_code",
          expectedExitCode: 0,
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-item-verifiable-bad-item")?.passed).toBe(
      false,
    );
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("verificationCommand");
  });

  it("fails when DoD item lacks expectedExitCode (command_exit_code)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing exit code",
          verificationMethod: "command_exit_code",
          verificationCommand: "pnpm test",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-item-verifiable-bad-item")?.passed).toBe(
      false,
    );
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("expectedExitCode");
  });

  // --- DoD item verifiability: file_exists ---

  it("fails when DoD item lacks targetPath (file_exists)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing target path",
          verificationMethod: "file_exists",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("targetPath");
  });

  // --- DoD item verifiability: file_hash_match ---

  it("fails when DoD item lacks targetPath (file_hash_match)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing target path for hash",
          verificationMethod: "file_hash_match",
          expectedHash: "a".repeat(64),
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("targetPath");
  });

  it("fails when DoD item lacks expectedHash (file_hash_match)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing hash",
          verificationMethod: "file_hash_match",
          targetPath: "/dist/app.js",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("expectedHash");
  });

  // --- DoD item verifiability: command_output_match ---

  it("fails when DoD item lacks verificationCommand (command_output_match)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing command for output match",
          verificationMethod: "command_output_match",
          expectedOutput: "1.0.0",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("verificationCommand");
  });

  it("fails when DoD item lacks expectedOutput (command_output_match)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-item",
          description: "Missing expected output",
          verificationMethod: "command_output_match",
          verificationCommand: "app --version",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-item")?.failureReason,
    ).toContain("expectedOutput");
  });

  // --- DoD item verifiability: custom ---

  it("fails when custom item missing verificationProcedure field", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-custom",
          description: "Custom verification with no procedure",
          verificationMethod: "custom",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-custom")?.failureReason,
    ).toContain("verificationProcedure");
  });

  it("fails when custom item verificationProcedure is too short (< 20 chars)", () => {
    const dod = validDoD({
      items: [
        {
          id: "bad-custom",
          description: "Custom verification with short procedure",
          verificationMethod: "custom",
          verificationProcedure: "Check it",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(
      findCheck(result, "dod-item-verifiable-bad-custom")?.failureReason,
    ).toContain("at least 20 characters");
  });

  // --- Lock existence and status ---

  it("fails when Lock is null", () => {
    const result = evaluateExecutionGate(validDoD(), null);
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-exists")?.passed).toBe(false);
  });

  it('fails when Lock status is "draft"', () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ status: "draft", approvalMetadata: undefined }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-approved")?.passed).toBe(false);
    expect(findCheck(result, "lock-approved")?.failureReason).toContain(
      "draft",
    );
  });

  it('fails when Lock status is "rejected"', () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ status: "rejected", approvalMetadata: undefined }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-approved")?.passed).toBe(false);
    expect(findCheck(result, "lock-approved")?.failureReason).toContain(
      "rejected",
    );
  });

  // --- Lock references DoD ---

  it("fails when Lock dodId does not match DoD dodId", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ dodId: "d4e5f6a7-b8c9-4d0e-af1f-3a4b5c6d7e8f" }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-references-dod")?.passed).toBe(false);
    expect(
      findCheck(result, "lock-references-dod")?.failureReason,
    ).toContain("does not match");
  });

  // --- Lock required sections ---

  it("fails when Lock goal is empty", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ goal: "" }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-goal-present")?.passed).toBe(false);
  });

  it("fails when Lock nonGoals is empty", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ nonGoals: [] }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-non-goals-present")?.passed).toBe(false);
  });

  it("fails when Lock invariants is empty", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ invariants: [] }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-invariants-present")?.passed).toBe(false);
  });

  // --- Placeholder detection in Lock ---

  it("fails when Lock contains TODO", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ goal: "TODO: define the real goal" }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-no-todo")?.passed).toBe(false);
  });

  it("fails when Lock contains FIXME", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({
        invariants: ["FIXME: determine actual invariant"],
      }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-no-fixme")?.passed).toBe(false);
  });

  it("fails when Lock contains TBD", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ nonGoals: ["TBD"] }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-no-tbd")?.passed).toBe(false);
  });

  it("fails when Lock contains PLACEHOLDER", () => {
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ constraints: ["PLACEHOLDER constraint"] }),
    );
    expect(result.passed).toBe(false);
    expect(findCheck(result, "lock-no-placeholder")?.passed).toBe(false);
  });

  // --- Placeholder detection in DoD ---

  it("fails when DoD contains TODO", () => {
    const dod = validDoD({
      items: [
        {
          id: "todo-item",
          description: "TODO: write a real description",
          verificationMethod: "command_exit_code",
          verificationCommand: "pnpm test",
          expectedExitCode: 0,
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-no-todo")?.passed).toBe(false);
  });

  it("fails when DoD contains FIXME", () => {
    const dod = validDoD({
      title: "FIXME: real title needed",
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-no-fixme")?.passed).toBe(false);
  });

  // --- Completeness: all checks evaluated even after first failure ---

  it("evaluates ALL checks even after first failure", () => {
    // Both DoD and Lock have problems
    const result = evaluateExecutionGate(
      validDoD({ items: [] }), // fails dod-has-items
      validLock({ status: "draft", approvalMetadata: undefined }), // fails lock-approved
    );
    expect(result.passed).toBe(false);

    // Both checks should be present and evaluated
    const dodItems = findCheck(result, "dod-has-items");
    const lockApproved = findCheck(result, "lock-approved");
    expect(dodItems).toBeDefined();
    expect(lockApproved).toBeDefined();
    expect(dodItems?.passed).toBe(false);
    expect(lockApproved?.passed).toBe(false);
  });

  it("returns structured failureReason for each failing check", () => {
    const result = evaluateExecutionGate(null, null);
    expect(result.passed).toBe(false);

    const failedChecks = result.checks.filter((c) => !c.passed);
    expect(failedChecks.length).toBeGreaterThan(0);

    // Every failed check must have a failureReason string
    for (const check of failedChecks) {
      expect(check.failureReason).toBeDefined();
      expect(typeof check.failureReason).toBe("string");
      expect(check.failureReason!.length).toBeGreaterThan(0);
    }
  });

  it("passed is false if any single check fails", () => {
    // Only one thing wrong: Lock dodId mismatch
    const result = evaluateExecutionGate(
      validDoD(),
      validLock({ dodId: "d4e5f6a7-b8c9-4d0e-af1f-3a4b5c6d7e8f" }),
    );
    expect(result.passed).toBe(false);

    // Most checks should pass, but the overall result is false
    const passedCount = result.checks.filter((c) => c.passed).length;
    expect(passedCount).toBeGreaterThan(0);
    expect(passedCount).toBeLessThan(result.checks.length);
  });

  // --- Reverifiability ---

  it("fails dod-items-reverifiable when custom item has no verificationProcedure field", () => {
    const dod = validDoD({
      items: [
        {
          id: "custom-no-procedure",
          description: "Manual review of deployment",
          verificationMethod: "custom",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-items-reverifiable")?.passed).toBe(false);
    expect(
      findCheck(result, "dod-items-reverifiable")?.failureReason,
    ).toContain("verificationProcedure");
  });

  it("fails dod-items-reverifiable when custom item verificationProcedure < 20 chars", () => {
    const dod = validDoD({
      items: [
        {
          id: "custom-short-procedure",
          description: "Manual review",
          verificationMethod: "custom",
          verificationProcedure: "Look at it",
          notDoneConditions: [],
        },
      ],
    });
    const result = evaluateExecutionGate(dod, validLock());
    expect(result.passed).toBe(false);
    expect(findCheck(result, "dod-items-reverifiable")?.passed).toBe(false);
    expect(
      findCheck(result, "dod-items-reverifiable")?.failureReason,
    ).toContain("at least 20 characters");
  });
});
