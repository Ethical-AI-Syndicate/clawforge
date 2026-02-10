import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";
import { EventStore, type EventDraft } from "../src/audit/store.js";
import { ArtifactStore } from "../src/storage/artifact-store.js";
import {
  exportEvidenceBundle,
  EvidenceExportError,
} from "../src/evidence/export.js";
import { canonicalJson } from "../src/audit/canonical.js";
import { sha256Bytes } from "../src/audit/hashing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR = { actorId: "user-1", actorType: "human" as const };
const V = "1.0.0";

function draft(
  type: string,
  eid: string,
  payload: Record<string, unknown> = {},
  ts?: string,
): EventDraft {
  return { eventId: eid, type, schemaVersion: V, actor: ACTOR, payload, ts };
}

/** Extract a zip file to a directory using the system `unzip` command. */
function extractZip(zipPath: string, destDir: string): void {
  execSync(`unzip -o -q "${zipPath}" -d "${destDir}"`);
}

/** Read a file from the extracted zip directory. */
function readEntry(extractDir: string, entryPath: string): string {
  return readFileSync(join(extractDir, entryPath), "utf8");
}

function entryExists(extractDir: string, entryPath: string): boolean {
  return existsSync(join(extractDir, entryPath));
}

// ---------------------------------------------------------------------------
// Scaffolding: populate a run with events + artifacts for export tests
// ---------------------------------------------------------------------------

interface TestFixture {
  root: string;
  eventStore: EventStore;
  artifactStore: ArtifactStore;
  zipPath: string;
  extractDir: string;
}

function createFixture(): TestFixture {
  const root = mkdtempSync(join(tmpdir(), "clawforge-ev-test-"));
  const eventStore = new EventStore(join(root, "audit.db"));
  const artifactStore = new ArtifactStore(join(root, "artifacts"));
  return {
    root,
    eventStore,
    artifactStore,
    zipPath: join(root, "evidence.zip"),
    extractDir: join(root, "extracted"),
  };
}

function destroyFixture(f: TestFixture): void {
  f.eventStore.close();
  rmSync(f.root, { recursive: true, force: true });
}

/** Build a typical run with events and artifacts. */
function populateRun(f: TestFixture): void {
  const { eventStore, artifactStore } = f;
  const ts = "2026-02-09T12:00:00.000Z";

  eventStore.createRun("run-1", { env: "test", host: "localhost" });
  eventStore.appendEvent(
    "run-1",
    draft("RunStarted", "e1", { intentId: "intent-1", metadata: { env: "test" } }, ts),
  );
  eventStore.appendEvent(
    "run-1",
    draft("StepStarted", "e2", { stepId: "s1", stepIndex: 0, name: "step-one" }, ts),
  );

  // Store two artifacts
  const art1 = artifactStore.putArtifact(
    Buffer.from("artifact one content", "utf8"),
    "text/plain",
    "artifact-1",
  );
  eventStore.appendEvent(
    "run-1",
    draft("ArtifactRecorded", "e3", {
      artifactId: art1.artifactId,
      sha256: art1.sha256,
      size: art1.size,
      mime: art1.mime,
      label: art1.label,
    }, ts),
  );

  const art2 = artifactStore.putArtifact(
    Buffer.from("artifact two content", "utf8"),
    "application/json",
    "artifact-2",
  );
  eventStore.appendEvent(
    "run-1",
    draft("ArtifactRecorded", "e4", {
      artifactId: art2.artifactId,
      sha256: art2.sha256,
      size: art2.size,
      mime: art2.mime,
      label: art2.label,
    }, ts),
  );

  eventStore.appendEvent(
    "run-1",
    draft("StepCompleted", "e5", { stepId: "s1" }, ts),
  );
  eventStore.appendEvent(
    "run-1",
    draft("RunCompleted", "e6", { summary: "success" }, ts),
  );
}

// ===========================================================================
// Tests
// ===========================================================================

describe("exportEvidenceBundle", () => {
  let f: TestFixture;

  beforeEach(() => {
    f = createFixture();
    populateRun(f);
  });

  afterEach(() => {
    destroyFixture(f);
  });

  // =======================================================================
  // Zip structure — required files
  // =======================================================================

  it("exported zip contains all required files", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    expect(entryExists(f.extractDir, "evidence/run.json")).toBe(true);
    expect(entryExists(f.extractDir, "evidence/events.jsonl")).toBe(true);
    expect(
      entryExists(f.extractDir, "evidence/schemas/contracts-v1.0.0.json"),
    ).toBe(true);
    expect(
      entryExists(f.extractDir, "evidence/schemas/audit-v1.0.0.json"),
    ).toBe(true);
    expect(
      entryExists(f.extractDir, "evidence/artifacts/manifest.json"),
    ).toBe(true);
    expect(
      entryExists(f.extractDir, "evidence/integrity/chain.json"),
    ).toBe(true);
  });

  // =======================================================================
  // run.json
  // =======================================================================

  it("run.json contains canonical run metadata", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    const run = JSON.parse(readEntry(f.extractDir, "evidence/run.json"));
    expect(run.runId).toBe("run-1");
    expect(run.metadata).toEqual({ env: "test", host: "localhost" });
    // Keys must be sorted (canonical)
    const keys = Object.keys(run);
    expect(keys).toEqual([...keys].sort());
  });

  // =======================================================================
  // events.jsonl — ordered, canonical
  // =======================================================================

  it("events.jsonl is ordered by seq and uses canonical JSON", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    const raw = readEntry(f.extractDir, "evidence/events.jsonl").trim();
    const lines = raw.split("\n");
    expect(lines).toHaveLength(6);

    // Verify seq ordering
    const seqs = lines.map((l) => JSON.parse(l).seq as number);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);

    // Verify each line is canonical (keys sorted)
    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const recanonical = canonicalJson(parsed);
      expect(line).toBe(recanonical);
    }

    // Verify events include hash and prevHash
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first["hash"]).toBeDefined();
    expect(first["prevHash"]).toBeNull();

    const second = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(second["prevHash"]).toBe(first["hash"]);
  });

  // =======================================================================
  // chain.json — matches verification
  // =======================================================================

  it("chain.json matches verifyRunChain output", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    const chain = JSON.parse(
      readEntry(f.extractDir, "evidence/integrity/chain.json"),
    );
    expect(chain.runId).toBe("run-1");
    expect(chain.eventCount).toBe(6);
    expect(chain.verified).toBe(true);
    expect(chain.failures).toEqual([]);
    expect(chain.hashes).toHaveLength(6);

    // Must match direct verification
    const direct = f.eventStore.verifyRunChain("run-1");
    expect(chain.hashes).toEqual(direct.hashes);
  });

  // =======================================================================
  // Artifact inclusion threshold
  // =======================================================================

  it("includes small artifacts as files in the zip", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    // Both artifacts are small — they should be included
    const manifest = JSON.parse(
      readEntry(f.extractDir, "evidence/artifacts/manifest.json"),
    );
    for (const entry of manifest.artifacts) {
      expect(entry.included).toBe(true);
      expect(
        entryExists(f.extractDir, `evidence/artifacts/${entry.sha256}`),
      ).toBe(true);

      // Verify the included bytes match the original
      const inZip = readFileSync(
        join(f.extractDir, `evidence/artifacts/${entry.sha256}`),
      );
      expect(sha256Bytes(inZip)).toBe(entry.sha256);
    }
  });

  it("excludes artifacts above threshold (manifest only)", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
      { maxIncludeBytes: 1 }, // 1 byte threshold — nothing qualifies
    );
    extractZip(f.zipPath, f.extractDir);

    const manifest = JSON.parse(
      readEntry(f.extractDir, "evidence/artifacts/manifest.json"),
    );
    for (const entry of manifest.artifacts) {
      expect(entry.included).toBe(false);
      // File should NOT be in the zip
      expect(
        entryExists(f.extractDir, `evidence/artifacts/${entry.sha256}`),
      ).toBe(false);
    }
  });

  it("includeArtifacts=false skips all artifact files", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
      { includeArtifacts: false },
    );
    extractZip(f.zipPath, f.extractDir);

    // Manifest still present
    expect(
      entryExists(f.extractDir, "evidence/artifacts/manifest.json"),
    ).toBe(true);

    // But no artifact files
    const manifest = JSON.parse(
      readEntry(f.extractDir, "evidence/artifacts/manifest.json"),
    );
    for (const entry of manifest.artifacts) {
      expect(
        entryExists(f.extractDir, `evidence/artifacts/${entry.sha256}`),
      ).toBe(false);
    }
  });

  // =======================================================================
  // Manifest ordering — deterministic by artifactId
  // =======================================================================

  it("manifest artifacts are ordered by artifactId", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    const manifest = JSON.parse(
      readEntry(f.extractDir, "evidence/artifacts/manifest.json"),
    );
    const ids = manifest.artifacts.map(
      (e: Record<string, unknown>) => e.artifactId as string,
    );
    expect(ids).toEqual([...ids].sort());
  });

  // =======================================================================
  // Zip paths are fixed — not attacker-controlled
  // =======================================================================

  it("all zip entry paths start with evidence/ and contain no ..", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );

    // List zip entries
    const listing = execSync(`unzip -l "${f.zipPath}"`, {
      encoding: "utf8",
    });
    const entryLines = listing
      .split("\n")
      .filter((l) => l.includes("evidence/"));

    expect(entryLines.length).toBeGreaterThanOrEqual(6);
    for (const line of entryLines) {
      // Extract the path (last column)
      const match = /\s(evidence\/.+)$/.exec(line.trim());
      if (match) {
        const entryPath = match[1]!;
        expect(entryPath.startsWith("evidence/")).toBe(true);
        expect(entryPath).not.toContain("..");
        expect(entryPath).not.toContain("\\");
      }
    }
  });

  // =======================================================================
  // Schema snapshots
  // =======================================================================

  it("schema snapshots are valid JSON with expected structure", async () => {
    await exportEvidenceBundle(
      "run-1",
      f.zipPath,
      f.eventStore,
      f.artifactStore,
    );
    extractZip(f.zipPath, f.extractDir);

    const contracts = JSON.parse(
      readEntry(f.extractDir, "evidence/schemas/contracts-v1.0.0.json"),
    );
    expect(contracts.schemaVersion).toBe("1.0.0");
    expect(contracts.contracts.IntentContract).toBeDefined();
    expect(contracts.contracts.StepContract).toBeDefined();
    expect(contracts.contracts.WorkerTaskContract).toBeDefined();

    const audit = JSON.parse(
      readEntry(f.extractDir, "evidence/schemas/audit-v1.0.0.json"),
    );
    expect(audit.schemaVersion).toBe("1.0.0");
    expect(audit.eventTypes).toContain("RunStarted");
    expect(audit.eventTypes).toContain("ArtifactRecorded");
  });
});

// ===========================================================================
// Failure modes
// ===========================================================================

describe("exportEvidenceBundle failure modes", () => {
  let f: TestFixture;

  beforeEach(() => {
    f = createFixture();
  });

  afterEach(() => {
    destroyFixture(f);
  });

  it("fails if run does not exist", async () => {
    await expect(
      exportEvidenceBundle(
        "ghost-run",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
      ),
    ).rejects.toThrow(EvidenceExportError);
  });

  it("fails if run chain is tampered", async () => {
    // Populate normally
    const dbPath = join(f.root, "audit.db");
    f.eventStore.createRun("run-bad");
    f.eventStore.appendEvent(
      "run-bad",
      draft("RunStarted", "b1", {}, "2026-02-09T12:00:00.000Z"),
    );
    f.eventStore.appendEvent(
      "run-bad",
      draft("StepStarted", "b2", { stepId: "s", stepIndex: 0, name: "n" }, "2026-02-09T12:00:01.000Z"),
    );
    f.eventStore.close();

    // Tamper directly
    const rawDb = new Database(dbPath);
    rawDb
      .prepare("UPDATE events SET payload_json = ? WHERE event_id = ?")
      .run('{"tampered":true}', "b2");
    rawDb.close();

    // Re-open store
    f.eventStore = new EventStore(dbPath);

    await expect(
      exportEvidenceBundle(
        "run-bad",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
      ),
    ).rejects.toThrow(EvidenceExportError);

    try {
      await exportEvidenceBundle(
        "run-bad",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
      );
    } catch (err) {
      expect((err as EvidenceExportError).code).toBe(
        "CHAIN_VERIFICATION_FAILED",
      );
    }
  });

  it("fails if included artifact is tampered on disk", async () => {
    populateRun(f);

    // Find an artifact hash from the events
    const events = f.eventStore.listEvents("run-1");
    const artEvent = events.find((e) => e.type === "ArtifactRecorded")!;
    const hash = artEvent.payload["sha256"] as string;

    // Tamper the artifact file
    const prefix = hash.slice(0, 2);
    const artPath = join(
      f.root,
      "artifacts",
      "sha256",
      prefix,
      hash,
    );
    chmodSync(artPath, 0o644);
    writeFileSync(artPath, "TAMPERED DATA");

    await expect(
      exportEvidenceBundle(
        "run-1",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
      ),
    ).rejects.toThrow(EvidenceExportError);

    try {
      await exportEvidenceBundle(
        "run-1",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
      );
    } catch (err) {
      expect((err as EvidenceExportError).code).toBe(
        "ARTIFACT_VERIFICATION_FAILED",
      );
    }
  });

  it("does NOT fail if artifacts are tampered but includeArtifacts=false", async () => {
    populateRun(f);

    // Tamper all artifacts
    const events = f.eventStore.listEvents("run-1");
    for (const e of events) {
      if (e.type === "ArtifactRecorded") {
        const hash = e.payload["sha256"] as string;
        const prefix = hash.slice(0, 2);
        const artPath = join(
          f.root,
          "artifacts",
          "sha256",
          prefix,
          hash,
        );
        chmodSync(artPath, 0o644);
        writeFileSync(artPath, "TAMPERED");
      }
    }

    // Export without artifacts — should succeed (chain is fine)
    await expect(
      exportEvidenceBundle(
        "run-1",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
        { includeArtifacts: false },
      ),
    ).resolves.toBeUndefined();
  });

  it("does NOT fail if artifacts are tampered but all above threshold", async () => {
    populateRun(f);

    // Tamper all artifacts
    const events = f.eventStore.listEvents("run-1");
    for (const e of events) {
      if (e.type === "ArtifactRecorded") {
        const hash = e.payload["sha256"] as string;
        const prefix = hash.slice(0, 2);
        const artPath = join(
          f.root,
          "artifacts",
          "sha256",
          prefix,
          hash,
        );
        chmodSync(artPath, 0o644);
        writeFileSync(artPath, "TAMPERED");
      }
    }

    // Threshold = 1 byte → nothing included → no verification
    await expect(
      exportEvidenceBundle(
        "run-1",
        f.zipPath,
        f.eventStore,
        f.artifactStore,
        { maxIncludeBytes: 1 },
      ),
    ).resolves.toBeUndefined();
  });
});
