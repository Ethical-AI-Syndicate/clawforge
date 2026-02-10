import { describe, it, expect } from "vitest";
import {
  sha256,
  sha256Bytes,
  computeEventHash,
  verifyChain,
} from "../src/audit/hashing.js";

// ===================================================================
// sha256
// ===================================================================

describe("sha256", () => {
  it("produces correct digest for empty string", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("produces correct digest for 'hello'", () => {
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("is deterministic", () => {
    expect(sha256("test")).toBe(sha256("test"));
  });

  it("different inputs produce different digests", () => {
    expect(sha256("a")).not.toBe(sha256("b"));
  });

  it("returns a 64-char lowercase hex string", () => {
    expect(sha256("anything")).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ===================================================================
// sha256Bytes
// ===================================================================

describe("sha256Bytes", () => {
  it("agrees with sha256 for the same UTF-8 content", () => {
    const text = "hello";
    expect(sha256Bytes(Buffer.from(text, "utf8"))).toBe(sha256(text));
  });
});

// ===================================================================
// computeEventHash
// ===================================================================

describe("computeEventHash", () => {
  const baseEvent = {
    eventId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    runId: "d4e5f6a7-b8c9-4d0e-af1f-3a4b5c6d7e8f",
    seq: 1,
    ts: "2026-02-09T12:00:00.000Z",
    type: "RunStarted",
    schemaVersion: "1.0.0",
    actor: { actorId: "user-001", actorType: "human" },
    payload: { metadata: {} },
  };

  it("excludes hash and prevHash from computation", () => {
    const h1 = computeEventHash({
      ...baseEvent,
      hash: "anything",
      prevHash: "anything",
    });
    const h2 = computeEventHash({
      ...baseEvent,
      hash: "different",
      prevHash: null,
    });
    const h3 = computeEventHash(baseEvent); // no hash/prevHash at all
    expect(h1).toBe(h2);
    expect(h1).toBe(h3);
  });

  it("is deterministic", () => {
    expect(computeEventHash(baseEvent)).toBe(computeEventHash(baseEvent));
  });

  it("changes when seq changes", () => {
    expect(computeEventHash(baseEvent)).not.toBe(
      computeEventHash({ ...baseEvent, seq: 2 }),
    );
  });

  it("changes when type changes", () => {
    expect(computeEventHash(baseEvent)).not.toBe(
      computeEventHash({ ...baseEvent, type: "RunCompleted" }),
    );
  });

  it("changes when payload changes", () => {
    expect(computeEventHash(baseEvent)).not.toBe(
      computeEventHash({
        ...baseEvent,
        payload: { metadata: { key: "val" } },
      }),
    );
  });

  it("changes when actor changes", () => {
    expect(computeEventHash(baseEvent)).not.toBe(
      computeEventHash({
        ...baseEvent,
        actor: { actorId: "other", actorType: "system" },
      }),
    );
  });

  it("returns a 64-char lowercase hex string", () => {
    expect(computeEventHash(baseEvent)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across key insertion order", () => {
    const eventA: Record<string, unknown> = {
      type: "X",
      seq: 1,
      eventId: "e",
      runId: "r",
      ts: "t",
      schemaVersion: "1.0.0",
      actor: { actorId: "a", actorType: "human" },
      payload: {},
    };
    const eventB: Record<string, unknown> = {
      payload: {},
      actor: { actorType: "human", actorId: "a" },
      schemaVersion: "1.0.0",
      ts: "t",
      runId: "r",
      eventId: "e",
      seq: 1,
      type: "X",
    };
    expect(computeEventHash(eventA)).toBe(computeEventHash(eventB));
  });
});

// ===================================================================
// verifyChain
// ===================================================================

/**
 * Helper: build a valid hash chain of N events.
 */
function buildChain(count: number): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const draft: Record<string, unknown> = {
      eventId: `evt-${String(i).padStart(3, "0")}`,
      runId: "run-001",
      seq: i + 1,
      ts: "2026-02-09T12:00:00.000Z",
      type: i === 0 ? "RunStarted" : "StepStarted",
      schemaVersion: "1.0.0",
      actor: { actorId: "user-001", actorType: "human" },
      payload: { index: i },
    };
    draft["hash"] = computeEventHash(draft);
    draft["prevHash"] = i === 0 ? null : (events[i - 1]!["hash"] as string);
    events.push(draft);
  }
  return events;
}

describe("verifyChain", () => {
  it("verifies a valid chain of 5 events", () => {
    const events = buildChain(5);
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(5);
    expect(result.failures).toHaveLength(0);
    expect(result.hashes).toHaveLength(5);
  });

  it("verifies a single event", () => {
    const events = buildChain(1);
    const result = verifyChain(events);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(1);
  });

  it("verifies an empty list", () => {
    const result = verifyChain([]);
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(0);
  });

  it("detects hash mismatch from payload tampering", () => {
    const events = buildChain(3);
    // Tamper with event at seq 2 without recalculating its hash
    events[1]!["payload"] = { index: 999 };

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    const fail = result.failures.find(
      (f) => f.seq === 2 && f.reason === "hash_mismatch",
    );
    expect(fail).toBeDefined();
  });

  it("detects prevHash mismatch when chain link is broken", () => {
    const events = buildChain(3);
    // Break the prevHash pointer on event 3
    events[2]!["prevHash"] =
      "0000000000000000000000000000000000000000000000000000000000000000";

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    const fail = result.failures.find(
      (f) => f.seq === 3 && f.reason === "prevHash_mismatch",
    );
    expect(fail).toBeDefined();
  });

  it("detects non-null prevHash on first event", () => {
    const events = buildChain(2);
    events[0]!["prevHash"] = "somehash";

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    const fail = result.failures.find(
      (f) => f.seq === 1 && f.reason === "first_event_prevHash_not_null",
    );
    expect(fail).toBeDefined();
  });

  it("detects seq gap", () => {
    const events = buildChain(3);
    // Set seq of event 2 to 5 (gap) — also breaks hash
    events[1]!["seq"] = 5;

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    const seqFail = result.failures.find((f) => f.reason === "seq_gap");
    expect(seqFail).toBeDefined();
  });

  it("tampering at seq 1 is detected at seq 1", () => {
    const events = buildChain(4);
    events[0]!["payload"] = { index: 999 };

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    // The failure is specifically at seq 1
    expect(result.failures[0]!.seq).toBe(1);
    expect(result.failures[0]!.reason).toBe("hash_mismatch");
  });

  it("recalculating tampered hash causes prevHash cascade", () => {
    const events = buildChain(3);
    // Tamper with event 1 and recalculate its hash
    events[0]!["payload"] = { index: 999 };
    events[0]!["hash"] = computeEventHash(events[0]!);

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    // Event 1 hash now matches its content, but event 2's prevHash
    // still points to the old event 1 hash → prevHash_mismatch at seq 2
    const prevHashFail = result.failures.find(
      (f) => f.seq === 2 && f.reason === "prevHash_mismatch",
    );
    expect(prevHashFail).toBeDefined();
    // Event 1 itself should pass hash check now
    const event1HashFail = result.failures.find(
      (f) => f.seq === 1 && f.reason === "hash_mismatch",
    );
    expect(event1HashFail).toBeUndefined();
  });

  it("reports all failures, not just the first", () => {
    const events = buildChain(3);
    // Tamper with events 1 and 2
    events[0]!["payload"] = { index: 100 };
    events[1]!["payload"] = { index: 200 };

    const result = verifyChain(events);
    expect(result.valid).toBe(false);
    // At minimum, hash mismatches at seq 1 and seq 2
    const hashFails = result.failures.filter(
      (f) => f.reason === "hash_mismatch",
    );
    expect(hashFails.length).toBeGreaterThanOrEqual(2);
  });
});
