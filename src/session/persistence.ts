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

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../audit/canonical.js";
import { SessionError } from "./errors.js";
import type { DefinitionOfDone, DecisionLock, ExecutionGateResult } from "./schemas.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { ReviewerReport } from "./reviewer-contract.js";

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

// ---------------------------------------------------------------------------
// Runner Evidence JSON
// ---------------------------------------------------------------------------

export function writeRunnerEvidenceJson(
  sessionRoot: string,
  sessionId: string,
  evidence: RunnerEvidence[],
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "runner-evidence.json"),
    canonicalJson(evidence),
    "utf8",
  );
}

export function readRunnerEvidenceJson(
  sessionRoot: string,
  sessionId: string,
): RunnerEvidence[] | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "runner-evidence.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as RunnerEvidence[];
}

// ---------------------------------------------------------------------------
// Execution Plan JSON (read-only; validated by lint)
// ---------------------------------------------------------------------------

export function readExecutionPlanJson(
  sessionRoot: string,
  sessionId: string,
): Record<string, unknown> | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "execution-plan.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Reviewer Report JSON
// ---------------------------------------------------------------------------

const SAFE_STEP_ID_RE = /^[^/\\]*$/;

export function writeReviewerReportJson(
  sessionRoot: string,
  sessionId: string,
  stepId: string,
  reviewerRole: string,
  report: ReviewerReport,
): void {
  if (!SAFE_STEP_ID_RE.test(stepId) || stepId.includes("..")) {
    throw new Error(`Unsafe stepId: ${stepId}`);
  }
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  const fileName = `reviewer-${stepId}-${reviewerRole}.json`;
  const filePath = join(dir, fileName);
  if (existsSync(filePath)) {
    throw new SessionError(
      `Reviewer report already exists: ${fileName}`,
      "REVIEWER_DUPLICATE",
      { sessionId, stepId, reviewerRole },
    );
  }
  writeFileSync(filePath, canonicalJson(report), "utf8");
}

export function readReviewerReports(
  sessionRoot: string,
  sessionId: string,
  stepId: string,
): ReviewerReport[] {
  const dir = safeSessionDir(sessionRoot, sessionId);
  if (!existsSync(dir)) return [];
  const prefix = `reviewer-${stepId}-`;
  const files = readdirSync(dir).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".json"),
  );
  return files.map(
    (f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ReviewerReport,
  );
}
