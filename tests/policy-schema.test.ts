/**
 * Policy Schema Tests — Phase I
 *
 * Tests for policy schema validation and structure.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  PolicySchema,
  PolicyRuleSchema,
  PolicyConditionSchema,
  validatePolicy,
  type Policy,
  type PolicyRule,
  type PolicyCondition,
} from "../src/session/policy.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";

const POLICY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";

function minimalCondition(): PolicyCondition {
  return {
    field: "runnerIdentity.environmentFingerprint",
    operator: "equals",
    value: "approved-hash",
  };
}

function minimalRule(): PolicyRule {
  return {
    ruleId: "rule-1",
    description: "Test rule",
    target: "runnerIdentity",
    condition: minimalCondition(),
    effect: "allow",
    severity: "info",
  };
}

function minimalPolicy(): Policy {
  return {
    policyId: POLICY_ID,
    name: "Test Policy",
    version: "1.0.0",
    scope: "global",
    rules: [minimalRule()],
    createdAt: TS,
    createdBy: { actorId: "user", actorType: "human" },
  };
}

describe("Policy Schema", () => {
  describe("PolicyConditionSchema", () => {
    it("should accept valid condition", () => {
      const condition = minimalCondition();
      expect(() => PolicyConditionSchema.parse(condition)).not.toThrow();
    });

    it("should reject missing field", () => {
      const condition = minimalCondition();
      delete (condition as Record<string, unknown>).field;
      expect(() => PolicyConditionSchema.parse(condition)).toThrow();
    });

    it("should reject empty field", () => {
      const condition = minimalCondition();
      condition.field = "";
      expect(() => PolicyConditionSchema.parse(condition)).toThrow();
    });

    it("should reject field exceeding max length", () => {
      const condition = minimalCondition();
      condition.field = "a".repeat(501);
      expect(() => PolicyConditionSchema.parse(condition)).toThrow();
    });

    it("should reject invalid operator", () => {
      const condition = minimalCondition();
      (condition as Record<string, unknown>).operator = "invalid_operator";
      expect(() => PolicyConditionSchema.parse(condition)).toThrow();
    });

    it("should accept all valid operators", () => {
      const operators = [
        "equals",
        "not_equals",
        "in",
        "not_in",
        "subset_of",
        "superset_of",
        "greater_than",
        "less_than",
        "exists",
        "matches_regex",
      ];
      for (const op of operators) {
        const condition = { ...minimalCondition(), operator: op as PolicyCondition["operator"] };
        expect(() => PolicyConditionSchema.parse(condition)).not.toThrow();
      }
    });

    it("should accept any value type", () => {
      const values = ["string", 123, true, null, ["array"], { object: "value" }];
      for (const val of values) {
        const condition = { ...minimalCondition(), value: val };
        expect(() => PolicyConditionSchema.parse(condition)).not.toThrow();
      }
    });
  });

  describe("PolicyRuleSchema", () => {
    it("should accept valid rule", () => {
      const rule = minimalRule();
      expect(() => PolicyRuleSchema.parse(rule)).not.toThrow();
    });

    it("should reject missing ruleId", () => {
      const rule = minimalRule();
      delete (rule as Record<string, unknown>).ruleId;
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should reject ruleId exceeding max length", () => {
      const rule = minimalRule();
      rule.ruleId = "a".repeat(101);
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should reject missing description", () => {
      const rule = minimalRule();
      delete (rule as Record<string, unknown>).description;
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should reject description exceeding max length", () => {
      const rule = minimalRule();
      rule.description = "a".repeat(1001);
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should reject invalid target", () => {
      const rule = minimalRule();
      (rule as Record<string, unknown>).target = "invalid_target";
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should accept all valid targets", () => {
      const targets = ["plan", "evidence", "attestation", "runnerIdentity", "capability"];
      for (const target of targets) {
        const rule = { ...minimalRule(), target: target as PolicyRule["target"] };
        expect(() => PolicyRuleSchema.parse(rule)).not.toThrow();
      }
    });

    it("should reject invalid effect", () => {
      const rule = minimalRule();
      (rule as Record<string, unknown>).effect = "invalid_effect";
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should accept all valid effects", () => {
      const effects = ["allow", "deny", "require"];
      for (const effect of effects) {
        const rule = { ...minimalRule(), effect: effect as PolicyRule["effect"] };
        expect(() => PolicyRuleSchema.parse(rule)).not.toThrow();
      }
    });

    it("should reject invalid severity", () => {
      const rule = minimalRule();
      (rule as Record<string, unknown>).severity = "invalid_severity";
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });

    it("should accept all valid severities", () => {
      const severities = ["info", "warning", "critical"];
      for (const severity of severities) {
        const rule = { ...minimalRule(), severity: severity as PolicyRule["severity"] };
        expect(() => PolicyRuleSchema.parse(rule)).not.toThrow();
      }
    });

    it("should reject missing condition", () => {
      const rule = minimalRule();
      delete (rule as Record<string, unknown>).condition;
      expect(() => PolicyRuleSchema.parse(rule)).toThrow();
    });
  });

  describe("PolicySchema", () => {
    it("should accept valid policy", () => {
      const policy = minimalPolicy();
      expect(() => PolicySchema.parse(policy)).not.toThrow();
    });

    it("should reject missing policyId", () => {
      const policy = minimalPolicy();
      delete (policy as Record<string, unknown>).policyId;
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject invalid policyId format", () => {
      const policy = minimalPolicy();
      policy.policyId = "not-a-uuid";
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject missing name", () => {
      const policy = minimalPolicy();
      delete (policy as Record<string, unknown>).name;
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject name exceeding max length", () => {
      const policy = minimalPolicy();
      policy.name = "a".repeat(201);
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject missing version", () => {
      const policy = minimalPolicy();
      delete (policy as Record<string, unknown>).version;
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject invalid version format", () => {
      const policy = minimalPolicy();
      policy.version = "not-semver";
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should accept valid semantic versions", () => {
      const versions = ["1.0.0", "2.1.3", "0.0.1", "10.20.30", "1.0.0-alpha", "2.0.0-beta.1"];
      for (const version of versions) {
        const policy = { ...minimalPolicy(), version };
        expect(() => PolicySchema.parse(policy)).not.toThrow();
      }
    });

    it("should reject invalid scope", () => {
      const policy = minimalPolicy();
      (policy as Record<string, unknown>).scope = "invalid_scope";
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should accept all valid scopes", () => {
      const scopes = ["session", "plan", "runner", "capability", "global"];
      for (const scope of scopes) {
        const policy = { ...minimalPolicy(), scope: scope as Policy["scope"] };
        expect(() => PolicySchema.parse(policy)).not.toThrow();
      }
    });

    it("should reject empty rules array", () => {
      const policy = minimalPolicy();
      policy.rules = [];
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject rules exceeding max count", () => {
      const policy = minimalPolicy();
      policy.rules = Array(1001).fill(minimalRule());
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should accept multiple rules", () => {
      const policy = minimalPolicy();
      policy.rules = [minimalRule(), minimalRule(), minimalRule()];
      policy.rules[1]!.ruleId = "rule-2";
      policy.rules[2]!.ruleId = "rule-3";
      expect(() => PolicySchema.parse(policy)).not.toThrow();
    });

    it("should reject missing createdAt", () => {
      const policy = minimalPolicy();
      delete (policy as Record<string, unknown>).createdAt;
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject invalid createdAt format", () => {
      const policy = minimalPolicy();
      policy.createdAt = "not-iso8601";
      expect(() => PolicySchema.parse(policy)).toThrow();
    });

    it("should reject missing createdBy", () => {
      const policy = minimalPolicy();
      delete (policy as Record<string, unknown>).createdBy;
      expect(() => PolicySchema.parse(policy)).toThrow();
    });
  });

  describe("validatePolicy", () => {
    it("should return validated policy for valid input", () => {
      const policy = minimalPolicy();
      const result = validatePolicy(policy);
      expect(result).toBeDefined();
      expect(result.policyId).toBe(policy.policyId);
    });

    it("should throw SessionError for invalid schema", () => {
      const policy = minimalPolicy();
      policy.policyId = "not-a-uuid";
      expect(() => validatePolicy(policy)).toThrow(SessionError);
      try {
        validatePolicy(policy);
      } catch (e) {
        if (e instanceof SessionError) {
          expect(e.code).toBe("POLICY_INVALID");
        }
      }
    });

    it("should throw SessionError for missing required fields", () => {
      const policy = minimalPolicy();
      delete (policy as Record<string, unknown>).name;
      expect(() => validatePolicy(policy)).toThrow(SessionError);
    });
  });
});
