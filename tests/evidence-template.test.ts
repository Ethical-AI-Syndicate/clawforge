import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { emitRunnerEvidenceTemplate } from "../src/session/evidence-template.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone } from "../src/session/schemas.js";
import type { ExecutionPlanLike } from "../src/session/evidence-validation.js";
import { RunnerEvidenceSchema } from "../src/session/runner-contract.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f",
    sessionId: SESSION_ID,
    title: "Test",
    items: [
      {
        id: "dod-1",
        description: "Item one",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "u", actorType: "human" },
  } as DefinitionOfDone;
}

function twoPlan(): ExecutionPlanLike {
  return {
    sessionId: SESSION_ID,
    steps: [
      { stepId: "step-1", references: ["dod-1"] },
      { stepId: "step-2", references: ["dod-1"] },
    ],
    allowedCapabilities: ["read_only"],
  };
}

describe("emitRunnerEvidenceTemplate", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clawforge-tmpl-"));
  });

  it("template file contains __notice string", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = readFileSync(
      join(dir, "runner-evidence.template.json"),
      "utf8",
    );
    const parsed = JSON.parse(content);
    expect(parsed.__notice).toContain("NON-AUTHORITATIVE TEMPLATE");
  });

  it("all plan steps are present in entries", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    const stepIds = content.entries.map((e: { stepId: string }) => e.stepId);
    expect(stepIds).toEqual(["step-1", "step-2"]);
  });

  it("each entry has __template: true", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    for (const entry of content.entries) {
      expect(entry.__template).toBe(true);
    }
  });

  it("placeholder strings present in entries", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    const entry = content.entries[0];
    expect(entry.evidenceId).toBe("<REPLACE_WITH_UUID>");
    expect(entry.timestamp).toBe("<REPLACE_WITH_ISO_TIMESTAMP>");
    expect(entry.evidenceType).toBe("<REPLACE_WITH_VALID_TYPE>");
    expect(entry.capabilityUsed).toBe("<REPLACE_WITH_ALLOWED_CAPABILITY>");
    expect(entry.humanConfirmationProof).toBe("<REPLACE_WITH_CONFIRMATION>");
    expect(entry.artifactHash).toBe("<REPLACE_IF_APPLICABLE>");
  });

  it("does NOT write runner-evidence.json (only writes .template.json)", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    expect(existsSync(join(dir, "runner-evidence.json"))).toBe(false);
    expect(existsSync(join(dir, "runner-evidence.template.json"))).toBe(true);
  });

  it("template entries do NOT pass RunnerEvidenceSchema validation", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    for (const entry of content.entries) {
      const result = RunnerEvidenceSchema.safeParse(entry);
      expect(result.success).toBe(false);
    }
  });

  it("returns correct file path", () => {
    const result = emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    expect(result).toBe(join(dir, "runner-evidence.template.json"));
  });

  it("empty steps array produces empty entries", () => {
    const plan: ExecutionPlanLike = { sessionId: SESSION_ID, steps: [] };
    emitRunnerEvidenceTemplate(dir, plan, minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    expect(content.entries).toEqual([]);
  });

  it("multiple steps produce correct number of entries", () => {
    const plan: ExecutionPlanLike = {
      sessionId: SESSION_ID,
      steps: [
        { stepId: "s1" },
        { stepId: "s2" },
        { stepId: "s3" },
      ],
    };
    emitRunnerEvidenceTemplate(dir, plan, minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    expect(content.entries).toHaveLength(3);
  });

  it("generatedAt is a valid ISO timestamp", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    expect(() => new Date(content.generatedAt)).not.toThrow();
    expect(new Date(content.generatedAt).toISOString()).toBe(
      content.generatedAt,
    );
  });

  it("entries use real sessionId from plan", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    for (const entry of content.entries) {
      expect(entry.sessionId).toBe(SESSION_ID);
    }
  });

  it("entries use real schemaVersion", () => {
    emitRunnerEvidenceTemplate(dir, twoPlan(), minimalDoD());
    const content = JSON.parse(
      readFileSync(join(dir, "runner-evidence.template.json"), "utf8"),
    );
    for (const entry of content.entries) {
      expect(entry.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    }
  });
});
