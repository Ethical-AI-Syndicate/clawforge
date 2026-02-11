import { describe, it, expect } from "vitest";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import { StepEnvelopeSchema, type StepEnvelope } from "../src/session/step-envelope.js";
import { PatchArtifactSchema, type PatchArtifact } from "../src/session/patch-artifact.js";
import {
  ReviewerReportSchema,
  REVIEWER_ROLES,
  type ReviewerReport,
} from "../src/session/reviewer-contract.js";
import { getRulesForRole, RULE_REGISTRY } from "../src/session/reviewer-rules.js";
import { reviewStep, type ReviewStepInput } from "../src/session/reviewer-orchestrator.js";
import { SessionError } from "../src/session/errors.js";
import {
  writeReviewerReportJson,
  readReviewerReports,
} from "../src/session/persistence.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const PATCH_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const TS = "2026-02-11T12:00:00.000Z";

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    sessionId: SESSION_ID,
    title: "Phase E DoD",
    items: [
      {
        id: "dod-1",
        description: "Implement reviewer pipeline",
        verificationMethod: "command_exit_code",
        verificationCommand: "npx vitest run",
        expectedExitCode: 0,
        notDoneConditions: [],
      },
      {
        id: "dod-2",
        description: "All schemas validated",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "user", actorType: "human" },
  } as DefinitionOfDone;
}

function minimalLock(): DecisionLock {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    lockId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    sessionId: SESSION_ID,
    dodId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    goal: "Implement Phase E multi-role reviewer pipeline",
    nonGoals: ["No execution"],
    interfaces: [],
    invariants: ["Fail-closed"],
    constraints: [],
    failureModes: [],
    risksAndTradeoffs: [],
    status: "approved",
    approvalMetadata: {
      approvedBy: "user",
      approvedAt: TS,
      approvalMethod: "manual",
    },
    createdAt: TS,
    createdBy: { actorId: "user", actorType: "human" },
  } as DecisionLock;
}

function validEnvelope(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-e1",
    goalExcerpt: "Phase E multi-role reviewer pipeline",
    allowedFiles: {
      create: ["src/session/reviewer-contract.ts"],
      modify: ["src/session/errors.ts"],
      delete: [],
    },
    referencedDoDItems: ["dod-1"],
    allowedCapabilities: ["validate"],
    reviewerSequence: ["static", "security", "qa"],
    ...overrides,
  };
}

function validPatch(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-e1",
    patchId: PATCH_ID,
    filesChanged: [
      {
        path: "src/session/reviewer-contract.ts",
        changeType: "create",
        diff: '+import { z } from "zod";\n+export const REVIEWER_ROLES = ["static"] as const;',
      },
    ],
    declaredImports: ["zod"],
    declaredNewDependencies: [],
    ...overrides,
  };
}

function reviewInput(
  envOverrides?: Record<string, unknown>,
  patchOverrides?: Record<string, unknown>,
): ReviewStepInput {
  return {
    stepEnvelope: validEnvelope(envOverrides),
    patchArtifact: validPatch(patchOverrides),
    dod: minimalDoD(),
    decisionLock: minimalLock(),
  };
}

// =========================================================================
// Schema tests
// =========================================================================

describe("StepEnvelopeSchema", () => {
  it("accepts valid envelope", () => {
    const r = StepEnvelopeSchema.safeParse(validEnvelope());
    expect(r.success).toBe(true);
  });

  it("rejects missing schemaVersion", () => {
    const { schemaVersion: _, ...rest } = validEnvelope();
    expect(StepEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const { sessionId: _, ...rest } = validEnvelope();
    expect(StepEnvelopeSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects missing stepId", () => {
    expect(
      StepEnvelopeSchema.safeParse(validEnvelope({ stepId: "" })).success,
    ).toBe(false);
  });

  it("rejects missing goalExcerpt", () => {
    expect(
      StepEnvelopeSchema.safeParse(validEnvelope({ goalExcerpt: "" })).success,
    ).toBe(false);
  });

  it("rejects non-disjoint allowedFiles", () => {
    const r = StepEnvelopeSchema.safeParse(
      validEnvelope({
        allowedFiles: {
          create: ["foo.ts"],
          modify: ["foo.ts"],
          delete: [],
        },
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects reviewerSequence shorter than 3", () => {
    const r = StepEnvelopeSchema.safeParse(
      validEnvelope({ reviewerSequence: ["static", "security"] }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects empty referencedDoDItems", () => {
    const r = StepEnvelopeSchema.safeParse(
      validEnvelope({ referencedDoDItems: [] }),
    );
    expect(r.success).toBe(false);
  });

  it("preserves passthrough fields", () => {
    const r = StepEnvelopeSchema.safeParse(
      validEnvelope({ extra: "preserved" }),
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).extra).toBe("preserved");
    }
  });

  it("defaults allowedFiles arrays", () => {
    const env = validEnvelope({ allowedFiles: {} });
    const r = StepEnvelopeSchema.safeParse(env);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.allowedFiles.create).toEqual([]);
      expect(r.data.allowedFiles.modify).toEqual([]);
      expect(r.data.allowedFiles.delete).toEqual([]);
    }
  });
});

describe("PatchArtifactSchema", () => {
  it("accepts valid patch", () => {
    const r = PatchArtifactSchema.safeParse(validPatch());
    expect(r.success).toBe(true);
  });

  it("rejects duplicate paths in filesChanged", () => {
    const r = PatchArtifactSchema.safeParse(
      validPatch({
        filesChanged: [
          { path: "a.ts", changeType: "create", diff: "+x" },
          { path: "a.ts", changeType: "modify", diff: "+y" },
        ],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("rejects invalid changeType", () => {
    const r = PatchArtifactSchema.safeParse(
      validPatch({
        filesChanged: [{ path: "a.ts", changeType: "rename", diff: "+x" }],
      }),
    );
    expect(r.success).toBe(false);
  });

  it("defaults declaredNewDependencies to empty", () => {
    const p = validPatch();
    delete (p as Record<string, unknown>).declaredNewDependencies;
    const r = PatchArtifactSchema.safeParse(p);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.declaredNewDependencies).toEqual([]);
    }
  });

  it("preserves passthrough fields", () => {
    const r = PatchArtifactSchema.safeParse(validPatch({ extra: true }));
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).extra).toBe(true);
    }
  });

  it("rejects empty filesChanged", () => {
    const r = PatchArtifactSchema.safeParse(validPatch({ filesChanged: [] }));
    expect(r.success).toBe(false);
  });
});

describe("ReviewerReportSchema", () => {
  const validReport = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-e1",
    reviewerRole: "static",
    passed: true,
    violations: [],
    notes: [],
  };

  it("accepts valid passing report", () => {
    const r = ReviewerReportSchema.safeParse(validReport);
    expect(r.success).toBe(true);
  });

  it("accepts valid failing report", () => {
    const r = ReviewerReportSchema.safeParse({
      ...validReport,
      passed: false,
      violations: [{ ruleId: "STATIC-001", message: "bad" }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects passed=false with empty violations", () => {
    const r = ReviewerReportSchema.safeParse({
      ...validReport,
      passed: false,
      violations: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects passed=true with violations", () => {
    const r = ReviewerReportSchema.safeParse({
      ...validReport,
      passed: true,
      violations: [{ ruleId: "X", message: "Y" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects unknown reviewerRole", () => {
    const r = ReviewerReportSchema.safeParse({
      ...validReport,
      reviewerRole: "unknown",
    });
    expect(r.success).toBe(false);
  });
});

// =========================================================================
// Rule tests
// =========================================================================

describe("Static rules", () => {
  const rules = getRulesForRole("static");

  it("STATIC-001: unauthorized file", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          { path: "unauthorized.ts", changeType: "create", diff: "+x" },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "STATIC-001")!.check(env, patch);
    expect(r.passed).toBe(false);
    expect(r.violations[0]!.ruleId).toBe("STATIC-001");
  });

  it("STATIC-002: undeclared import", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: '+import { foo } from "undeclared-mod";',
          },
        ],
        declaredImports: ["zod"],
      }),
    );
    const r = rules.find((r) => r.ruleId === "STATIC-002")!.check(env, patch);
    expect(r.passed).toBe(false);
    expect(r.violations[0]!.ruleId).toBe("STATIC-002");
  });

  it("STATIC-001: passes for authorized file", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(validPatch());
    const r = rules.find((r) => r.ruleId === "STATIC-001")!.check(env, patch);
    expect(r.passed).toBe(true);
  });
});

describe("Security rules", () => {
  const rules = getRulesForRole("security");

  it("SEC-001: child_process in declaredImports", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({ declaredImports: ["child_process"] }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-001")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("SEC-001: child_process in diff", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: '+const cp = require("child_process");',
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-001")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("SEC-004: eval usage", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+eval(code);",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-004")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("SEC-003: http import", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({ declaredImports: ["http"] }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-003")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("SEC-003: net import in diff", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: '+import net from "net";',
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-003")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("SEC-005: dynamic require", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+const mod = require(varName);",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-005")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("SEC-002: fs write outside persistence.ts", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+writeFileSync(path, data);",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "SEC-002")!.check(env, patch);
    expect(r.passed).toBe(false);
  });
});

describe("QA rules", () => {
  const rules = getRulesForRole("qa");

  it("QA-001: missing test file when DoD requires command_exit_code", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(validPatch());
    const dod = minimalDoD();
    const r = rules.find((r) => r.ruleId === "QA-001")!.check(env, patch, dod);
    expect(r.passed).toBe(false);
  });

  it("QA-003: flaky pattern Date.now", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+const ts = Date.now();",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "QA-003")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("QA-003: flaky pattern Math.random", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+const r = Math.random();",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "QA-003")!.check(env, patch);
    expect(r.passed).toBe(false);
  });
});

describe("E2E rules", () => {
  const rules = getRulesForRole("e2e");

  it("E2E-003: mutable global pattern (let at module scope)", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+let counter = 0;",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "E2E-003")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("E2E-003: globalThis usage", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: "+globalThis.foo = 1;",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "E2E-003")!.check(env, patch);
    expect(r.passed).toBe(false);
  });
});

describe("Automation rules", () => {
  const rules = getRulesForRole("automation");

  it("AUTO-001: CI file modified without permission", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: ".github/workflows/ci.yml",
            changeType: "modify",
            diff: "+  - run: test",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "AUTO-001")!.check(env, patch);
    expect(r.passed).toBe(false);
  });

  it("AUTO-002: new script without lock reference", () => {
    const env = StepEnvelopeSchema.parse(validEnvelope());
    const patch = PatchArtifactSchema.parse(
      validPatch({
        filesChanged: [
          {
            path: "deploy.sh",
            changeType: "create",
            diff: "+#!/bin/bash",
          },
        ],
      }),
    );
    const r = rules.find((r) => r.ruleId === "AUTO-002")!.check(env, patch);
    expect(r.passed).toBe(false);
  });
});

describe("Rule registry", () => {
  it("has rules for all reviewer roles", () => {
    for (const role of REVIEWER_ROLES) {
      expect(RULE_REGISTRY.has(role)).toBe(true);
      expect(getRulesForRole(role).length).toBeGreaterThan(0);
    }
  });

  it("returns empty array for unknown role", () => {
    expect(getRulesForRole("nonexistent")).toEqual([]);
  });
});

// =========================================================================
// Orchestrator tests
// =========================================================================

describe("reviewStep orchestrator", () => {
  it("rejects invalid envelope schema", () => {
    expect(() =>
      reviewStep({
        stepEnvelope: { bad: true },
        patchArtifact: validPatch(),
        dod: minimalDoD(),
        decisionLock: minimalLock(),
      }),
    ).toThrow(SessionError);
    try {
      reviewStep({
        stepEnvelope: { bad: true },
        patchArtifact: validPatch(),
        dod: minimalDoD(),
        decisionLock: minimalLock(),
      });
    } catch (e) {
      expect((e as SessionError).code).toBe("STEP_ENVELOPE_INVALID");
    }
  });

  it("rejects invalid patch schema", () => {
    expect(() =>
      reviewStep({
        stepEnvelope: validEnvelope(),
        patchArtifact: { bad: true },
        dod: minimalDoD(),
        decisionLock: minimalLock(),
      }),
    ).toThrow(SessionError);
    try {
      reviewStep({
        stepEnvelope: validEnvelope(),
        patchArtifact: { bad: true },
        dod: minimalDoD(),
        decisionLock: minimalLock(),
      });
    } catch (e) {
      expect((e as SessionError).code).toBe("PATCH_ARTIFACT_INVALID");
    }
  });

  it("rejects goalExcerpt not in lock goal", () => {
    expect(() =>
      reviewStep(reviewInput({ goalExcerpt: "totally unrelated goal" })),
    ).toThrow(SessionError);
    try {
      reviewStep(reviewInput({ goalExcerpt: "totally unrelated goal" }));
    } catch (e) {
      expect((e as SessionError).code).toBe("STEP_ENVELOPE_INVALID");
    }
  });

  it("rejects referencedDoDItem not in DoD", () => {
    expect(() =>
      reviewStep(reviewInput({ referencedDoDItems: ["nonexistent-dod"] })),
    ).toThrow(SessionError);
    try {
      reviewStep(reviewInput({ referencedDoDItems: ["nonexistent-dod"] }));
    } catch (e) {
      expect((e as SessionError).code).toBe("STEP_ENVELOPE_INVALID");
    }
  });

  it("rejects file not in allowedFiles", () => {
    expect(() =>
      reviewStep(
        reviewInput(undefined, {
          filesChanged: [
            { path: "forbidden.ts", changeType: "create", diff: "+x" },
          ],
        }),
      ),
    ).toThrow(SessionError);
    try {
      reviewStep(
        reviewInput(undefined, {
          filesChanged: [
            { path: "forbidden.ts", changeType: "create", diff: "+x" },
          ],
        }),
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("PATCH_ARTIFACT_INVALID");
    }
  });

  it("rejects unknown reviewer role", () => {
    expect(() =>
      reviewStep(
        reviewInput({ reviewerSequence: ["static", "security", "unknown_role"] }),
      ),
    ).toThrow(SessionError);
    try {
      reviewStep(
        reviewInput({ reviewerSequence: ["static", "security", "unknown_role"] }),
      );
    } catch (e) {
      expect((e as SessionError).code).toBe("REVIEWER_FAILED");
    }
  });

  it("happy path: all reviewers pass", () => {
    // Build a patch that passes all rules: authorized file, declared imports, no forbidden patterns
    const input = reviewInput(
      {
        allowedFiles: {
          create: ["src/session/reviewer-contract.ts"],
          modify: [],
          delete: [],
        },
        reviewerSequence: ["static", "security", "automation"],
      },
      {
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: '+import { z } from "zod";\n+export const X = z.string();',
          },
        ],
        declaredImports: ["zod"],
      },
    );
    const result = reviewStep(input);
    expect(result.passed).toBe(true);
    expect(result.failedAt).toBeUndefined();
    expect(result.reports).toHaveLength(3);
    expect(result.reports.every((r) => r.passed)).toBe(true);
  });

  it("fail-closed: stops at first failure, returns failedAt", () => {
    // Security will fail due to child_process in diff
    const input = reviewInput(
      {
        allowedFiles: {
          create: ["src/session/reviewer-contract.ts"],
          modify: [],
          delete: [],
        },
        reviewerSequence: ["static", "security", "automation"],
      },
      {
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: '+import cp from "child_process";',
          },
        ],
        declaredImports: ["child_process"],
      },
    );
    const result = reviewStep(input);
    expect(result.passed).toBe(false);
    expect(result.failedAt).toBe("security");
  });

  it("later reviewers NOT invoked after failure (reports.length check)", () => {
    // Security will fail, so automation should not be invoked
    const input = reviewInput(
      {
        allowedFiles: {
          create: ["src/session/reviewer-contract.ts"],
          modify: [],
          delete: [],
        },
        reviewerSequence: ["static", "security", "automation"],
      },
      {
        filesChanged: [
          {
            path: "src/session/reviewer-contract.ts",
            changeType: "create",
            diff: '+import cp from "child_process";',
          },
        ],
        declaredImports: ["child_process"],
      },
    );
    const result = reviewStep(input);
    expect(result.passed).toBe(false);
    expect(result.failedAt).toBe("security");
    // Only static and security reports, not automation
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0]!.reviewerRole).toBe("static");
    expect(result.reports[1]!.reviewerRole).toBe("security");
  });

  it("isolation: no reviewer receives prior report data", () => {
    // This is architecturally enforced by the rule signature:
    // check(envelope, patch, dod) - no reports argument
    // Verify by checking rule function parameter count
    for (const role of REVIEWER_ROLES) {
      const rules = getRulesForRole(role);
      for (const rule of rules) {
        // check() takes at most 3 params (envelope, patch, dod)
        expect(rule.check.length).toBeLessThanOrEqual(3);
      }
    }
  });
});

// =========================================================================
// Persistence tests
// =========================================================================

describe("Reviewer report persistence", () => {
  const testRoot = join(process.cwd(), ".test-sessions-reviewer");

  function cleanup() {
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  }

  function setup() {
    cleanup();
    mkdirSync(testRoot, { recursive: true });
    const sessionDir = join(testRoot, SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
  }

  const sampleReport: ReviewerReport = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-e1",
    reviewerRole: "static",
    passed: true,
    violations: [],
    notes: [],
  } as ReviewerReport;

  it("writes report to correct file path", () => {
    setup();
    writeReviewerReportJson(testRoot, SESSION_ID, "step-e1", "static", sampleReport);
    const reports = readReviewerReports(testRoot, SESSION_ID, "step-e1");
    expect(reports).toHaveLength(1);
    expect(reports[0]!.reviewerRole).toBe("static");
    cleanup();
  });

  it("throws REVIEWER_DUPLICATE on second write for same (step, role)", () => {
    setup();
    writeReviewerReportJson(testRoot, SESSION_ID, "step-e1", "static", sampleReport);
    expect(() =>
      writeReviewerReportJson(testRoot, SESSION_ID, "step-e1", "static", sampleReport),
    ).toThrow(SessionError);
    try {
      writeReviewerReportJson(testRoot, SESSION_ID, "step-e1", "static", sampleReport);
    } catch (e) {
      expect((e as SessionError).code).toBe("REVIEWER_DUPLICATE");
    }
    cleanup();
  });

  it("reads all reports for a step", () => {
    setup();
    writeReviewerReportJson(testRoot, SESSION_ID, "step-e1", "static", sampleReport);
    const secReport: ReviewerReport = {
      ...sampleReport,
      reviewerRole: "security",
    } as ReviewerReport;
    writeReviewerReportJson(testRoot, SESSION_ID, "step-e1", "security", secReport);
    const reports = readReviewerReports(testRoot, SESSION_ID, "step-e1");
    expect(reports).toHaveLength(2);
    cleanup();
  });

  it("returns [] for non-existent step", () => {
    setup();
    const reports = readReviewerReports(testRoot, SESSION_ID, "nonexistent-step");
    expect(reports).toHaveLength(0);
    cleanup();
  });

  it("rejects stepId with path traversal", () => {
    setup();
    expect(() =>
      writeReviewerReportJson(testRoot, SESSION_ID, "../evil", "static", sampleReport),
    ).toThrow();
    cleanup();
  });
});
