/**
 * CLI smoke tests.
 *
 * Each test spawns `node dist/cli/index.js` against a temp directory
 * (via CLAWFORGE_DB_PATH and CLAWFORGE_ARTIFACT_ROOT env vars) and
 * asserts exit codes and key output strings.
 */

import { describe, test, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CLI_PATH = join(import.meta.dirname ?? ".", "..", "dist", "cli", "index.js");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function run(args: string[], env?: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10_000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as {
      stdout?: string;
      stderr?: string;
      status?: number;
    };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

let tempDir: string;
let dbPath: string;
let artifactRoot: string;
let cliEnv: Record<string, string>;

beforeAll(() => {
  // Build the project first (must have dist/ available)
  execFileSync("npx", ["tsc", "-p", "tsconfig.json"], {
    cwd: join(import.meta.dirname ?? ".", ".."),
    encoding: "utf8",
    timeout: 30_000,
  });
});

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "clawforge-cli-"));
  dbPath = join(tempDir, "db.sqlite");
  artifactRoot = join(tempDir, "artifacts");
  cliEnv = {
    CLAWFORGE_DB_PATH: dbPath,
    CLAWFORGE_ARTIFACT_ROOT: artifactRoot,
  };
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("clawctl", () => {
  test("no arguments prints usage and exits 1", () => {
    const r = run([], cliEnv);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("clawctl");
  });

  test("--help prints usage and exits 0", () => {
    const r = run(["--help"], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("clawctl");
    expect(r.stdout).toContain("validate-contract");
  });

  test("unknown command exits 1", () => {
    const r = run(["bogus"], cliEnv);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Unknown command");
  });

  // ---- init ----

  test("init creates data directory and DB", () => {
    const r = run(["init"], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Initialized");
    expect(existsSync(dbPath)).toBe(true);
    expect(existsSync(artifactRoot)).toBe(true);
  });

  // ---- config show ----

  test("config show prints paths", () => {
    const r = run(["config", "show"], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(dbPath);
    expect(r.stdout).toContain(artifactRoot);
  });

  test("config show --json returns JSON", () => {
    const r = run(["config", "show", "--json"], cliEnv);
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.dbPath).toBe(dbPath);
    expect(obj.artifactRoot).toBe(artifactRoot);
  });

  // ---- validate-contract ----

  test("validate-contract with valid IntentContract exits 0", () => {
    const contract = {
      schemaVersion: "1.0.0",
      intentId: "00000000-0000-4000-a000-000000000001",
      title: "Test intent",
      description: "A test intent for CLI validation",
      actor: { actorId: "user-1", actorType: "human" as const },
      createdAt: "2026-01-01T00:00:00.000Z",
      constraints: {
        maxSteps: 5,
        timeoutMs: 60000,
        providers: ["openai"],
      },
      inputParams: {},
      tags: ["test"],
    };
    const file = join(tempDir, "intent.json");
    writeFileSync(file, JSON.stringify(contract));

    const r = run(["validate-contract", file], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Valid IntentContract");
  });

  test("validate-contract with invalid contract exits 1", () => {
    const file = join(tempDir, "bad.json");
    writeFileSync(file, JSON.stringify({ intentId: "not-a-uuid" }));

    const r = run(["validate-contract", file], cliEnv);
    expect(r.exitCode).toBe(1);
  });

  test("validate-contract with missing file exits 1", () => {
    const r = run(["validate-contract", "/no/such/file.json"], cliEnv);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("not found");
  });

  test("validate-contract --json returns structured output", () => {
    const contract = {
      schemaVersion: "1.0.0",
      intentId: "00000000-0000-4000-a000-000000000001",
      title: "Test",
      description: "Test intent",
      actor: { actorId: "u", actorType: "human" as const },
      createdAt: "2026-01-01T00:00:00.000Z",
      constraints: { maxSteps: 5, timeoutMs: 60000, providers: [] },
      inputParams: {},
      tags: [],
    };
    const file = join(tempDir, "intent.json");
    writeFileSync(file, JSON.stringify(contract));

    const r = run(["validate-contract", file, "--json"], cliEnv);
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.valid).toBe(true);
    expect(obj.contractType).toBe("IntentContract");
  });

  // ---- new-run ----

  test("new-run creates run and returns info", () => {
    // init first
    run(["init"], cliEnv);

    const r = run(["new-run"], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Run created:");
    expect(r.stdout).toContain("RunStarted event:");
  });

  test("new-run --json returns structured output", () => {
    run(["init"], cliEnv);

    const r = run(["new-run", "--json"], cliEnv);
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.runId).toBeDefined();
    expect(obj.eventId).toBeDefined();
    expect(obj.createdAt).toBeDefined();
  });

  test("new-run with explicit --run UUID succeeds", () => {
    run(["init"], cliEnv);
    const runId = "11111111-1111-4111-a111-111111111111";
    const r = run(["new-run", "--run", runId], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(runId);
  });

  test("new-run with invalid UUID exits 1", () => {
    run(["init"], cliEnv);
    const r = run(["new-run", "--run", "not-a-uuid"], cliEnv);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("Invalid run ID");
  });

  test("new-run with --meta passes metadata", () => {
    run(["init"], cliEnv);
    const r = run(
      ["new-run", "--meta", '{"env":"test"}', "--json"],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
  });

  // ---- list-events ----

  test("list-events shows events for a run", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const r = run(["list-events", "--run", runId], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("RunStarted");
    expect(r.stdout).toContain("1 event(s)");
  });

  test("list-events --json returns array", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const r = run(["list-events", "--run", runId, "--json"], cliEnv);
    expect(r.exitCode).toBe(0);
    const events = JSON.parse(r.stdout);
    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe("RunStarted");
  });

  // ---- verify-run ----

  test("verify-run reports valid chain", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const r = run(["verify-run", "--run", runId], cliEnv);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("VALID");
  });

  test("verify-run --json returns result object", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const r = run(["verify-run", "--run", runId, "--json"], cliEnv);
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.valid).toBe(true);
    expect(obj.eventCount).toBe(1);
  });

  // ---- append-event ----

  test("append-event adds event from file", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const eventFile = join(tempDir, "event.json");
    writeFileSync(
      eventFile,
      JSON.stringify({
        eventId: "22222222-2222-4222-a222-222222222222",
        type: "StepStarted",
        schemaVersion: "1.0.0",
        actor: { actorId: "cli", actorType: "system" },
        payload: { stepId: "step-1" },
      }),
    );

    const r = run(
      ["append-event", "--run", runId, "--event", eventFile],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Event appended");
    expect(r.stdout).toContain("seq=2");
  });

  test("append-event --json returns structured output", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const eventFile = join(tempDir, "event2.json");
    writeFileSync(
      eventFile,
      JSON.stringify({
        eventId: "33333333-3333-4333-a333-333333333333",
        type: "StepCompleted",
        schemaVersion: "1.0.0",
        actor: { actorId: "cli", actorType: "system" },
        payload: { stepId: "step-1", result: "done" },
      }),
    );

    const r = run(
      ["append-event", "--run", runId, "--event", eventFile, "--json"],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.seq).toBe(2);
    expect(obj.hash).toBeDefined();
  });

  test("append-event with missing --run exits 1", () => {
    const r = run(["append-event", "--event", "/tmp/x.json"], cliEnv);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--run");
  });

  // ---- put-artifact ----

  test("put-artifact stores file and records event", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const artifactFile = join(tempDir, "data.txt");
    writeFileSync(artifactFile, "Hello, artifact!");

    const r = run(
      [
        "put-artifact",
        "--run",
        runId,
        "--file",
        artifactFile,
        "--mime",
        "text/plain",
        "--label",
        "test-artifact",
      ],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Artifact stored:");
    expect(r.stdout).toContain("Event: seq=2");
  });

  test("put-artifact --json returns structured output", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const artifactFile = join(tempDir, "data2.txt");
    writeFileSync(artifactFile, "Artifact content");

    const r = run(
      ["put-artifact", "--run", runId, "--file", artifactFile, "--json"],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
    const obj = JSON.parse(r.stdout);
    expect(obj.artifactId).toBeDefined();
    expect(obj.sha256).toBeDefined();
    expect(obj.size).toBe(16);
    expect(obj.seq).toBe(2);
  });

  // ---- export-evidence ----

  test("export-evidence creates a zip file", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const zipPath = join(tempDir, "evidence.zip");
    const r = run(
      ["export-evidence", "--run", runId, "--out", zipPath],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Evidence bundle exported");
    expect(existsSync(zipPath)).toBe(true);
  });

  test("export-evidence with --no-artifacts skips artifact bytes", () => {
    run(["init"], cliEnv);
    const createResult = run(["new-run", "--json"], cliEnv);
    const { runId } = JSON.parse(createResult.stdout);

    const zipPath = join(tempDir, "evidence-no-art.zip");
    const r = run(
      ["export-evidence", "--run", runId, "--out", zipPath, "--no-artifacts"],
      cliEnv,
    );
    expect(r.exitCode).toBe(0);
    expect(existsSync(zipPath)).toBe(true);
  });

  test("export-evidence with invalid run exits 1", () => {
    run(["init"], cliEnv);
    const r = run(
      [
        "export-evidence",
        "--run",
        "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        "--out",
        join(tempDir, "x.zip"),
      ],
      cliEnv,
    );
    expect(r.exitCode).toBe(1);
  });

  // ---- end-to-end: full workflow ----

  test("full workflow: create run, add artifact, verify, export", () => {
    // 1. init
    expect(run(["init"], cliEnv).exitCode).toBe(0);

    // 2. new-run
    const runResult = run(["new-run", "--json"], cliEnv);
    expect(runResult.exitCode).toBe(0);
    const { runId } = JSON.parse(runResult.stdout);

    // 3. put-artifact
    const artFile = join(tempDir, "payload.json");
    writeFileSync(artFile, JSON.stringify({ key: "value" }));
    const artResult = run(
      ["put-artifact", "--run", runId, "--file", artFile, "--mime", "application/json", "--label", "payload"],
      cliEnv,
    );
    expect(artResult.exitCode).toBe(0);

    // 4. append a custom event
    const evtFile = join(tempDir, "custom-evt.json");
    writeFileSync(
      evtFile,
      JSON.stringify({
        eventId: "44444444-4444-4444-a444-444444444444",
        type: "StepCompleted",
        schemaVersion: "1.0.0",
        actor: { actorId: "agent-1", actorType: "worker" },
        payload: { stepId: "step-1", status: "success" },
      }),
    );
    expect(
      run(["append-event", "--run", runId, "--event", evtFile], cliEnv)
        .exitCode,
    ).toBe(0);

    // 5. verify
    const verifyResult = run(["verify-run", "--run", runId, "--json"], cliEnv);
    expect(verifyResult.exitCode).toBe(0);
    const vr = JSON.parse(verifyResult.stdout);
    expect(vr.valid).toBe(true);
    expect(vr.eventCount).toBe(3);

    // 6. list events
    const listResult = run(["list-events", "--run", runId, "--json"], cliEnv);
    expect(listResult.exitCode).toBe(0);
    const events = JSON.parse(listResult.stdout);
    expect(events.length).toBe(3);
    expect(events[0].type).toBe("RunStarted");
    expect(events[1].type).toBe("ArtifactRecorded");
    expect(events[2].type).toBe("StepCompleted");

    // 7. export evidence
    const zipPath = join(tempDir, "full-evidence.zip");
    const exportResult = run(
      ["export-evidence", "--run", runId, "--out", zipPath],
      cliEnv,
    );
    expect(exportResult.exitCode).toBe(0);
    expect(existsSync(zipPath)).toBe(true);

    // Verify zip contains expected files
    const zipList = execFileSync("unzip", ["-l", zipPath], {
      encoding: "utf8",
    });
    expect(zipList).toContain("evidence/run.json");
    expect(zipList).toContain("evidence/events.jsonl");
    expect(zipList).toContain("evidence/integrity/chain.json");
    expect(zipList).toContain("evidence/artifacts/manifest.json");
  });
});
