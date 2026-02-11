/**
 * Execution Gate — pure evaluation logic.
 *
 * This module contains a single pure function that determines whether
 * execution may proceed. It has no side effects, no I/O, and no
 * dependency on the EventStore or any other kernel module.
 *
 * PERMANENT INVARIANT: There is no permissible execution path unless
 * evaluateExecutionGate().passed === true. Session existence, session
 * status, or user intent can never authorize execution. This invariant
 * is non-overridable.
 */

import type {
  DefinitionOfDone,
  DecisionLock,
  DoDItem,
  GateCheck,
  ExecutionGateResult,
} from "./schemas.js";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";

// ---------------------------------------------------------------------------
// Item verifiability (structural, not heuristic)
// ---------------------------------------------------------------------------

interface VerifiabilityResult {
  ok: boolean;
  reason?: string;
}

/**
 * Determines whether a DoD item has all required structural fields
 * for its verification method. Pure structural check — no heuristics.
 */
function isItemVerifiable(item: DoDItem): VerifiabilityResult {
  switch (item.verificationMethod) {
    case "command_exit_code":
      if (!item.verificationCommand) {
        return { ok: false, reason: "command_exit_code requires verificationCommand" };
      }
      if (item.expectedExitCode === undefined) {
        return { ok: false, reason: "command_exit_code requires expectedExitCode" };
      }
      return { ok: true };

    case "file_exists":
      if (!item.targetPath) {
        return { ok: false, reason: "file_exists requires targetPath" };
      }
      return { ok: true };

    case "file_hash_match":
      if (!item.targetPath) {
        return { ok: false, reason: "file_hash_match requires targetPath" };
      }
      if (!item.expectedHash) {
        return { ok: false, reason: "file_hash_match requires expectedHash" };
      }
      return { ok: true };

    case "command_output_match":
      if (!item.verificationCommand) {
        return { ok: false, reason: "command_output_match requires verificationCommand" };
      }
      if (!item.expectedOutput) {
        return { ok: false, reason: "command_output_match requires expectedOutput" };
      }
      return { ok: true };

    case "artifact_recorded":
      // Always verifiable — inspectable post hoc via event store
      return { ok: true };

    case "custom":
      if (!item.verificationProcedure) {
        return { ok: false, reason: "custom requires verificationProcedure" };
      }
      if (item.verificationProcedure.length < 20) {
        return {
          ok: false,
          reason: `custom verificationProcedure must be at least 20 characters (got ${item.verificationProcedure.length})`,
        };
      }
      return { ok: true };

    default:
      return { ok: false, reason: `Unknown verification method: ${item.verificationMethod}` };
  }
}

/**
 * Determines whether a DoD item can be re-verified after execution.
 * This is a structural check — every method requires specific fields
 * that guarantee post-hoc repeatability.
 */
function isItemReverifiable(item: DoDItem): VerifiabilityResult {
  // For most methods, verifiability implies reverifiability because
  // the required fields (commands, paths, hashes) are inherently
  // re-runnable or inspectable. The custom method is the exception:
  // it requires an explicit verificationProcedure field.
  switch (item.verificationMethod) {
    case "command_exit_code":
    case "file_exists":
    case "file_hash_match":
    case "command_output_match":
    case "artifact_recorded":
      // These are inherently re-runnable/inspectable if verifiable
      return { ok: true };

    case "custom":
      if (!item.verificationProcedure) {
        return { ok: false, reason: "custom items require verificationProcedure for post-hoc verification" };
      }
      if (item.verificationProcedure.length < 20) {
        return {
          ok: false,
          reason: `custom verificationProcedure must be at least 20 characters for meaningful post-hoc verification (got ${item.verificationProcedure.length})`,
        };
      }
      return { ok: true };

    default:
      return { ok: false, reason: `Unknown verification method: ${item.verificationMethod}` };
  }
}

// ---------------------------------------------------------------------------
// Placeholder / TODO detection
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bTODO\b/i, label: "TODO" },
  { pattern: /\bFIXME\b/i, label: "FIXME" },
  { pattern: /\bTBD\b/i, label: "TBD" },
  { pattern: /\bPLACEHOLDER\b/i, label: "PLACEHOLDER" },
  { pattern: /\bXXX\b/, label: "XXX" },
];

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate whether execution may proceed.
 *
 * Takes a DefinitionOfDone and DecisionLock (already parsed/validated
 * by Zod schemas). Returns a structured result with every check
 * evaluated — failures do not short-circuit.
 *
 * INVARIANT: Execution is permitted if and only if the returned
 * result has passed === true.
 */
export function evaluateExecutionGate(
  dod: DefinitionOfDone | null | undefined,
  lock: DecisionLock | null | undefined,
): ExecutionGateResult {
  const checks: GateCheck[] = [];

  // --- DoD existence and structure ---

  const dodExists = dod != null;
  checks.push({
    checkId: "dod-exists",
    description: "Definition of Done must exist",
    passed: dodExists,
    ...(dodExists ? {} : { failureReason: "No Definition of Done provided" }),
  });

  const dodHasItems = dodExists && dod.items.length > 0;
  checks.push({
    checkId: "dod-has-items",
    description: "DoD must contain at least one verifiable item",
    passed: dodHasItems,
    ...(dodHasItems ? {} : { failureReason: dodExists ? "DoD contains no items" : "DoD does not exist" }),
  });

  // --- DoD item verifiability ---

  if (dodExists) {
    for (const item of dod.items) {
      const result = isItemVerifiable(item);
      checks.push({
        checkId: `dod-item-verifiable-${item.id}`,
        description: `DoD item "${item.id}" must have required fields for ${item.verificationMethod}`,
        passed: result.ok,
        ...(result.ok ? {} : { failureReason: result.reason }),
      });
    }
  }

  // --- Lock existence and status ---

  const lockExists = lock != null;
  checks.push({
    checkId: "lock-exists",
    description: "Decision Lock must exist",
    passed: lockExists,
    ...(lockExists ? {} : { failureReason: "No Decision Lock provided" }),
  });

  const lockApproved = lockExists && lock.status === "approved";
  checks.push({
    checkId: "lock-approved",
    description: "Decision Lock status must be 'approved'",
    passed: lockApproved,
    ...(lockApproved
      ? {}
      : {
          failureReason: lockExists
            ? `Lock status is "${lock.status}", expected "approved"`
            : "Decision Lock does not exist",
        }),
  });

  const hasApprovalMeta =
    lockExists && lock.status === "approved"
      ? lock.approvalMetadata !== undefined
      : true; // only checked when approved
  checks.push({
    checkId: "lock-has-approval-metadata",
    description: "Approved Decision Lock must have approvalMetadata",
    passed: lockApproved ? hasApprovalMeta : !lockExists ? false : lock!.status !== "approved",
    ...(lockApproved && !hasApprovalMeta
      ? { failureReason: "Lock is approved but approvalMetadata is missing" }
      : !lockExists
        ? { failureReason: "Decision Lock does not exist" }
        : {}),
  });

  // --- Lock references DoD ---

  const lockRefsDod =
    dodExists && lockExists ? lock.dodId === dod.dodId : false;
  checks.push({
    checkId: "lock-references-dod",
    description: "Decision Lock dodId must match DoD dodId",
    passed: lockRefsDod,
    ...(lockRefsDod
      ? {}
      : {
          failureReason:
            dodExists && lockExists
              ? `Lock dodId="${lock.dodId}" does not match DoD dodId="${dod.dodId}"`
              : "DoD or Lock does not exist",
        }),
  });

  // --- Lock required sections ---

  const goalPresent = lockExists && lock.goal.length > 0;
  checks.push({
    checkId: "lock-goal-present",
    description: "Decision Lock must have a non-empty goal",
    passed: goalPresent,
    ...(goalPresent ? {} : { failureReason: lockExists ? "goal is empty" : "Decision Lock does not exist" }),
  });

  const nonGoalsPresent =
    lockExists && Array.isArray(lock.nonGoals) && lock.nonGoals.length > 0;
  checks.push({
    checkId: "lock-non-goals-present",
    description: "Decision Lock must have at least one non-goal",
    passed: nonGoalsPresent,
    ...(nonGoalsPresent
      ? {}
      : { failureReason: lockExists ? "nonGoals is empty" : "Decision Lock does not exist" }),
  });

  const invariantsPresent =
    lockExists &&
    Array.isArray(lock.invariants) &&
    lock.invariants.length > 0;
  checks.push({
    checkId: "lock-invariants-present",
    description: "Decision Lock must have at least one invariant",
    passed: invariantsPresent,
    ...(invariantsPresent
      ? {}
      : {
          failureReason: lockExists
            ? "invariants is empty"
            : "Decision Lock does not exist",
        }),
  });

  // --- Placeholder detection in Lock ---

  if (lockExists) {
    const lockJson = JSON.stringify(lock);
    for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
      const found = pattern.test(lockJson);
      checks.push({
        checkId: `lock-no-${label.toLowerCase()}`,
        description: `Decision Lock must not contain "${label}" placeholders`,
        passed: !found,
        ...(found
          ? { failureReason: `Found "${label}" in Decision Lock content` }
          : {}),
      });
    }
  } else {
    for (const { label } of PLACEHOLDER_PATTERNS) {
      checks.push({
        checkId: `lock-no-${label.toLowerCase()}`,
        description: `Decision Lock must not contain "${label}" placeholders`,
        passed: false,
        failureReason: "Decision Lock does not exist",
      });
    }
  }

  // --- Placeholder detection in DoD ---

  if (dodExists) {
    const dodJson = JSON.stringify(dod);
    for (const { pattern, label } of PLACEHOLDER_PATTERNS) {
      const found = pattern.test(dodJson);
      checks.push({
        checkId: `dod-no-${label.toLowerCase()}`,
        description: `DoD must not contain "${label}" placeholders`,
        passed: !found,
        ...(found
          ? { failureReason: `Found "${label}" in DoD content` }
          : {}),
      });
    }
  } else {
    for (const { label } of PLACEHOLDER_PATTERNS) {
      checks.push({
        checkId: `dod-no-${label.toLowerCase()}`,
        description: `DoD must not contain "${label}" placeholders`,
        passed: false,
        failureReason: "DoD does not exist",
      });
    }
  }

  // --- Reverifiability ---

  if (dodExists) {
    let allReverifiable = true;
    const failures: string[] = [];
    for (const item of dod.items) {
      const result = isItemReverifiable(item);
      if (!result.ok) {
        allReverifiable = false;
        failures.push(`${item.id}: ${result.reason}`);
      }
    }
    checks.push({
      checkId: "dod-items-reverifiable",
      description:
        "Every DoD item must have structural fields for post-hoc verification",
      passed: allReverifiable,
      ...(allReverifiable
        ? {}
        : { failureReason: failures.join("; ") }),
    });
  } else {
    checks.push({
      checkId: "dod-items-reverifiable",
      description:
        "Every DoD item must have structural fields for post-hoc verification",
      passed: false,
      failureReason: "DoD does not exist",
    });
  }

  // --- Final result ---

  const passed = checks.every((c) => c.passed);

  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: dodExists ? dod.sessionId : lockExists ? lock.sessionId : "00000000-0000-4000-8000-000000000000",
    passed,
    checks,
    evaluatedAt: new Date().toISOString(),
  };
}
