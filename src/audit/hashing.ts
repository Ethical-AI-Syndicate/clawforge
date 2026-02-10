/**
 * SHA-256 hashing for audit events and artifacts.
 *
 * Event hashing follows docs/audit.md §Hash Chain:
 *   - Strip `hash` and `prevHash` from the event.
 *   - Serialize the remainder to canonical JSON.
 *   - Compute SHA-256 of the resulting UTF-8 bytes.
 *
 * Pure functions — no I/O, no side effects.
 */

import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical.js";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** SHA-256 hex digest of raw bytes. */
export function sha256Bytes(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Event hash computation
// ---------------------------------------------------------------------------

/** Fields excluded when computing an event's content hash. */
const HASH_EXCLUDED_FIELDS: ReadonlySet<string> = new Set([
  "hash",
  "prevHash",
]);

/**
 * Compute the content hash of an audit event.
 *
 * The `hash` and `prevHash` fields are stripped before serialization so that
 * the hash covers only the event's semantic content.
 */
export function computeEventHash(event: Record<string, unknown>): string {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event)) {
    if (!HASH_EXCLUDED_FIELDS.has(key)) {
      stripped[key] = value;
    }
  }
  return sha256(canonicalJson(stripped));
}

// ---------------------------------------------------------------------------
// Chain verification
// ---------------------------------------------------------------------------

export interface ChainFailure {
  seq: number;
  eventId: string;
  reason:
    | "hash_mismatch"
    | "prevHash_mismatch"
    | "first_event_prevHash_not_null"
    | "seq_gap";
  expected: string;
  actual: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  eventCount: number;
  failures: ChainFailure[];
  /** The stored hash of each event, in seq order. */
  hashes: string[];
}

/**
 * Verify the hash chain of an ordered list of events.
 *
 * Events **must** be sorted by `seq` ascending before calling this function.
 *
 * Checks performed per event:
 *   1. Recompute hash and compare to stored `hash`.
 *   2. Verify `prevHash` matches the previous event's stored `hash` (or is
 *      null for the first event).
 *   3. Verify `seq` equals its expected position (i + 1).
 */
export function verifyChain(
  events: ReadonlyArray<Record<string, unknown>>,
): ChainVerificationResult {
  const failures: ChainFailure[] = [];
  const hashes: string[] = [];

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const seq = event["seq"] as number;
    const eventId = (event["eventId"] as string) ?? `index-${i}`;

    // 1. Hash integrity --------------------------------------------------
    const expectedHash = computeEventHash(event);
    const storedHash = event["hash"] as string;
    if (storedHash !== expectedHash) {
      failures.push({
        seq,
        eventId,
        reason: "hash_mismatch",
        expected: expectedHash,
        actual: storedHash,
      });
    }

    // 2. Chain link -------------------------------------------------------
    if (i === 0) {
      if (event["prevHash"] !== null) {
        failures.push({
          seq,
          eventId,
          reason: "first_event_prevHash_not_null",
          expected: "null",
          actual: String(event["prevHash"]),
        });
      }
    } else {
      const prevStoredHash = events[i - 1]!["hash"] as string;
      const storedPrevHash = event["prevHash"] as string;
      if (storedPrevHash !== prevStoredHash) {
        failures.push({
          seq,
          eventId,
          reason: "prevHash_mismatch",
          expected: prevStoredHash,
          actual: storedPrevHash,
        });
      }
    }

    // 3. Sequence continuity -----------------------------------------------
    const expectedSeq = i + 1;
    if (seq !== expectedSeq) {
      failures.push({
        seq,
        eventId,
        reason: "seq_gap",
        expected: String(expectedSeq),
        actual: String(seq),
      });
    }

    hashes.push(storedHash);
  }

  return {
    valid: failures.length === 0,
    eventCount: events.length,
    failures,
    hashes,
  };
}
