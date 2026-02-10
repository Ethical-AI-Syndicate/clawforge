/**
 * SQLite-backed append-only audit event store.
 *
 * Implements the storage schema from docs/audit.md:
 *   - `runs` table  (run_id, created_at, metadata)
 *   - `events` table (run_id, seq, event_id, ts, type, schema_version,
 *                      actor_json, payload_json, prev_hash, hash)
 *
 * Invariants enforced at write time:
 *   1. seq increments by exactly 1 per run (no gaps, no reuse).
 *   2. prevHash matches the hash of the preceding event (null for seq 1).
 *   3. hash is computed via Phase 2 hashing utilities over canonical JSON.
 *   4. The first event in every run must have type "RunStarted".
 *   5. Appends are wrapped in a transaction — all-or-nothing.
 *   6. No UPDATE or DELETE is ever issued against the events table.
 */

import Database from "better-sqlite3";
import { canonicalJson } from "./canonical.js";
import {
  computeEventHash,
  type ChainFailure,
  type ChainVerificationResult,
} from "./hashing.js";

// ---------------------------------------------------------------------------
// Minimal statement interface (avoids wrestling with conditional generics
// in @types/better-sqlite3 — keeps our call-sites type-safe).
// ---------------------------------------------------------------------------

interface Stmt {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type StoreErrorCode =
  | "RUN_NOT_FOUND"
  | "RUN_ALREADY_EXISTS"
  | "FIRST_EVENT_NOT_RUN_STARTED"
  | "EVENT_ID_CONFLICT";

export class StoreIntegrityError extends Error {
  public readonly code: StoreErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: StoreErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "StoreIntegrityError";
    this.code = code;
    this.details = details ?? {};
  }
}

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** What the caller supplies when appending an event. */
export interface EventDraft {
  eventId: string;
  type: string;
  schemaVersion: string;
  actor: { actorId: string; actorType: "human" | "system" | "worker" };
  payload: Record<string, unknown>;
  /** ISO 8601 UTC timestamp.  Defaults to `new Date().toISOString()`. */
  ts?: string;
}

/** A fully resolved event as persisted in the store. */
export interface StoredEvent {
  eventId: string;
  runId: string;
  seq: number;
  ts: string;
  type: string;
  schemaVersion: string;
  actor: { actorId: string; actorType: string };
  payload: Record<string, unknown>;
  prevHash: string | null;
  hash: string;
}

export interface RunInfo {
  runId: string;
  createdAt: string;
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Internal row shapes (match SQLite column names)
// ---------------------------------------------------------------------------

interface EventRow {
  run_id: string;
  seq: number;
  event_id: string;
  ts: string;
  type: string;
  schema_version: string;
  actor_json: string;
  payload_json: string;
  prev_hash: string | null;
  hash: string;
}

interface LastEventRow {
  seq: number;
  hash: string;
}

interface RunRow {
  run_id: string;
  created_at: string;
  metadata: string;
}

// ---------------------------------------------------------------------------
// Row ↔ domain conversion
// ---------------------------------------------------------------------------

function rowToStoredEvent(row: EventRow): StoredEvent {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    schemaVersion: row.schema_version,
    actor: JSON.parse(row.actor_json) as StoredEvent["actor"],
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    prevHash: row.prev_hash,
    hash: row.hash,
  };
}

/**
 * Reconstruct the hashable event record from a DB row.
 * This is the shape fed to `computeEventHash` — excludes hash & prevHash.
 */
function rowToHashableRecord(row: EventRow): Record<string, unknown> {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    schemaVersion: row.schema_version,
    actor: JSON.parse(row.actor_json),
    payload: JSON.parse(row.payload_json),
  };
}

// ---------------------------------------------------------------------------
// DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS events (
  run_id         TEXT    NOT NULL REFERENCES runs(run_id),
  seq            INTEGER NOT NULL,
  event_id       TEXT    NOT NULL UNIQUE,
  ts             TEXT    NOT NULL,
  type           TEXT    NOT NULL,
  schema_version TEXT    NOT NULL,
  actor_json     TEXT    NOT NULL,
  payload_json   TEXT    NOT NULL,
  prev_hash      TEXT,
  hash           TEXT    NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_event_id ON events(event_id);
`;

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class EventStore {
  private readonly db: InstanceType<typeof Database>;

  /* Prepared statements — cast through Stmt to avoid conditional generic issues */
  private readonly stmtInsertRun: Stmt;
  private readonly stmtGetRun: Stmt;
  private readonly stmtRunExists: Stmt;
  private readonly stmtLastEvent: Stmt;
  private readonly stmtInsertEvent: Stmt;
  private readonly stmtEventsByRun: Stmt;

  /* Pre-wrapped transaction for appendEvent (single allocation) */
  private readonly txnAppend: (runId: string, draft: EventDraft) => StoredEvent;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);

    // Prepared statements -------------------------------------------------
    this.stmtInsertRun = this.db.prepare(
      "INSERT INTO runs (run_id, created_at, metadata) VALUES (?, ?, ?)",
    ) as Stmt;

    this.stmtGetRun = this.db.prepare(
      "SELECT run_id, created_at, metadata FROM runs WHERE run_id = ?",
    ) as Stmt;

    this.stmtRunExists = this.db.prepare(
      "SELECT 1 FROM runs WHERE run_id = ?",
    ) as Stmt;

    this.stmtLastEvent = this.db.prepare(
      "SELECT seq, hash FROM events WHERE run_id = ? ORDER BY seq DESC LIMIT 1",
    ) as Stmt;

    this.stmtInsertEvent = this.db.prepare(
      `INSERT INTO events
         (run_id, seq, event_id, ts, type, schema_version,
          actor_json, payload_json, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ) as Stmt;

    this.stmtEventsByRun = this.db.prepare(
      "SELECT * FROM events WHERE run_id = ? ORDER BY seq ASC",
    ) as Stmt;

    // Transaction wrapper for appendEvent --------------------------------
    this.txnAppend = this.db.transaction(
      (runId: string, draft: EventDraft): StoredEvent => {
        // 1. Run must exist
        if (!this.stmtRunExists.get(runId)) {
          throw new StoreIntegrityError(
            `Run not found: ${runId}`,
            "RUN_NOT_FOUND",
            { runId },
          );
        }

        // 2. Determine seq and prevHash from the chain tail
        const last = this.stmtLastEvent.get(runId) as
          | LastEventRow
          | undefined;
        const seq = last ? last.seq + 1 : 1;
        const prevHash: string | null = last ? last.hash : null;

        // 3. First event in a run must be RunStarted
        if (seq === 1 && draft.type !== "RunStarted") {
          throw new StoreIntegrityError(
            `First event in run must be RunStarted, got: ${draft.type}`,
            "FIRST_EVENT_NOT_RUN_STARTED",
            { runId, type: draft.type },
          );
        }

        // 4. Build the hashable record (all fields except hash/prevHash)
        const ts = draft.ts ?? new Date().toISOString();
        const eventRecord: Record<string, unknown> = {
          eventId: draft.eventId,
          runId,
          seq,
          ts,
          type: draft.type,
          schemaVersion: draft.schemaVersion,
          actor: draft.actor,
          payload: draft.payload,
        };

        // 5. Compute content hash
        const hash = computeEventHash(eventRecord);

        // 6. Persist (canonical JSON for structured columns)
        try {
          this.stmtInsertEvent.run(
            runId,
            seq,
            draft.eventId,
            ts,
            draft.type,
            draft.schemaVersion,
            canonicalJson(draft.actor),
            canonicalJson(draft.payload),
            prevHash,
            hash,
          );
        } catch (err: unknown) {
          if (
            err instanceof Error &&
            err.message.includes("UNIQUE constraint")
          ) {
            throw new StoreIntegrityError(
              `Event ID already exists: ${draft.eventId}`,
              "EVENT_ID_CONFLICT",
              { eventId: draft.eventId },
            );
          }
          throw err;
        }

        // 7. Return resolved event
        return {
          eventId: draft.eventId,
          runId,
          seq,
          ts,
          type: draft.type,
          schemaVersion: draft.schemaVersion,
          actor: {
            actorId: draft.actor.actorId,
            actorType: draft.actor.actorType,
          },
          payload: { ...draft.payload },
          prevHash,
          hash,
        };
      },
    );
  }

  // -----------------------------------------------------------------------
  // Runs
  // -----------------------------------------------------------------------

  createRun(runId: string, metadata?: Record<string, string>): RunInfo {
    const createdAt = new Date().toISOString();
    const meta = metadata ?? {};
    try {
      this.stmtInsertRun.run(runId, createdAt, canonicalJson(meta));
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        err.message.includes("UNIQUE constraint")
      ) {
        throw new StoreIntegrityError(
          `Run already exists: ${runId}`,
          "RUN_ALREADY_EXISTS",
          { runId },
        );
      }
      throw err;
    }
    return { runId, createdAt, metadata: meta };
  }

  getRun(runId: string): RunInfo | undefined {
    const row = this.stmtGetRun.get(runId) as RunRow | undefined;
    if (!row) return undefined;
    return {
      runId: row.run_id,
      createdAt: row.created_at,
      metadata: JSON.parse(row.metadata) as Record<string, string>,
    };
  }

  // -----------------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------------

  appendEvent(runId: string, draft: EventDraft): StoredEvent {
    return this.txnAppend(runId, draft);
  }

  listEvents(runId: string): StoredEvent[] {
    const rows = this.stmtEventsByRun.all(runId) as EventRow[];
    return rows.map(rowToStoredEvent);
  }

  // -----------------------------------------------------------------------
  // Verification (streaming — one row at a time via SQLite cursor)
  // -----------------------------------------------------------------------

  verifyRunChain(runId: string): ChainVerificationResult {
    const failures: ChainFailure[] = [];
    const hashes: string[] = [];
    let prevStoredHash: string | null = null;
    let count = 0;

    for (const raw of this.stmtEventsByRun.iterate(runId)) {
      count++;
      const row = raw as EventRow;

      // 1. Recompute hash and compare
      const expectedHash = computeEventHash(rowToHashableRecord(row));
      if (row.hash !== expectedHash) {
        failures.push({
          seq: row.seq,
          eventId: row.event_id,
          reason: "hash_mismatch",
          expected: expectedHash,
          actual: row.hash,
        });
      }

      // 2. Verify chain link
      if (count === 1) {
        if (row.prev_hash !== null) {
          failures.push({
            seq: row.seq,
            eventId: row.event_id,
            reason: "first_event_prevHash_not_null",
            expected: "null",
            actual: String(row.prev_hash),
          });
        }
      } else {
        if (row.prev_hash !== prevStoredHash) {
          failures.push({
            seq: row.seq,
            eventId: row.event_id,
            reason: "prevHash_mismatch",
            expected: prevStoredHash ?? "null",
            actual: row.prev_hash ?? "null",
          });
        }
      }

      // 3. Verify seq continuity
      if (row.seq !== count) {
        failures.push({
          seq: row.seq,
          eventId: row.event_id,
          reason: "seq_gap",
          expected: String(count),
          actual: String(row.seq),
        });
      }

      prevStoredHash = row.hash;
      hashes.push(row.hash);
    }

    return {
      valid: failures.length === 0,
      eventCount: count,
      failures,
      hashes,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  close(): void {
    this.db.close();
  }
}
