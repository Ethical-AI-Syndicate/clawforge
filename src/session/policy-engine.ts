/**
 * Policy Engine — Phase I
 *
 * Deterministic policy evaluation engine.
 * Evaluates policies against session context using structured rules.
 * No code execution. No dynamic loading. Fail-closed.
 */

import { SessionError } from "./errors.js";
import type { Policy, PolicyRule, PolicyCondition } from "./policy.js";
import type { DefinitionOfDone, DecisionLock } from "./schemas.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import type { RunnerEvidence } from "./runner-contract.js";
import type { RunnerIdentity } from "./runner-identity.js";
import type { RunnerAttestation } from "./runner-attestation.js";
import type { SessionAnchor } from "./session-anchor.js";

// ---------------------------------------------------------------------------
// Session Context
// ---------------------------------------------------------------------------

export interface SessionContext {
  dod?: DefinitionOfDone;
  decisionLock?: DecisionLock;
  executionPlan?: ExecutionPlanLike;
  evidenceChain?: RunnerEvidence[];
  runnerIdentity?: RunnerIdentity;
  runnerAttestation?: RunnerAttestation;
  anchor?: SessionAnchor;
}

// ---------------------------------------------------------------------------
// Evaluation Results
// ---------------------------------------------------------------------------

export interface RuleEvaluationResult {
  ruleId: string;
  passed: boolean;
  severity: "info" | "warning" | "critical";
  effect: "allow" | "deny" | "require";
  reason?: string;
}

export interface PolicyEvaluationResult {
  policyId: string;
  policyName: string;
  passed: boolean;
  ruleResults: RuleEvaluationResult[];
}

// ---------------------------------------------------------------------------
// Field Path Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve field path safely from session context.
 * Supports dot notation and array indexing.
 * Fails closed on unknown paths.
 *
 * @param context - Session context
 * @param path - Dot-notation path (e.g., "runnerIdentity.environmentFingerprint" or "evidenceChain[0].stepId")
 * @returns Resolved value or undefined if path not found
 * @throws SessionError with code POLICY_FIELD_PATH_INVALID on invalid path
 */
export function resolveFieldPath(
  context: SessionContext,
  path: string,
): unknown {
  if (!path || path.length === 0) {
    throw new SessionError(
      "Field path cannot be empty",
      "POLICY_FIELD_PATH_INVALID",
      { path },
    );
  }

  // Split path into segments (handle array indexing)
  const segments: Array<string | number> = [];
  let current = path;
  
  while (current.length > 0) {
    // Check for array index: [number]
    const arrayMatch = current.match(/^(\w+)\[(\d+)\]/);
    if (arrayMatch) {
      segments.push(arrayMatch[1]!);
      segments.push(parseInt(arrayMatch[2]!, 10));
      current = current.slice(arrayMatch[0]!.length);
      if (current.startsWith(".")) {
        current = current.slice(1);
      }
    } else {
      // Regular property access
      const dotIndex = current.indexOf(".");
      if (dotIndex === -1) {
        segments.push(current);
        break;
      } else {
        segments.push(current.slice(0, dotIndex));
        current = current.slice(dotIndex + 1);
      }
    }
  }

  // Resolve path starting from context
  let value: unknown = context;
  
  for (const segment of segments) {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof segment === "number") {
      // Array access
      if (!Array.isArray(value)) {
        throw new SessionError(
          `Cannot index into non-array at path "${path}"`,
          "POLICY_FIELD_PATH_INVALID",
          { path, segment },
        );
      }
      if (segment < 0 || segment >= value.length) {
        return undefined;
      }
      value = value[segment];
    } else {
      // Property access
      if (typeof value !== "object") {
        throw new SessionError(
          `Cannot access property "${segment}" on non-object at path "${path}"`,
          "POLICY_FIELD_PATH_INVALID",
          { path, segment },
        );
      }

      // Safe property access - no prototype access
      if (!Object.prototype.hasOwnProperty.call(value, segment)) {
        // Check known context properties
        const contextKey = segments[0];
        if (
          contextKey === "dod" ||
          contextKey === "decisionLock" ||
          contextKey === "executionPlan" ||
          contextKey === "evidenceChain" ||
          contextKey === "runnerIdentity" ||
          contextKey === "runnerAttestation" ||
          contextKey === "anchor"
        ) {
          return undefined;
        }
        throw new SessionError(
          `Unknown field path "${path}"`,
          "POLICY_FIELD_PATH_INVALID",
          { path, segment },
        );
      }

      value = (value as Record<string, unknown>)[segment];
    }
  }

  return value;
}

// ---------------------------------------------------------------------------
// Operator Evaluation
// ---------------------------------------------------------------------------

type Operator = PolicyCondition["operator"];

/**
 * Evaluate condition using specified operator.
 *
 * @param fieldValue - Value from field path
 * @param operator - Operator to apply
 * @param conditionValue - Value from condition
 * @returns true if condition passes
 * @throws SessionError on unsupported operator or type mismatch
 */
function evaluateOperator(
  fieldValue: unknown,
  operator: Operator,
  conditionValue: unknown,
): boolean {
  switch (operator) {
    case "equals":
      return fieldValue === conditionValue;

    case "not_equals":
      return fieldValue !== conditionValue;

    case "in":
      if (!Array.isArray(conditionValue)) {
        throw new SessionError(
          `Operator "in" requires array value`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, valueType: typeof conditionValue },
        );
      }
      return conditionValue.includes(fieldValue);

    case "not_in":
      if (!Array.isArray(conditionValue)) {
        throw new SessionError(
          `Operator "not_in" requires array value`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, valueType: typeof conditionValue },
        );
      }
      return !conditionValue.includes(fieldValue);

    case "subset_of":
      if (!Array.isArray(fieldValue) || !Array.isArray(conditionValue)) {
        throw new SessionError(
          `Operator "subset_of" requires both values to be arrays`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, fieldType: typeof fieldValue, valueType: typeof conditionValue },
        );
      }
      const fieldSet = new Set(fieldValue);
      const conditionSet = new Set(conditionValue);
      for (const item of fieldSet) {
        if (!conditionSet.has(item)) {
          return false;
        }
      }
      return true;

    case "superset_of":
      if (!Array.isArray(fieldValue) || !Array.isArray(conditionValue)) {
        throw new SessionError(
          `Operator "superset_of" requires both values to be arrays`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, fieldType: typeof fieldValue, valueType: typeof conditionValue },
        );
      }
      const fieldSet2 = new Set(fieldValue);
      const conditionSet2 = new Set(conditionValue);
      for (const item of conditionSet2) {
        if (!fieldSet2.has(item)) {
          return false;
        }
      }
      return true;

    case "greater_than":
      if (
        typeof fieldValue !== "number" ||
        typeof conditionValue !== "number"
      ) {
        throw new SessionError(
          `Operator "greater_than" requires numeric values`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, fieldType: typeof fieldValue, valueType: typeof conditionValue },
        );
      }
      return fieldValue > conditionValue;

    case "less_than":
      if (
        typeof fieldValue !== "number" ||
        typeof conditionValue !== "number"
      ) {
        throw new SessionError(
          `Operator "less_than" requires numeric values`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, fieldType: typeof fieldValue, valueType: typeof conditionValue },
        );
      }
      return fieldValue < conditionValue;

    case "exists":
      return fieldValue !== null && fieldValue !== undefined;

    case "matches_regex": {
      if (typeof fieldValue !== "string" || typeof conditionValue !== "string") {
        throw new SessionError(
          `Operator "matches_regex" requires string values`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, fieldType: typeof fieldValue, valueType: typeof conditionValue },
        );
      }

      // Regex safety bounds
      const MAX_PATTERN_LENGTH = 200;
      const MAX_INPUT_LENGTH = 1000;
      const REGEX_TIMEOUT_MS = 100;

      if (conditionValue.length > MAX_PATTERN_LENGTH) {
        throw new SessionError(
          `Regex pattern exceeds maximum length of ${MAX_PATTERN_LENGTH}`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, patternLength: conditionValue.length },
        );
      }

      if (fieldValue.length > MAX_INPUT_LENGTH) {
        throw new SessionError(
          `Regex input exceeds maximum length of ${MAX_INPUT_LENGTH}`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, inputLength: fieldValue.length },
        );
      }

      // Validate regex pattern (no lookahead/behind, no backreferences)
      const dangerousPatterns = [
        /\(\?[<=!]/,
        /\\\d+/,
        /\(\?\</,
        /\(\?\>/,
        /\(\?\!/,
        /\(\?\=/,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(conditionValue)) {
          throw new SessionError(
            `Regex pattern contains unsupported features (lookahead/behind/backreferences)`,
            "POLICY_OPERATOR_UNSUPPORTED",
            { operator, pattern: conditionValue },
          );
        }
      }

      // Execute regex with timeout
      try {
        const regex = new RegExp(conditionValue);
        const startTime = Date.now();
        const result = regex.test(fieldValue);
        const elapsed = Date.now() - startTime;
        if (elapsed > REGEX_TIMEOUT_MS) {
          throw new SessionError(
            `Regex evaluation exceeded timeout of ${REGEX_TIMEOUT_MS}ms`,
            "POLICY_OPERATOR_UNSUPPORTED",
            { operator, elapsed },
          );
        }
        return result;
      } catch (error) {
        if (error instanceof SessionError) {
          throw error;
        }
        throw new SessionError(
          `Regex evaluation error: ${error instanceof Error ? error.message : String(error)}`,
          "POLICY_OPERATOR_UNSUPPORTED",
          { operator, pattern: conditionValue },
        );
      }
    }

    default:
      throw new SessionError(
        `Unsupported operator: ${operator}`,
        "POLICY_OPERATOR_UNSUPPORTED",
        { operator },
      );
  }
}

// ---------------------------------------------------------------------------
// Policy Evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a single policy against session context.
 *
 * @param policy - Policy to evaluate
 * @param context - Session context
 * @returns Policy evaluation result
 * @throws SessionError on evaluation errors
 */
export function evaluatePolicy(
  policy: Policy,
  context: SessionContext,
): PolicyEvaluationResult {
  const ruleResults: RuleEvaluationResult[] = [];

  for (const rule of policy.rules) {
    let passed = false;
    let reason: string | undefined;

    try {
      // Resolve field value
      const fieldValue = resolveFieldPath(context, rule.condition.field);

      // Evaluate condition
      passed = evaluateOperator(
        fieldValue,
        rule.condition.operator,
        rule.condition.value,
      );
    } catch (error) {
      // Fail closed: evaluation errors cause rule to fail
      passed = false;
      reason =
        error instanceof Error
          ? error.message
          : `Evaluation error: ${String(error)}`;
    }

    ruleResults.push({
      ruleId: rule.ruleId,
      passed,
      severity: rule.severity,
      effect: rule.effect,
      reason,
    });
  }

  // Policy passes if all rules pass (individual rule effects handled in enforcement)
  const passed = ruleResults.every((r) => r.passed);

  return {
    policyId: policy.policyId,
    policyName: policy.name,
    passed,
    ruleResults,
  };
}
