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
import type { SessionAnchor } from "./session-anchor.js";
import type { RunnerAttestation } from "./runner-attestation.js";
import type { RunnerIdentity } from "./runner-identity.js";
import type { Policy } from "./policy.js";
import type { PolicyValidationResult } from "./policy-enforcement.js";
import type { PromptCapsule } from "./prompt-capsule.js";
import type { ModelResponseArtifact } from "./model-response.js";
import type { SymbolIndex } from "./symbol-index.js";
import type { SymbolValidationResult } from "./symbol-validate.js";

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
// Evidence Template JSON (NON-AUTHORITATIVE skeleton for runner ergonomics)
// ---------------------------------------------------------------------------

export function writeEvidenceTemplateJson(
  sessionDir: string,
  template: unknown,
): string {
  ensureDir(sessionDir);
  const filePath = join(sessionDir, "runner-evidence.template.json");
  writeFileSync(filePath, canonicalJson(template), "utf8");
  return filePath;
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

// ---------------------------------------------------------------------------
// Session Anchor JSON (Phase F)
// ---------------------------------------------------------------------------

export function writeSessionAnchorJson(
  sessionRoot: string,
  sessionId: string,
  anchor: SessionAnchor,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(join(dir, "session-anchor.json"), canonicalJson(anchor), "utf8");
}

export function readSessionAnchorJson(
  sessionRoot: string,
  sessionId: string,
): SessionAnchor | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "session-anchor.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as SessionAnchor;
}

// ---------------------------------------------------------------------------
// Phase H: Runner attestation persistence
// ---------------------------------------------------------------------------

export function writeRunnerAttestationJson(
  sessionRoot: string,
  sessionId: string,
  attestation: RunnerAttestation,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "runner-attestation.json"),
    canonicalJson(attestation),
    "utf8",
  );
}

export function readRunnerAttestationJson(
  sessionRoot: string,
  sessionId: string,
): RunnerAttestation | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "runner-attestation.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as RunnerAttestation;
}

// ---------------------------------------------------------------------------
// Phase H: Runner identity persistence
// ---------------------------------------------------------------------------

export function writeRunnerIdentityJson(
  sessionRoot: string,
  sessionId: string,
  identity: RunnerIdentity,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "runner-identity.json"),
    canonicalJson(identity),
    "utf8",
  );
}

export function readRunnerIdentityJson(
  sessionRoot: string,
  sessionId: string,
): RunnerIdentity | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "runner-identity.json");
  if (!existsSync(filePath)) return undefined;
  return JSON.parse(readFileSync(filePath, "utf8")) as RunnerIdentity;
}

// ---------------------------------------------------------------------------
// Phase H: Nonce persistence (replay resistance)
// ---------------------------------------------------------------------------

export function readUsedNoncesJson(
  sessionRoot: string,
  sessionId: string,
): string[] {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "used-nonces.json");
  if (!existsSync(filePath)) return [];
  return JSON.parse(readFileSync(filePath, "utf8")) as string[];
}

export function writeUsedNoncesJson(
  sessionRoot: string,
  sessionId: string,
  nonces: string[],
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "used-nonces.json"),
    canonicalJson(nonces),
    "utf8",
  );
}

export function appendNonce(
  sessionRoot: string,
  sessionId: string,
  nonce: string,
): void {
  const existing = readUsedNoncesJson(sessionRoot, sessionId);
  if (existing.includes(nonce)) {
    throw new SessionError(
      `Nonce "${nonce}" has already been used`,
      "ATTESTATION_INVALID",
      { nonce },
    );
  }
  writeUsedNoncesJson(sessionRoot, sessionId, [...existing, nonce]);
}

// ---------------------------------------------------------------------------
// Phase I: Policy persistence
// ---------------------------------------------------------------------------

/**
 * Write policy JSON to policy root directory.
 *
 * @param policyRoot - Root directory for policies
 * @param policyId - Policy ID (used as filename)
 * @param policy - Policy object to write
 */
export function writePolicyJson(
  policyRoot: string,
  policyId: string,
  policy: Policy,
): void {
  // Validate policyId is safe UUID
  if (!UUID_RE.test(policyId)) {
    throw new SessionError(
      `Invalid policyId format: ${policyId}`,
      "POLICY_INVALID",
      { policyId },
    );
  }

  const dir = resolve(policyRoot);
  ensureDir(dir);
  const filePath = join(dir, `${policyId}.json`);
  
  // Ensure path doesn't escape directory
  if (!filePath.startsWith(dir + sep)) {
    throw new SessionError(
      `Policy path traversal detected: ${filePath}`,
      "POLICY_INVALID",
      { policyId, filePath },
    );
  }

  writeFileSync(filePath, canonicalJson(policy), "utf8");
}

/**
 * Read policy JSON from policy root directory.
 *
 * @param policyRoot - Root directory for policies
 * @param policyId - Policy ID (used as filename)
 * @returns Policy object or undefined if not found
 */
export function readPolicyJson(
  policyRoot: string,
  policyId: string,
): Policy | undefined {
  if (!UUID_RE.test(policyId)) {
    return undefined;
  }

  const dir = resolve(policyRoot);
  const filePath = join(dir, `${policyId}.json`);
  
  // Ensure path doesn't escape directory
  if (!filePath.startsWith(dir + sep)) {
    return undefined;
  }

  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf8")) as Policy;
}

/**
 * Read all policies from policy root directory.
 *
 * @param policyRoot - Root directory for policies
 * @returns Array of all policies found
 */
export function readAllPoliciesJson(policyRoot: string): Policy[] {
  const dir = resolve(policyRoot);
  if (!existsSync(dir)) {
    return [];
  }

  const policies: Policy[] = [];
  const files = readdirSync(dir);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const policyId = file.slice(0, -5); // Remove .json extension
    if (!UUID_RE.test(policyId)) continue;

    const policy = readPolicyJson(policyRoot, policyId);
    if (policy) {
      policies.push(policy);
    }
  }

  return policies;
}

/**
 * Write policy evaluation result to session directory.
 *
 * @param sessionRoot - Root directory for sessions
 * @param sessionId - Session ID
 * @param evaluation - Policy validation result
 */
export function writePolicyEvaluationJson(
  sessionRoot: string,
  sessionId: string,
  evaluation: PolicyValidationResult,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "policy-evaluation.json"),
    canonicalJson(evaluation),
    "utf8",
  );
}

/**
 * Read policy evaluation result from session directory.
 *
 * @param sessionRoot - Root directory for sessions
 * @param sessionId - Session ID
 * @returns Policy validation result or undefined if not found
 */
export function readPolicyEvaluationJson(
  sessionRoot: string,
  sessionId: string,
): PolicyValidationResult | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "policy-evaluation.json");
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as PolicyValidationResult;
}

// ---------------------------------------------------------------------------
// Phase K: Prompt Capsule persistence
// ---------------------------------------------------------------------------

export function writePromptCapsuleJson(
  sessionRoot: string,
  sessionId: string,
  capsule: PromptCapsule,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "prompt-capsule.json"),
    canonicalJson(capsule),
    "utf8",
  );
}

export function readPromptCapsuleJson(
  sessionRoot: string,
  sessionId: string,
): PromptCapsule | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "prompt-capsule.json");
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as PromptCapsule;
}

// ---------------------------------------------------------------------------
// Phase K: Model Response persistence
// ---------------------------------------------------------------------------

export function writeModelResponseJson(
  sessionRoot: string,
  sessionId: string,
  response: ModelResponseArtifact,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "model-response.json"),
    canonicalJson(response),
    "utf8",
  );
}

export function readModelResponseJson(
  sessionRoot: string,
  sessionId: string,
): ModelResponseArtifact | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "model-response.json");
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as ModelResponseArtifact;
}

// ---------------------------------------------------------------------------
// Phase L: Symbol Index persistence
// ---------------------------------------------------------------------------

export function writeSymbolIndexJson(
  sessionRoot: string,
  sessionId: string,
  index: SymbolIndex,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "symbol-index.json"),
    canonicalJson(index),
    "utf8",
  );
}

export function readSymbolIndexJson(
  sessionRoot: string,
  sessionId: string,
): SymbolIndex | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "symbol-index.json");
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as SymbolIndex;
}

// ---------------------------------------------------------------------------
// Phase L: Symbol Validation persistence
// ---------------------------------------------------------------------------

export function writeSymbolValidationJson(
  sessionRoot: string,
  sessionId: string,
  result: SymbolValidationResult,
): void {
  const dir = safeSessionDir(sessionRoot, sessionId);
  ensureDir(dir);
  writeFileSync(
    join(dir, "symbol-validation.json"),
    canonicalJson(result),
    "utf8",
  );
}

export function readSymbolValidationJson(
  sessionRoot: string,
  sessionId: string,
): SymbolValidationResult | undefined {
  const dir = safeSessionDir(sessionRoot, sessionId);
  const filePath = join(dir, "symbol-validation.json");
  if (!existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as SymbolValidationResult;
}
