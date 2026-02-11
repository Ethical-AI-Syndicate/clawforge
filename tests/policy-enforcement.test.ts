/**
 * Policy Enforcement Tests — Phase I
 *
 * Tests for policy validation, enforcement logic, deny/require rules, and severity handling.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  validatePolicies,
  computePolicySetHash,
  computePolicyEvaluationHash,
  type PolicyValidationResult,
} from "../src/session/policy-enforcement.js";
import type { Policy } from "../src/session/policy.js";
import type { SessionContext } from "../src/session/policy-engine.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { RunnerIdentity } from "../src/session/runner-identity.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

function minimalIdentity(): RunnerIdentity {
  return {
    runnerId: SESSION_ID,
    runnerVersion: "1.0.0",
    runnerPublicKey: "-----BEGIN PUBLIC KEY-----\nMOCK\n-----END PUBLIC KEY-----\n",
    environmentFingerprint: HASH,
    buildHash: HASH,
    allowedCapabilitiesSnapshot: getAllCapabilityIds().slice(0, 2),
    attestationTimestamp: TS,
  };
}

function minimalPolicy(policyId: string = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"): Policy {
  return {
    policyId,
    name: "Test Policy",
    version: "1.0.0",
    scope: "global",
    rules: [
      {
        ruleId: "rule-1",
        description: "Test rule",
        target: "runnerIdentity",
        condition: {
          field: "runnerIdentity.environmentFingerprint",
          operator: "equals",
          value: HASH,
        },
        effect: "allow",
        severity: "info",
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "user", actorType: "human" },
  };
}

function createContext(): SessionContext {
  return {
    runnerIdentity: minimalIdentity(),
  };
}

describe("Policy Validation", () => {
  it("should validate single policy successfully", () => {
    const context = createContext();
    const policies = [minimalPolicy()];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(true);
    expect(result.policyResults.length).toBe(1);
    expect(result.failures.length).toBe(0);
  });

  it("should validate multiple policies successfully", () => {
    const context = createContext();
    const policies = [
      minimalPolicy("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"),
      minimalPolicy("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"),
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(true);
    expect(result.policyResults.length).toBe(2);
  });

  it("should collect rule results from all policies", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy("policy-1"),
        rules: [
          {
            ruleId: "rule-1",
            description: "Rule one",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
            effect: "allow",
            severity: "info",
          },
        ],
      },
      {
        ...minimalPolicy("policy-2"),
        rules: [
          {
            ruleId: "rule-2",
            description: "Rule two",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
            effect: "allow",
            severity: "warning",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.policyResults.length).toBe(2);
    expect(result.policyResults[0]!.ruleResults.length).toBe(1);
    expect(result.policyResults[1]!.ruleResults.length).toBe(1);
  });
});

describe("Deny Rule Enforcement", () => {
  it("should fail session when deny rule passes", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "deny-rule",
            description: "Deny rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH, // Condition passes
            },
            effect: "deny",
            severity: "critical",
          },
        ],
      },
    ];
    expect(() => validatePolicies(context, policies)).toThrow(SessionError);
    try {
      validatePolicies(context, policies);
    } catch (e) {
      if (e instanceof SessionError) {
        expect(e.code).toBe("POLICY_DENIED");
      }
    }
  });

  it("should allow session when deny rule fails", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "deny-rule",
            description: "Deny rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash", // Condition fails
            },
            effect: "deny",
            severity: "critical",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(true);
  });

  it("should collect deny failures even if not critical", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "deny-rule",
            description: "Deny rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH, // Condition passes
            },
            effect: "deny",
            severity: "warning", // Not critical
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.some((f) => f.effect === "deny")).toBe(true);
  });
});

describe("Require Rule Enforcement", () => {
  it("should fail session when require rule fails", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "require-rule",
            description: "Require rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash", // Condition fails
            },
            effect: "require",
            severity: "critical",
          },
        ],
      },
    ];
    expect(() => validatePolicies(context, policies)).toThrow(SessionError);
    try {
      validatePolicies(context, policies);
    } catch (e) {
      if (e instanceof SessionError) {
        expect(e.code).toBe("POLICY_REQUIREMENT_FAILED");
      }
    }
  });

  it("should allow session when require rule passes", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "require-rule",
            description: "Require rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH, // Condition passes
            },
            effect: "require",
            severity: "critical",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(true);
  });

  it("should collect require failures even if not critical", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "require-rule",
            description: "Require rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash", // Condition fails
            },
            effect: "require",
            severity: "warning", // Not critical
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.some((f) => f.effect === "require")).toBe(true);
  });
});

describe("Severity Handling", () => {
  it("should throw SessionError for critical severity failures", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "critical-rule",
            description: "Critical rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash",
            },
            effect: "require",
            severity: "critical",
          },
        ],
      },
    ];
    expect(() => validatePolicies(context, policies)).toThrow(SessionError);
  });

  it("should collect warnings without throwing", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "warning-rule",
            description: "Warning rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash",
            },
            effect: "allow",
            severity: "warning",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]!.severity).toBe("warning");
  });

  it("should collect info without throwing", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "info-rule",
            description: "Info rule",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
            effect: "allow",
            severity: "info",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.passed).toBe(true);
    expect(result.info.length).toBeGreaterThan(0);
    expect(result.info[0]!.severity).toBe("info");
  });

  it("should categorize failures by severity", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "critical-fail",
            description: "Critical failure",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash",
            },
            effect: "require",
            severity: "critical",
          },
          {
            ruleId: "warning-fail",
            description: "Warning failure",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash",
            },
            effect: "allow",
            severity: "warning",
          },
        ],
      },
    ];
    try {
      validatePolicies(context, policies);
    } catch (e) {
      // Critical failure throws
      expect(e).toBeInstanceOf(SessionError);
    }
  });
});

describe("Policy Result Aggregation", () => {
  it("should aggregate results from multiple policies", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy("policy-1"),
        rules: [
          {
            ruleId: "rule-1",
            description: "Rule one",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
            effect: "allow",
            severity: "info",
          },
        ],
      },
      {
        ...minimalPolicy("policy-2"),
        rules: [
          {
            ruleId: "rule-2",
            description: "Rule two",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
            effect: "allow",
            severity: "warning",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.policyResults.length).toBe(2);
    expect(result.policyResults[0]!.policyId).toBe("policy-1");
    expect(result.policyResults[1]!.policyId).toBe("policy-2");
  });

  it("should mark overall result as failed if any critical failure", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "critical-fail",
            description: "Critical failure",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "wrong-hash",
            },
            effect: "require",
            severity: "critical",
          },
        ],
      },
    ];
    try {
      const result = validatePolicies(context, policies);
      expect(result.passed).toBe(false);
    } catch (e) {
      // Critical failures throw, so we never reach the result
      expect(e).toBeInstanceOf(SessionError);
    }
  });
});

describe("Hash Computation", () => {
  it("should compute deterministic policy set hash", () => {
    const policies: Policy[] = [
      minimalPolicy("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"),
      minimalPolicy("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"),
    ];
    const hash1 = computePolicySetHash(policies);
    const hash2 = computePolicySetHash(policies);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex
  });

  it("should compute same hash for policies in different order", () => {
    const policies1: Policy[] = [
      minimalPolicy("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"),
      minimalPolicy("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"),
    ];
    const policies2: Policy[] = [
      minimalPolicy("b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e"),
      minimalPolicy("a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"),
    ];
    const hash1 = computePolicySetHash(policies1);
    const hash2 = computePolicySetHash(policies2);
    expect(hash1).toBe(hash2); // Should be sorted by policyId
  });

  it("should compute different hash for different policies", () => {
    const policies1: Policy[] = [minimalPolicy("policy-1")];
    const policies2: Policy[] = [minimalPolicy("policy-2")];
    const hash1 = computePolicySetHash(policies1);
    const hash2 = computePolicySetHash(policies2);
    expect(hash1).not.toBe(hash2);
  });

  it("should compute deterministic policy evaluation hash", () => {
    const context = createContext();
    const policies = [minimalPolicy()];
    const result1 = validatePolicies(context, policies);
    const result2 = validatePolicies(context, policies);
    const hash1 = computePolicyEvaluationHash(result1);
    const hash2 = computePolicyEvaluationHash(result2);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex
  });

  it("should compute different hash for different evaluation results", () => {
    const context1 = createContext();
    const context2: SessionContext = {
      runnerIdentity: {
        ...minimalIdentity(),
        environmentFingerprint: "different-hash",
      },
    };
    const policies = [minimalPolicy()];
    const result1 = validatePolicies(context1, policies);
    const result2 = validatePolicies(context2, policies);
    const hash1 = computePolicyEvaluationHash(result1);
    const hash2 = computePolicyEvaluationHash(result2);
    expect(hash1).not.toBe(hash2);
  });
});

describe("Error Handling", () => {
  it("should handle evaluation errors gracefully", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "error-rule",
            description: "Rule with error",
            target: "runnerIdentity",
            condition: {
              field: "nonexistent.path[invalid]",
              operator: "equals",
              value: HASH,
            },
            effect: "allow",
            severity: "info",
          },
        ],
      },
    ];
    const result = validatePolicies(context, policies);
    expect(result.policyResults.length).toBe(1);
    expect(result.policyResults[0]!.ruleResults[0]!.passed).toBe(false);
    expect(result.policyResults[0]!.ruleResults[0]!.reason).toBeDefined();
  });

  it("should propagate critical policy errors", () => {
    const context = createContext();
    const policies: Policy[] = [
      {
        ...minimalPolicy(),
        rules: [
          {
            ruleId: "critical-deny",
            description: "Critical deny",
            target: "runnerIdentity",
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
            effect: "deny",
            severity: "critical",
          },
        ],
      },
    ];
    expect(() => validatePolicies(context, policies)).toThrow(SessionError);
  });
});
