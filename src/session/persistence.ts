/**
 * Session artifact persistence — deterministic JSON read/write.
 *
 * Uses canonical JSON ordering. No side effects beyond filesystem writes.
 * No mutation of input objects. Guards against path traversal.
 *
 * Directory layout per session:
 *
 *   <sessionDir>/
 *     <sessionId>/
 *       session.json
 *       dod.json
 *       decision-lock.json
 *       gate-result.json
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../audit/canonical.js";
import type { DefinitionOfDone, DecisionLock, ExecutionGateResult } from "./schemas.js";

// ---------------------------------------------------------------------------
// Session metadata (what gets written to session.json)
// ---------------------------------------------------------------------------

export interface SessionRecord {
  sessionId: string;
  title: string;
  description: string;
  explorationRunId: string;
  createdAt: string;
  createdBy: { actorId: string; actorType: "human" | "system" };
}

// ---------------------------------------------------------------------------
// Path safety
// ---------------------------------------------------------------------------

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the directory for a session, validating the sessionId is a
 * safe UUID and the resolved path does not escape the session root.
 */
function safeSessionDir(sessionRoot: string, sessionId: string): string {
  if (!UUID_RE.test(sessionId)) {
    throw new Error(`Invalid sessionId (must be UUID): ${sessionId}`);
  }
  const dir = resolve(sessionRoot, sessionId);
  const root = resolve(sessionRoot);
  if (!dir.startsWith(root + sep) && dir !== root) {
    throw new Error(`Path traversal detected: ${sessionId}`);
  }
  return dir;
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Session JSON
// ---------------------------------------------------------------------------

export function writeSessionJson(
  sessionRoot: string,
  sessionId: string,
  record: SessionRecord,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, "session.json"), canonicalJson(record), "utf8");
}

export function readSessionJson(
  sessionRoot: string,
  sessionId: string,
): SessionRecord | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "session.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as SessionRecord;
}

// ---------------------------------------------------------------------------
// DoD JSON
// ---------------------------------------------------------------------------

export function writeDoDJson(
  sessionRoot: string,
  sessionId: string,
  dod: DefinitionOfDone,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, "dod.json"), canonicalJson(dod), "utf8");
}

export function readDoDJson(
  sessionRoot: string,
  sessionId: string,
): DefinitionOfDone | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "dod.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as DefinitionOfDone;
}

// ---------------------------------------------------------------------------
// Decision Lock JSON
// ---------------------------------------------------------------------------

export function writeDecisionLockJson(
  sessionRoot: string,
  sessionId: string,
  lock: DecisionLock,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, "decision-lock.json"), canonicalJson(lock), "utf8");
}

export function readDecisionLockJson(
  sessionRoot: string,
  sessionId: string,
): DecisionLock | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "decision-lock.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as DecisionLock;
}

// ---------------------------------------------------------------------------
// Gate Result JSON
// ---------------------------------------------------------------------------

export function writeGateResultJson(
  sessionRoot: string,
  sessionId: string,
  result: ExecutionGateResult,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, "gate-result.json"), canonicalJson(result), "utf8");
}

export function readGateResultJson(
  sessionRoot: string,
  sessionId: string,
): ExecutionGateResult | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "gate-result.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as ExecutionGateResult;
}
