import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ArtifactStore,
  ArtifactStoreError,
} from "../src/storage/artifact-store.js";
import { sha256Bytes } from "../src/audit/hashing.js";
import { EventStore } from "../src/audit/store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tmpRoot(): string {
  return mkdtempSync(join(tmpdir(), "clawforge-art-test-"));
}

// ---------------------------------------------------------------------------
// Core ArtifactStore behaviour
// ---------------------------------------------------------------------------

describe("ArtifactStore", () => {
  let root: string;
  let store: ArtifactStore;

  beforeEach(() => {
    root = tmpRoot();
    store = new ArtifactStore(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // =======================================================================
  // Content addressing — identical content → identical artifactId/path
  // =======================================================================

  it("identical content yields identical artifactId and path", () => {
    const buf = Buffer.from("hello world", "utf8");
    const r1 = store.putArtifact(buf, "text/plain", "first");
    const r2 = store.putArtifact(buf, "text/plain", "second");

    expect(r1.artifactId).toBe(r2.artifactId);
    expect(r1.sha256).toBe(r2.sha256);
    expect(r1.path).toBe(r2.path);
  });

  it("different content yields different artifactId", () => {
    const r1 = store.putArtifact(
      Buffer.from("content A", "utf8"),
      "text/plain",
      "a",
    );
    const r2 = store.putArtifact(
      Buffer.from("content B", "utf8"),
      "text/plain",
      "b",
    );

    expect(r1.artifactId).not.toBe(r2.artifactId);
    expect(r1.path).not.toBe(r2.path);
  });

  // =======================================================================
  // Hash correctness
  // =======================================================================

  it("artifactId equals SHA-256 of the stored bytes", () => {
    const buf = Buffer.from("test content 123", "utf8");
    const expected = sha256Bytes(buf);
    const record = store.putArtifact(buf, "text/plain", "test");

    expect(record.artifactId).toBe(expected);
    expect(record.sha256).toBe(expected);
  });

  it("hash is computed from raw bytes, not caller metadata", () => {
    const buf = Buffer.from("same bytes", "utf8");
    const r1 = store.putArtifact(buf, "text/plain", "label-a");
    const r2 = store.putArtifact(buf, "application/json", "label-b");

    // Same bytes → same hash regardless of mime/label
    expect(r1.artifactId).toBe(r2.artifactId);
  });

  // =======================================================================
  // Metadata correctness
  // =======================================================================

  it("artifact metadata matches stored content", () => {
    const buf = Buffer.from("metadata test", "utf8");
    const record = store.putArtifact(buf, "application/octet-stream", "my-artifact");

    expect(record.size).toBe(buf.length);
    expect(record.mime).toBe("application/octet-stream");
    expect(record.label).toBe("my-artifact");
    expect(record.artifactId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("label is truncated to 500 chars", () => {
    const buf = Buffer.from("x", "utf8");
    const longLabel = "L".repeat(600);
    const record = store.putArtifact(buf, "text/plain", longLabel);
    expect(record.label.length).toBe(500);
  });

  // =======================================================================
  // Deterministic path layout
  // =======================================================================

  it("path follows sha256/<first2>/<hash> layout", () => {
    const buf = Buffer.from("path layout test", "utf8");
    const hash = sha256Bytes(buf);
    const record = store.putArtifact(buf, "text/plain", "test");

    const expected = join(root, "sha256", hash.slice(0, 2), hash);
    expect(record.path).toBe(expected);
  });

  // =======================================================================
  // Read-back
  // =======================================================================

  it("getArtifact returns the original bytes", () => {
    const buf = Buffer.from("round trip test", "utf8");
    const record = store.putArtifact(buf, "text/plain", "test");
    const retrieved = store.getArtifact(record.sha256);

    expect(Buffer.compare(buf, retrieved)).toBe(0);
  });

  it("hasArtifact returns true for existing, false for missing", () => {
    const buf = Buffer.from("exists", "utf8");
    const record = store.putArtifact(buf, "text/plain", "test");

    expect(store.hasArtifact(record.sha256)).toBe(true);
    expect(
      store.hasArtifact(
        "0000000000000000000000000000000000000000000000000000000000000000",
      ),
    ).toBe(false);
  });

  it("getArtifact throws for non-existent hash", () => {
    expect(() =>
      store.getArtifact(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    ).toThrow(ArtifactStoreError);

    try {
      store.getArtifact(
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      );
    } catch (err) {
      expect((err as ArtifactStoreError).code).toBe("ARTIFACT_NOT_FOUND");
    }
  });

  // =======================================================================
  // Verification / tamper detection
  // =======================================================================

  it("verifyArtifact returns true for untampered artifact", () => {
    const buf = Buffer.from("verify me", "utf8");
    const record = store.putArtifact(buf, "text/plain", "test");
    expect(store.verifyArtifact(record.sha256)).toBe(true);
  });

  it("verifyArtifact returns false for missing artifact", () => {
    expect(
      store.verifyArtifact(
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      ),
    ).toBe(false);
  });

  it("tampering with artifact bytes is detectable via hash mismatch", () => {
    const buf = Buffer.from("original content", "utf8");
    const record = store.putArtifact(buf, "text/plain", "test");

    // Directly tamper with the file on disk (must override read-only mode)
    chmodSync(record.path, 0o644);
    writeFileSync(record.path, "TAMPERED CONTENT");

    expect(store.verifyArtifact(record.sha256)).toBe(false);
  });

  // =======================================================================
  // Size limits
  // =======================================================================

  it("rejects artifacts exceeding max size", () => {
    // Create store with 1 KB limit
    const small = new ArtifactStore(root, 1024);
    const bigBuf = Buffer.alloc(1025, 0x42);

    expect(() => small.putArtifact(bigBuf, "application/octet-stream", "big")).toThrow(
      ArtifactStoreError,
    );

    try {
      small.putArtifact(bigBuf, "application/octet-stream", "big");
    } catch (err) {
      expect((err as ArtifactStoreError).code).toBe("ARTIFACT_TOO_LARGE");
    }
  });

  it("rejects empty artifacts", () => {
    expect(() =>
      store.putArtifact(Buffer.alloc(0), "text/plain", "empty"),
    ).toThrow(ArtifactStoreError);
  });

  // =======================================================================
  // Invalid hash input
  // =======================================================================

  it("rejects invalid hash strings in getArtifact", () => {
    expect(() => store.getArtifact("not-a-hash")).toThrow(ArtifactStoreError);
    expect(() => store.getArtifact("")).toThrow(ArtifactStoreError);
    expect(() => store.getArtifact("abc")).toThrow(ArtifactStoreError);
    // Uppercase (not lowercase hex)
    expect(() =>
      store.getArtifact(
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toThrow(ArtifactStoreError);

    try {
      store.getArtifact("bad");
    } catch (err) {
      expect((err as ArtifactStoreError).code).toBe("INVALID_HASH");
    }
  });

  it("rejects invalid hash strings in hasArtifact", () => {
    expect(() => store.hasArtifact("../etc/passwd")).toThrow(
      ArtifactStoreError,
    );
  });

  // =======================================================================
  // Path traversal protection
  // =======================================================================

  it("rejects symlinks at artifact path", () => {
    const buf = Buffer.from("target", "utf8");
    const hash = sha256Bytes(buf);
    const prefix = hash.slice(0, 2);
    const dir = join(root, "sha256", prefix);
    mkdirSync(dir, { recursive: true });

    // Create a symlink at the expected artifact path
    const artifactPath = join(dir, hash);
    const decoyPath = join(root, "decoy");
    writeFileSync(decoyPath, "decoy content");
    symlinkSync(decoyPath, artifactPath);

    // getArtifact should reject the symlink
    expect(() => store.getArtifact(hash)).toThrow(ArtifactStoreError);
    try {
      store.getArtifact(hash);
    } catch (err) {
      expect((err as ArtifactStoreError).code).toBe("PATH_TRAVERSAL");
    }
  });

  it("hash validation prevents path traversal via crafted strings", () => {
    // These all fail the hex validation before any filesystem access
    expect(() => store.getArtifact("../../etc/passwd" + "a".repeat(49))).toThrow(
      ArtifactStoreError,
    );
    expect(() => store.getArtifact("..%2f..%2fetc%2fpasswd".padEnd(64, "a"))).toThrow(
      ArtifactStoreError,
    );
  });

  // =======================================================================
  // Idempotent writes
  // =======================================================================

  it("duplicate write with same content is idempotent", () => {
    const buf = Buffer.from("idem", "utf8");
    const r1 = store.putArtifact(buf, "text/plain", "first");
    const r2 = store.putArtifact(buf, "text/plain", "second");

    // Both succeed and return the same hash/path
    expect(r1.artifactId).toBe(r2.artifactId);

    // Only one file on disk
    const content = readFileSync(r1.path);
    expect(sha256Bytes(content)).toBe(r1.artifactId);
  });

  // =======================================================================
  // Manifest generation
  // =======================================================================

  it("buildManifest produces correct entries", () => {
    const r1 = store.putArtifact(
      Buffer.from("small", "utf8"),
      "text/plain",
      "small-artifact",
    );
    const r2 = store.putArtifact(
      Buffer.from("another", "utf8"),
      "application/json",
      "json-artifact",
    );

    const manifest = store.buildManifest([r1, r2]);
    expect(manifest).toHaveLength(2);
    expect(manifest[0]!.artifactId).toBe(r1.artifactId);
    expect(manifest[0]!.included).toBe(true);
    expect(manifest[1]!.mime).toBe("application/json");
  });

  it("buildManifest marks large artifacts as excluded", () => {
    const r = store.putArtifact(
      Buffer.from("data", "utf8"),
      "text/plain",
      "test",
    );

    // Set threshold to 1 byte — everything is "too large"
    const manifest = store.buildManifest([r], 1);
    expect(manifest[0]!.included).toBe(false);
  });
});

// ===========================================================================
// Integration: artifact records linked to audit events
// ===========================================================================

describe("ArtifactStore + EventStore integration", () => {
  let root: string;
  let artifactStore: ArtifactStore;
  let eventStore: EventStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "clawforge-art-int-"));
    artifactStore = new ArtifactStore(join(root, "artifacts"));
    eventStore = new EventStore(join(root, "audit.db"));
  });

  afterEach(() => {
    eventStore.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("ArtifactRecorded event payload matches artifact metadata", () => {
    eventStore.createRun("run-art");
    eventStore.appendEvent("run-art", {
      eventId: "e1",
      type: "RunStarted",
      schemaVersion: "1.0.0",
      actor: { actorId: "user-1", actorType: "human" },
      payload: {},
    });

    // Store an artifact
    const content = Buffer.from("artifact content for event test", "utf8");
    const record = artifactStore.putArtifact(
      content,
      "text/plain",
      "test-artifact",
    );

    // Record the ArtifactRecorded event
    const artEvent = eventStore.appendEvent("run-art", {
      eventId: "e2",
      type: "ArtifactRecorded",
      schemaVersion: "1.0.0",
      actor: { actorId: "user-1", actorType: "human" },
      payload: {
        artifactId: record.artifactId,
        sha256: record.sha256,
        size: record.size,
        mime: record.mime,
        label: record.label,
      },
    });

    // Verify the event payload matches
    expect(artEvent.type).toBe("ArtifactRecorded");
    const payload = artEvent.payload as Record<string, unknown>;
    expect(payload["artifactId"]).toBe(record.artifactId);
    expect(payload["sha256"]).toBe(record.sha256);
    expect(payload["size"]).toBe(record.size);
    expect(payload["mime"]).toBe(record.mime);
    expect(payload["label"]).toBe(record.label);

    // Verify the event does NOT contain raw artifact bytes
    const eventJson = JSON.stringify(artEvent);
    const artifactContent = content.toString("utf8");
    expect(eventJson).not.toContain(artifactContent);
  });

  it("artifact can be retrieved using hash from audit event", () => {
    eventStore.createRun("run-art2");
    eventStore.appendEvent("run-art2", {
      eventId: "e1",
      type: "RunStarted",
      schemaVersion: "1.0.0",
      actor: { actorId: "sys", actorType: "system" },
      payload: {},
    });

    const content = Buffer.from("retrieve me via event", "utf8");
    const record = artifactStore.putArtifact(content, "text/plain", "retrievable");

    eventStore.appendEvent("run-art2", {
      eventId: "e2",
      type: "ArtifactRecorded",
      schemaVersion: "1.0.0",
      actor: { actorId: "sys", actorType: "system" },
      payload: {
        artifactId: record.artifactId,
        sha256: record.sha256,
        size: record.size,
        mime: record.mime,
        label: record.label,
      },
    });

    // Read back from event store
    const events = eventStore.listEvents("run-art2");
    const artPayload = events[1]!.payload as Record<string, unknown>;
    const retrievedHash = artPayload["sha256"] as string;

    // Use hash to retrieve artifact
    const retrieved = artifactStore.getArtifact(retrievedHash);
    expect(Buffer.compare(content, retrieved)).toBe(0);
  });

  it("audit chain remains valid after recording artifact events", () => {
    eventStore.createRun("run-art3");
    eventStore.appendEvent("run-art3", {
      eventId: "e1",
      type: "RunStarted",
      schemaVersion: "1.0.0",
      actor: { actorId: "u1", actorType: "human" },
      payload: {},
    });

    for (let i = 0; i < 3; i++) {
      const content = Buffer.from(`artifact-${i}`, "utf8");
      const record = artifactStore.putArtifact(
        content,
        "text/plain",
        `artifact-${i}`,
      );
      eventStore.appendEvent("run-art3", {
        eventId: `art-${i}`,
        type: "ArtifactRecorded",
        schemaVersion: "1.0.0",
        actor: { actorId: "u1", actorType: "human" },
        payload: {
          artifactId: record.artifactId,
          sha256: record.sha256,
          size: record.size,
          mime: record.mime,
          label: record.label,
        },
      });
    }

    const result = eventStore.verifyRunChain("run-art3");
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(4); // RunStarted + 3 ArtifactRecorded
  });
});
