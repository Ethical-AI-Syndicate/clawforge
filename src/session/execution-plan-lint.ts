/**
 * Execution Plan Linter — structural validation only.
 *
 * Phase C: Rejects plans containing executable content or violating
 * referential constraints. Does NOT execute, interpret, or run anything.
 * evaluateExecutionGate().passed === true remains the sole execution authority.
 */

import type { DefinitionOfDone } from "./schemas.js";
import { SessionError } from "./errors.js";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Forbidden patterns (case-insensitive substring match)
// ---------------------------------------------------------------------------

// Patterns matched as whole words only (avoid "rm" in "deterministic")
const FORBIDDEN_WORD_PATTERNS: ReadonlyArray<string> = [
  "rm",
  "mv",
  "cp",
  "sh",
  "go",
];

// HTTP method words: case-sensitive so "post-hoc" / "input" / "patch" / "delete" are allowed
const FORBIDDEN_HTTP_METHODS: ReadonlyArray<string> = [
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

const FORBIDDEN_PATTERNS: ReadonlyArray<string> = [
  // Shell / process
  "$(",
  "`",
  ";",
  "&&",
  "||",
  "|",
  "sudo",
  "chmod",
  "chown",
  "bash",
  "zsh",
  "powershell",
  "cmd.exe",
  // Tool invocation
  "npm",
  "pnpm",
  "yarn",
  "node",
  "python",
  "cargo",
  "make",
  "docker",
  "kubectl",
  "helm",
  "terraform",
  "ansible",
  // Network
  "http://",
  "https://",
  "ftp://",
  "ssh",
  "scp",
  "rsync",
  "curl",
  "wget",
  // Filesystem mutation
  "write",
  "delete",
  "remove",
  "modify",
  "create file",
  "touch",
  "mkdir",
  "rmdir",
];

const REQUIRED_GUARANTEE_KEYS = [
  "noShellExecution",
  "noNetworkAccess",
  "noFilesystemMutation",
  "noProcessSpawning",
  "noImplicitIO",
] as const;

// ---------------------------------------------------------------------------
// Plan shape (structural checks only; no full schema)
// ---------------------------------------------------------------------------

interface PlanStep {
  stepId?: string;
  references?: unknown;
  [key: string]: unknown;
}

interface ExecutionPlanLike {
  steps?: unknown[];
  nonExecutableGuarantees?: Record<string, unknown>;
  completionCriteria?: unknown[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Lint
// ---------------------------------------------------------------------------

/**
 * Deterministic structural lint of an execution plan.
 * Throws SessionError with code EXECUTION_PLAN_LINT_FAILED on any violation.
 *
 * @param plan - Raw plan object (e.g. from JSON)
 * @param dod - Validated Definition of Done (for item id reference checks)
 * @param goal - Exact Decision Lock goal string; plan must include it
 */
export function lintExecutionPlan(
  plan: unknown,
  dod: DefinitionOfDone,
  goal: string,
): void {
  if (plan === null || typeof plan !== "object") {
    throw new SessionError(
      "Execution plan must be an object",
      "EXECUTION_PLAN_LINT_FAILED",
      {},
    );
  }

  const planObj = plan as ExecutionPlanLike;
  const planText = JSON.stringify(planObj);
  const planTextLower = planText.toLowerCase();
  const goalTrimmed = goal.trim();
  if (goalTrimmed.length === 0) {
    throw new SessionError(
      "Goal string must be non-empty",
      "EXECUTION_PLAN_LINT_FAILED",
      {},
    );
  }

  // 1. Forbidden patterns (word-boundary for short tokens, substring for rest)
  for (const pattern of FORBIDDEN_WORD_PATTERNS) {
    const re = new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i");
    if (re.test(planText)) {
      throw new SessionError(
        `Execution plan contains forbidden pattern: ${pattern}`,
        "EXECUTION_PLAN_LINT_FAILED",
        { pattern },
      );
    }
  }
  for (const pattern of FORBIDDEN_HTTP_METHODS) {
    const re = new RegExp(`\\b${escapeRegex(pattern)}\\b`);
    if (re.test(planText)) {
      throw new SessionError(
        `Execution plan contains forbidden pattern: ${pattern}`,
        "EXECUTION_PLAN_LINT_FAILED",
        { pattern },
      );
    }
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (planTextLower.includes(pattern.toLowerCase())) {
      throw new SessionError(
        `Execution plan contains forbidden pattern: ${pattern}`,
        "EXECUTION_PLAN_LINT_FAILED",
        { pattern },
      );
    }
  }

  // 2. Plan must include exact goal string
  if (!planText.includes(goalTrimmed)) {
    throw new SessionError(
      "Execution plan does not include the Decision Lock goal text",
      "EXECUTION_PLAN_LINT_FAILED",
      {},
    );
  }

  // 3. nonExecutableGuarantees block
  const guarantees = planObj.nonExecutableGuarantees;
  if (guarantees === null || typeof guarantees !== "object") {
    throw new SessionError(
      "Execution plan must include nonExecutableGuarantees object",
      "EXECUTION_PLAN_LINT_FAILED",
      {},
    );
  }
  for (const key of REQUIRED_GUARANTEE_KEYS) {
    if (!(key in guarantees)) {
      throw new SessionError(
        `nonExecutableGuarantees must include "${key}"`,
        "EXECUTION_PLAN_LINT_FAILED",
        { key },
      );
    }
    if (guarantees[key] !== true) {
      throw new SessionError(
        `nonExecutableGuarantees.${key} must be true`,
        "EXECUTION_PLAN_LINT_FAILED",
        { key },
      );
    }
  }

  // 4. Steps and references
  const steps = planObj.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new SessionError(
      "Execution plan must have a non-empty steps array",
      "EXECUTION_PLAN_LINT_FAILED",
      {},
    );
  }

  const dodItemIds = new Set(dod.items.map((i) => i.id));

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as PlanStep;
    const refs = step.references;
    if (!Array.isArray(refs) || refs.length === 0) {
      throw new SessionError(
        `Step ${step.stepId ?? i} must have non-empty references array`,
        "EXECUTION_PLAN_LINT_FAILED",
        { stepIndex: i, stepId: step.stepId },
      );
    }
    for (const ref of refs) {
      if (typeof ref !== "string") {
        throw new SessionError(
          `Step ${step.stepId ?? i} references must be strings (DoD item ids)`,
          "EXECUTION_PLAN_LINT_FAILED",
          { stepIndex: i, stepId: step.stepId },
        );
      }
      if (!dodItemIds.has(ref)) {
        throw new SessionError(
          `Step ${step.stepId ?? i} references non-existent DoD item id: ${ref}`,
          "EXECUTION_PLAN_LINT_FAILED",
          { stepIndex: i, stepId: step.stepId, reference: ref },
        );
      }
    }
  }

  // 5. Completion criteria must only reference DoD item ids (no new success conditions)
  const completionCriteria = planObj.completionCriteria;
  if (Array.isArray(completionCriteria)) {
    for (let j = 0; j < completionCriteria.length; j++) {
      const entry = completionCriteria[j];
      const id =
        typeof entry === "string" ? entry : (entry as Record<string, unknown>)?.id;
      if (id !== undefined && typeof id === "string" && !dodItemIds.has(id)) {
        throw new SessionError(
          `completionCriteria references non-DoD id: ${id}`,
          "EXECUTION_PLAN_LINT_FAILED",
          { index: j, id },
        );
      }
    }
  }
}
