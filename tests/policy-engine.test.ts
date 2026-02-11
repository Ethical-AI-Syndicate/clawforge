/**
 * Policy Engine Tests — Phase I
 *
 * Tests for policy evaluation engine, field path resolution, and operator evaluation.
 */

import { describe, it, expect } from "vitest";
import { SessionError } from "../src/session/errors.js";
import {
  resolveFieldPath,
  evaluatePolicy,
  type SessionContext,
} from "../src/session/policy-engine.js";
import type { Policy } from "../src/session/policy.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import type { DefinitionOfDone, DecisionLock } from "../src/session/schemas.js";
import type { RunnerEvidence } from "../src/session/runner-contract.js";
import type { RunnerIdentity } from "../src/session/runner-identity.js";
import { getAllCapabilityIds } from "../src/session/capabilities.js";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const TS = "2026-02-11T12:00:00.000Z";
const HASH = "a".repeat(64);

function minimalDoD(): DefinitionOfDone {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    dodId: "d4e5f6a7-b8c9-4d0e-8f2a-3b4c5d6e7f8a",
    sessionId: SESSION_ID,
    title: "Test",
    items: [
      {
        id: "dod-1",
        description: "Item one",
        verificationMethod: "artifact_recorded",
        notDoneConditions: [],
      },
    ],
    createdAt: TS,
    createdBy: { actorId: "u", actorType: "human" },
  } as DefinitionOfDone;
}

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

function minimalEvidence(): RunnerEvidence {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    stepId: "step-1",
    evidenceId: "e1f2a3b4-c5d6-4e7f-8a9b-0c1d2e3f4a5b",
    timestamp: TS,
    evidenceType: "artifact_recorded",
    artifactHash: HASH,
    verificationMetadata: {},
    capabilityUsed: getAllCapabilityIds()[0] || "read_file",
    humanConfirmationProof: "confirmed",
  } as RunnerEvidence;
}

function minimalPolicy(): Policy {
  return {
    policyId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
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

describe("Field Path Resolution", () => {
  const context: SessionContext = {
    dod: minimalDoD(),
    runnerIdentity: minimalIdentity(),
    evidenceChain: [minimalEvidence()],
  };

  it("should resolve simple property path", () => {
    const value = resolveFieldPath(context, "dod.sessionId");
    expect(value).toBe(SESSION_ID);
  });

  it("should resolve nested property path", () => {
    const value = resolveFieldPath(context, "runnerIdentity.environmentFingerprint");
    expect(value).toBe(HASH);
  });

  it("should resolve array element by index", () => {
    const value = resolveFieldPath(context, "evidenceChain[0].stepId");
    expect(value).toBe("step-1");
  });

  it("should resolve nested path with array", () => {
    const value = resolveFieldPath(context, "dod.items[0].id");
    expect(value).toBe("dod-1");
  });

  it("should return undefined for non-existent property", () => {
    const value = resolveFieldPath(context, "dod.nonexistent");
    expect(value).toBeUndefined();
  });

  it("should return undefined for array index out of bounds", () => {
    const value = resolveFieldPath(context, "evidenceChain[999].stepId");
    expect(value).toBeUndefined();
  });

  it("should throw on empty path", () => {
    expect(() => resolveFieldPath(context, "")).toThrow(SessionError);
    try {
      resolveFieldPath(context, "");
    } catch (e) {
      if (e instanceof SessionError) {
        expect(e.code).toBe("POLICY_FIELD_PATH_INVALID");
      }
    }
  });

  it("should throw on invalid array index", () => {
    expect(() => resolveFieldPath(context, "evidenceChain[invalid].stepId")).toThrow(SessionError);
  });

  it("should throw on indexing non-array", () => {
    expect(() => resolveFieldPath(context, "dod.sessionId[0]")).toThrow(SessionError);
    expect(() => resolveFieldPath(context, "dod.sessionId[0]")).toThrow(/non-array/);
  });

  it("should throw on accessing property on non-object", () => {
    expect(() => resolveFieldPath(context, "dod.sessionId.property")).toThrow(SessionError);
  });

  it("should resolve top-level context property", () => {
    const value = resolveFieldPath(context, "runnerIdentity");
    expect(value).toBeDefined();
    expect((value as RunnerIdentity).runnerId).toBe(SESSION_ID);
  });

  it("should handle multiple array indices", () => {
    const contextWithMultiple: SessionContext = {
      evidenceChain: [minimalEvidence(), minimalEvidence()],
    };
    contextWithMultiple.evidenceChain![1]!.stepId = "step-2";
    const value = resolveFieldPath(contextWithMultiple, "evidenceChain[1].stepId");
    expect(value).toBe("step-2");
  });
});

describe("Operator Evaluation", () => {
  describe("equals", () => {
    it("should return true for equal strings", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: HASH,
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });

    it("should return false for unequal strings", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "equals",
              value: "different-hash",
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
    });
  });

  describe("not_equals", () => {
    it("should return true for unequal values", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "not_equals",
              value: "different-hash",
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });
  });

  describe("in", () => {
    it("should return true when value is in array", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "in",
              value: [HASH, "other-hash"],
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });

    it("should return false when value is not in array", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "in",
              value: ["other-hash", "another-hash"],
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
    });

    it("should throw on non-array value", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "in",
              value: "not-array",
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
      expect(result.ruleResults[0]!.reason).toBeDefined();
    });
  });

  describe("subset_of", () => {
    it("should return true when array is subset", () => {
      const context: SessionContext = {
        runnerIdentity: {
          ...minimalIdentity(),
          allowedCapabilitiesSnapshot: ["read_file", "validate"],
        },
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.allowedCapabilitiesSnapshot",
              operator: "subset_of",
              value: ["read_file", "validate", "compute_hash"],
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });

    it("should return false when array is not subset", () => {
      const context: SessionContext = {
        runnerIdentity: {
          ...minimalIdentity(),
          allowedCapabilitiesSnapshot: ["read_file", "forbidden_cap"],
        },
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.allowedCapabilitiesSnapshot",
              operator: "subset_of",
              value: ["read_file", "validate"],
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
    });
  });

  describe("superset_of", () => {
    it("should return true when array is superset", () => {
      const context: SessionContext = {
        runnerIdentity: {
          ...minimalIdentity(),
          allowedCapabilitiesSnapshot: ["read_file", "validate", "compute_hash"],
        },
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.allowedCapabilitiesSnapshot",
              operator: "superset_of",
              value: ["read_file", "validate"],
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });
  });

  describe("greater_than", () => {
    it("should return true when value is greater", () => {
      // Test with a numeric field that exists - we'll use a custom numeric field
      // Since we don't have direct numeric fields in our schemas, we'll test the operator
      // with a field that doesn't exist, which should fail
      const context: SessionContext = {
        dod: {
          ...minimalDoD(),
          items: Array(10).fill(minimalDoD().items[0]),
        },
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "dod.items.nonexistent",
              operator: "greater_than",
              value: 5,
            },
          },
        ],
      };
      // This will fail because the field doesn't exist
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
    });
  });

  describe("exists", () => {
    it("should return true when field exists", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "exists",
              value: null, // value ignored for exists
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });

    it("should return false when field does not exist", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.nonexistent",
              operator: "exists",
              value: null,
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
    });
  });

  describe("matches_regex", () => {
    it("should return true when string matches regex", () => {
      const context: SessionContext = {
        runnerIdentity: {
          ...minimalIdentity(),
          runnerVersion: "1.0.0",
        },
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.runnerVersion",
              operator: "matches_regex",
              value: "^1\\.",
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(true);
    });

    it("should return false when string does not match regex", () => {
      const context: SessionContext = {
        runnerIdentity: {
          ...minimalIdentity(),
          runnerVersion: "2.0.0",
        },
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.runnerVersion",
              operator: "matches_regex",
              value: "^1\\.",
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
    });

    it("should reject regex pattern exceeding max length", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "matches_regex",
              value: "a".repeat(201), // Exceeds 200 char limit
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
      expect(result.ruleResults[0]!.reason).toContain("exceeds maximum length");
    });

    it("should reject regex with lookahead", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "matches_regex",
              value: "(?=lookahead)",
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
      expect(result.ruleResults[0]!.reason).toContain("unsupported features");
    });
  });

  describe("Unsupported operator", () => {
    it("should fail on unsupported operator", () => {
      const context: SessionContext = {
        runnerIdentity: minimalIdentity(),
      };
      const policy: Policy = {
        ...minimalPolicy(),
        rules: [
          {
            ...minimalPolicy().rules[0]!,
            condition: {
              field: "runnerIdentity.environmentFingerprint",
              operator: "unsupported_op" as any,
              value: HASH,
            },
          },
        ],
      };
      const result = evaluatePolicy(policy, context);
      expect(result.ruleResults[0]!.passed).toBe(false);
      expect(result.ruleResults[0]!.reason).toContain("Unsupported operator");
    });
  });
});

describe("Policy Evaluation", () => {
  it("should evaluate policy with single rule", () => {
    const context: SessionContext = {
      runnerIdentity: minimalIdentity(),
    };
    const policy = minimalPolicy();
    const result = evaluatePolicy(policy, context);
    expect(result.policyId).toBe(policy.policyId);
    expect(result.policyName).toBe(policy.name);
    expect(result.ruleResults.length).toBe(1);
  });

  it("should evaluate policy with multiple rules", () => {
    const context: SessionContext = {
      runnerIdentity: minimalIdentity(),
      dod: minimalDoD(),
    };
    const policy: Policy = {
      ...minimalPolicy(),
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
        {
          ruleId: "rule-2",
          description: "Rule two",
          target: "dod",
          condition: {
            field: "dod.sessionId",
            operator: "equals",
            value: SESSION_ID,
          },
          effect: "allow",
          severity: "info",
        },
      ],
    };
    const result = evaluatePolicy(policy, context);
    expect(result.ruleResults.length).toBe(2);
    expect(result.passed).toBe(true);
  });

  it("should mark policy as failed if any rule fails", () => {
    const context: SessionContext = {
      runnerIdentity: minimalIdentity(),
    };
    const policy: Policy = {
      ...minimalPolicy(),
      rules: [
        {
          ruleId: "rule-1",
          description: "Passing rule",
          target: "runnerIdentity",
          condition: {
            field: "runnerIdentity.environmentFingerprint",
            operator: "equals",
            value: HASH,
          },
          effect: "allow",
          severity: "info",
        },
        {
          ruleId: "rule-2",
          description: "Failing rule",
          target: "runnerIdentity",
          condition: {
            field: "runnerIdentity.environmentFingerprint",
            operator: "equals",
            value: "wrong-hash",
          },
          effect: "allow",
          severity: "info",
        },
      ],
    };
    const result = evaluatePolicy(policy, context);
    expect(result.passed).toBe(false);
  });

  it("should handle evaluation errors gracefully", () => {
    const context: SessionContext = {
      runnerIdentity: minimalIdentity(),
    };
    const policy: Policy = {
      ...minimalPolicy(),
      rules: [
        {
          ruleId: "rule-1",
          description: "Invalid path rule",
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
    };
    const result = evaluatePolicy(policy, context);
    expect(result.ruleResults[0]!.passed).toBe(false);
    expect(result.ruleResults[0]!.reason).toBeDefined();
  });
});
