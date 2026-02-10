import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import {
  EventStore,
  StoreIntegrityError,
  type EventDraft,
} from "../src/audit/store.js";
import { verifyChain, computeEventHash } from "../src/audit/hashing.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR = { actorId: "user-001", actorType: "human" as const };
const V1 = "1.0.0";

function draft(
  type: string,
  eventId: string,
  payload: Record<string, unknown> = {},
  ts?: string,
): EventDraft {
  return { eventId, type, schemaVersion: V1, actor: ACTOR, payload, ts };
}

// ---------------------------------------------------------------------------
// In-memory store (one per test)
// ---------------------------------------------------------------------------

describe("EventStore (in-memory)", () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore(":memory:");
  });
  afterEach(() => {
    store.close();
  });

  // =======================================================================
  // Run management
  // =======================================================================

  it("creates a run and retrieves it", () => {
    const run = store.createRun("run-1", { env: "test" });
    expect(run.runId).toBe("run-1");
    expect(run.metadata).toEqual({ env: "test" });

    const fetched = store.getRun("run-1");
    expect(fetched).toBeDefined();
    expect(fetched!.runId).toBe("run-1");
    expect(fetched!.metadata).toEqual({ env: "test" });
  });

  it("rejects duplicate run IDs", () => {
    store.createRun("run-dup");
    expect(() => store.createRun("run-dup")).toThrow(StoreIntegrityError);
    try {
      store.createRun("run-dup");
    } catch (err) {
      expect((err as StoreIntegrityError).code).toBe("RUN_ALREADY_EXISTS");
    }
  });

  it("getRun returns undefined for unknown run", () => {
    expect(store.getRun("no-such-run")).toBeUndefined();
  });

  // =======================================================================
  // Append-only behaviour
  // =======================================================================

  it("appends events and assigns sequential seq values", () => {
    store.createRun("run-seq");
    const e1 = store.appendEvent("run-seq", draft("RunStarted", "e1"));
    const e2 = store.appendEvent(
      "run-seq",
      draft("StepStarted", "e2", { stepId: "s1", stepIndex: 0, name: "s" }),
    );
    const e3 = store.appendEvent(
      "run-seq",
      draft("StepCompleted", "e3", { stepId: "s1" }),
    );

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);
  });

  it("returns fully populated StoredEvent from appendEvent", () => {
    store.createRun("run-full");
    const ts = "2026-02-09T12:00:00.000Z";
    const e = store.appendEvent(
      "run-full",
      draft("RunStarted", "evt-1", { metadata: {} }, ts),
    );

    expect(e.eventId).toBe("evt-1");
    expect(e.runId).toBe("run-full");
    expect(e.seq).toBe(1);
    expect(e.ts).toBe(ts);
    expect(e.type).toBe("RunStarted");
    expect(e.schemaVersion).toBe(V1);
    expect(e.actor).toEqual(ACTOR);
    expect(e.prevHash).toBeNull();
    expect(e.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("listEvents returns events ordered by seq", () => {
    store.createRun("run-list");
    store.appendEvent("run-list", draft("RunStarted", "a"));
    store.appendEvent("run-list", draft("StepStarted", "b", { stepId: "s", stepIndex: 0, name: "n" }));
    store.appendEvent("run-list", draft("StepCompleted", "c", { stepId: "s" }));

    const events = store.listEvents("run-list");
    expect(events).toHaveLength(3);
    expect(events[0]!.seq).toBe(1);
    expect(events[1]!.seq).toBe(2);
    expect(events[2]!.seq).toBe(3);
  });

  it("listEvents returns empty array for run with no events", () => {
    store.createRun("run-empty");
    expect(store.listEvents("run-empty")).toEqual([]);
  });

  it("listEvents returns empty array for non-existent run", () => {
    expect(store.listEvents("ghost")).toEqual([]);
  });

  // =======================================================================
  // First-event constraint
  // =======================================================================

  it("rejects non-RunStarted as first event", () => {
    store.createRun("run-first");
    expect(() =>
      store.appendEvent("run-first", draft("StepStarted", "e1", { stepId: "s", stepIndex: 0, name: "n" })),
    ).toThrow(StoreIntegrityError);

    try {
      store.appendEvent("run-first", draft("StepCompleted", "e2", { stepId: "s" }));
    } catch (err) {
      expect((err as StoreIntegrityError).code).toBe(
        "FIRST_EVENT_NOT_RUN_STARTED",
      );
    }
  });

  it("allows non-RunStarted after RunStarted", () => {
    store.createRun("run-ok");
    store.appendEvent("run-ok", draft("RunStarted", "e1"));
    const e2 = store.appendEvent(
      "run-ok",
      draft("StepStarted", "e2", { stepId: "s", stepIndex: 0, name: "n" }),
    );
    expect(e2.seq).toBe(2);
  });

  // =======================================================================
  // Run existence enforcement
  // =======================================================================

  it("rejects append to non-existent run", () => {
    expect(() =>
      store.appendEvent("no-run", draft("RunStarted", "e1")),
    ).toThrow(StoreIntegrityError);

    try {
      store.appendEvent("no-run", draft("RunStarted", "e2"));
    } catch (err) {
      expect((err as StoreIntegrityError).code).toBe("RUN_NOT_FOUND");
    }
  });

  // =======================================================================
  // Event ID uniqueness
  // =======================================================================

  it("rejects duplicate event IDs", () => {
    store.createRun("run-eid");
    store.appendEvent("run-eid", draft("RunStarted", "same-id"));
    expect(() =>
      store.appendEvent("run-eid", draft("StepStarted", "same-id", { stepId: "s", stepIndex: 0, name: "n" })),
    ).toThrow(StoreIntegrityError);

    try {
      store.appendEvent("run-eid", draft("StepStarted", "same-id", { stepId: "s", stepIndex: 0, name: "n" }));
    } catch (err) {
      expect((err as StoreIntegrityError).code).toBe("EVENT_ID_CONFLICT");
    }
  });

  // =======================================================================
  // prevHash chain enforcement
  // =======================================================================

  it("first event has prevHash null", () => {
    store.createRun("run-ph");
    const e1 = store.appendEvent("run-ph", draft("RunStarted", "e1"));
    expect(e1.prevHash).toBeNull();
  });

  it("subsequent events carry prevHash pointing to previous hash", () => {
    store.createRun("run-chain");
    const e1 = store.appendEvent("run-chain", draft("RunStarted", "e1"));
    const e2 = store.appendEvent(
      "run-chain",
      draft("StepStarted", "e2", { stepId: "s", stepIndex: 0, name: "n" }),
    );
    const e3 = store.appendEvent(
      "run-chain",
      draft("StepCompleted", "e3", { stepId: "s" }),
    );

    expect(e2.prevHash).toBe(e1.hash);
    expect(e3.prevHash).toBe(e2.hash);
  });

  // =======================================================================
  // Hash correctness
  // =======================================================================

  it("stored hash matches recomputed hash", () => {
    store.createRun("run-hash");
    const ts = "2026-02-09T15:00:00.000Z";
    const e = store.appendEvent(
      "run-hash",
      draft("RunStarted", "evt-h", { metadata: { env: "ci" } }, ts),
    );

    // Manually recompute
    const record: Record<string, unknown> = {
      eventId: e.eventId,
      runId: e.runId,
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      schemaVersion: e.schemaVersion,
      actor: e.actor,
      payload: e.payload,
    };
    expect(e.hash).toBe(computeEventHash(record));
  });

  // =======================================================================
  // Chain verification (persisted)
  // =======================================================================

  it("verifyRunChain passes on a valid chain", () => {
    store.createRun("run-v");
    store.appendEvent("run-v", draft("RunStarted", "v1"));
    store.appendEvent("run-v", draft("StepStarted", "v2", { stepId: "s", stepIndex: 0, name: "n" }));
    store.appendEvent("run-v", draft("RunCompleted", "v3", { summary: "done" }));

    const result = store.verifyRunChain("run-v");
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(3);
    expect(result.failures).toEqual([]);
    expect(result.hashes).toHaveLength(3);
  });

  it("verifyRunChain returns valid for empty run", () => {
    store.createRun("run-empty-v");
    const result = store.verifyRunChain("run-empty-v");
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(0);
  });

  it("verifyRunChain returns valid for non-existent run (no rows)", () => {
    const result = store.verifyRunChain("ghost");
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(0);
  });

  // =======================================================================
  // Persisted verification equals in-memory verification
  // =======================================================================

  it("persisted verification matches in-memory verification", () => {
    store.createRun("run-match");
    const ts = "2026-02-09T14:00:00.000Z";
    const e1 = store.appendEvent(
      "run-match",
      draft("RunStarted", "m1", { metadata: {} }, ts),
    );
    const e2 = store.appendEvent(
      "run-match",
      draft("StepStarted", "m2", { stepId: "s1", stepIndex: 0, name: "step" }, ts),
    );
    const e3 = store.appendEvent(
      "run-match",
      draft("RunCompleted", "m3", { summary: "ok" }, ts),
    );

    // Build in-memory event records (same shape verifyChain expects)
    const memEvents = [e1, e2, e3].map((e) => ({
      eventId: e.eventId,
      runId: e.runId,
      seq: e.seq,
      ts: e.ts,
      type: e.type,
      schemaVersion: e.schemaVersion,
      actor: e.actor,
      payload: e.payload,
      prevHash: e.prevHash,
      hash: e.hash,
    }));

    const memResult = verifyChain(memEvents);
    const storeResult = store.verifyRunChain("run-match");

    expect(storeResult.valid).toBe(true);
    expect(memResult.valid).toBe(true);
    expect(storeResult.hashes).toEqual(memResult.hashes);
    expect(storeResult.eventCount).toBe(memResult.eventCount);
    expect(storeResult.failures).toEqual(memResult.failures);
  });

  // =======================================================================
  // Transaction atomicity — failed append leaves store unchanged
  // =======================================================================

  it("failed append does not leave partial state", () => {
    store.createRun("run-txn");
    store.appendEvent("run-txn", draft("RunStarted", "t1"));

    // This will fail because the event ID is duplicate
    expect(() =>
      store.appendEvent("run-txn", draft("StepStarted", "t1", { stepId: "s", stepIndex: 0, name: "n" })),
    ).toThrow();

    // Only the first event should exist
    const events = store.listEvents("run-txn");
    expect(events).toHaveLength(1);
    expect(events[0]!.seq).toBe(1);

    // Next legitimate append should work with seq 2
    const e2 = store.appendEvent(
      "run-txn",
      draft("StepStarted", "t2", { stepId: "s", stepIndex: 0, name: "n" }),
    );
    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(events[0]!.hash);
  });

  // =======================================================================
  // Multiple runs are independent
  // =======================================================================

  it("events in different runs have independent seq counters", () => {
    store.createRun("run-a");
    store.createRun("run-b");

    const a1 = store.appendEvent("run-a", draft("RunStarted", "a1"));
    const b1 = store.appendEvent("run-b", draft("RunStarted", "b1"));
    const a2 = store.appendEvent("run-a", draft("StepStarted", "a2", { stepId: "s", stepIndex: 0, name: "n" }));

    expect(a1.seq).toBe(1);
    expect(b1.seq).toBe(1);
    expect(a2.seq).toBe(2);

    expect(store.listEvents("run-a")).toHaveLength(2);
    expect(store.listEvents("run-b")).toHaveLength(1);
  });
});

// ===========================================================================
// DB tampering detection (requires temp file so we can open a raw connection)
// ===========================================================================

describe("EventStore (tampering detection with file DB)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clawforge-test-"));
    dbPath = join(tmpDir, "test.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects payload tampering via verifyRunChain", () => {
    // 1. Write events through the store
    const store = new EventStore(dbPath);
    store.createRun("run-tamper");
    store.appendEvent(
      "run-tamper",
      draft("RunStarted", "t1", { metadata: {} }, "2026-02-09T10:00:00.000Z"),
    );
    store.appendEvent(
      "run-tamper",
      draft("StepStarted", "t2", { stepId: "s", stepIndex: 0, name: "original" }, "2026-02-09T10:00:01.000Z"),
    );
    store.close();

    // 2. Tamper with the DB directly
    const rawDb = new Database(dbPath);
    rawDb
      .prepare(
        "UPDATE events SET payload_json = ? WHERE event_id = ?",
      )
      .run('{"stepId":"s","stepIndex":0,"name":"TAMPERED"}', "t2");
    rawDb.close();

    // 3. Open store again and verify
    const store2 = new EventStore(dbPath);
    const result = store2.verifyRunChain("run-tamper");
    store2.close();

    expect(result.valid).toBe(false);
    expect(result.failures.length).toBeGreaterThanOrEqual(1);
    const fail = result.failures.find(
      (f) => f.seq === 2 && f.reason === "hash_mismatch",
    );
    expect(fail).toBeDefined();
  });

  it("detects hash tampering (recalculated hash breaks chain)", () => {
    const store = new EventStore(dbPath);
    store.createRun("run-hchain");
    store.appendEvent(
      "run-hchain",
      draft("RunStarted", "h1", {}, "2026-02-09T10:00:00.000Z"),
    );
    store.appendEvent(
      "run-hchain",
      draft("StepStarted", "h2", { stepId: "s", stepIndex: 0, name: "n" }, "2026-02-09T10:00:01.000Z"),
    );
    store.appendEvent(
      "run-hchain",
      draft("RunCompleted", "h3", {}, "2026-02-09T10:00:02.000Z"),
    );
    store.close();

    // Tamper with event 1 payload and recompute its hash
    const rawDb = new Database(dbPath);
    const newPayload = '{"tampered":true}';
    rawDb
      .prepare("UPDATE events SET payload_json = ? WHERE event_id = ?")
      .run(newPayload, "h1");

    // Recompute hash for event 1 after tampering
    const row = rawDb
      .prepare("SELECT * FROM events WHERE event_id = ?")
      .get("h1") as Record<string, unknown>;
    const record: Record<string, unknown> = {
      eventId: row["event_id"],
      runId: row["run_id"],
      seq: row["seq"],
      ts: row["ts"],
      type: row["type"],
      schemaVersion: row["schema_version"],
      actor: JSON.parse(row["actor_json"] as string),
      payload: JSON.parse(newPayload),
    };
    const newHash = computeEventHash(record);
    rawDb
      .prepare("UPDATE events SET hash = ? WHERE event_id = ?")
      .run(newHash, "h1");
    rawDb.close();

    // Event 1's hash now matches its (tampered) content,
    // but event 2's prevHash still points to the old hash → cascade failure
    const store2 = new EventStore(dbPath);
    const result = store2.verifyRunChain("run-hchain");
    store2.close();

    expect(result.valid).toBe(false);
    const prevHashFail = result.failures.find(
      (f) => f.seq === 2 && f.reason === "prevHash_mismatch",
    );
    expect(prevHashFail).toBeDefined();

    // Event 1 itself should pass the hash check
    const event1Fail = result.failures.find(
      (f) => f.seq === 1 && f.reason === "hash_mismatch",
    );
    expect(event1Fail).toBeUndefined();
  });

  it("detects seq tampering", () => {
    const store = new EventStore(dbPath);
    store.createRun("run-stmp");
    store.appendEvent(
      "run-stmp",
      draft("RunStarted", "s1", {}, "2026-02-09T10:00:00.000Z"),
    );
    store.appendEvent(
      "run-stmp",
      draft("StepStarted", "s2", { stepId: "s", stepIndex: 0, name: "n" }, "2026-02-09T10:00:01.000Z"),
    );
    store.close();

    // Change seq of event 2 from 2 to 5
    const rawDb = new Database(dbPath);
    rawDb.prepare("UPDATE events SET seq = 5 WHERE event_id = ?").run("s2");
    rawDb.close();

    const store2 = new EventStore(dbPath);
    const result = store2.verifyRunChain("run-stmp");
    store2.close();

    expect(result.valid).toBe(false);
    // Should detect both hash mismatch (seq is part of hash) and seq gap
    const hashFail = result.failures.find(
      (f) => f.reason === "hash_mismatch" && f.seq === 5,
    );
    const seqFail = result.failures.find((f) => f.reason === "seq_gap");
    expect(hashFail).toBeDefined();
    expect(seqFail).toBeDefined();
  });

  it("store persists across open/close cycles", () => {
    // Write
    const store1 = new EventStore(dbPath);
    store1.createRun("run-persist");
    const e1 = store1.appendEvent(
      "run-persist",
      draft("RunStarted", "p1", {}, "2026-02-09T10:00:00.000Z"),
    );
    store1.close();

    // Read
    const store2 = new EventStore(dbPath);
    const events = store2.listEvents("run-persist");
    expect(events).toHaveLength(1);
    expect(events[0]!.hash).toBe(e1.hash);

    // Append more
    const e2 = store2.appendEvent(
      "run-persist",
      draft("RunCompleted", "p2", {}, "2026-02-09T10:00:01.000Z"),
    );
    expect(e2.seq).toBe(2);
    expect(e2.prevHash).toBe(e1.hash);
    store2.close();

    // Verify
    const store3 = new EventStore(dbPath);
    const result = store3.verifyRunChain("run-persist");
    store3.close();

    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);
  });
});
