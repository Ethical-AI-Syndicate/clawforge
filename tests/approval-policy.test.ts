/**
 * Approval Policy Tests — Phase N
 *
 * Tests for approval policy validation, schema, and constraints.
 */

import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { SessionError } from "../src/session/errors.js";
import {
  ApprovalPolicySchema,
  validateApprovalPolicy,
  type ApprovalPolicy,
  type Approver,
  type ApprovalRule,
} from "../src/session/approval-policy.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const POLICY_ID = "b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e";
const TS = "2026-02-11T12:00:00.000Z";

// Generate test RSA key pairs
const { publicKey: publicKey1 } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const { publicKey: publicKey2 } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const { publicKey: publicKey3 } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
});

function minimalApprover(approverId: string, role: string, publicKey: string): Approver {
  return {
    approverId,
    role,
    publicKeyPem: publicKey,
    active: true,
  };
}

function minimalRule(
  artifactType: "decision_lock" | "execution_plan" | "prompt_capsule",
  requiredRoles: string[],
  m: number,
  n: number,
): ApprovalRule {
  return {
    artifactType,
    requiredRoles,
    quorum: {
      type: "m_of_n",
      m,
      n,
    },
    requireDistinctApprovers: true,
  };
}

function minimalPolicy(
  approvers: Approver[],
  rules: ApprovalRule[],
): ApprovalPolicy {
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: SESSION_ID,
    policyId: POLICY_ID,
    allowedAlgorithms: ["RSA-SHA256"],
    approvers,
    rules,
    createdAt: TS,
  };
}

describe("Approval Policy Validation", () => {
  describe("Invalid Quorum", () => {
    it("should reject quorum where m > n", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /Quorum m \(2\) cannot be greater than n \(1\)/,
      );
    });

    it("should reject quorum where m = 0", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 0, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      // Schema validation catches this before custom validation
      expect(() => validateApprovalPolicy(policy)).toThrow();
    });

    it("should reject quorum where n = 0", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 0),
      ];
      const policy = minimalPolicy(approvers, rules);

      // Schema validation catches this before custom validation
      expect(() => validateApprovalPolicy(policy)).toThrow();
    });

    it("should reject quorum where n exceeds available approvers", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 3),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /Quorum n \(3\) exceeds available active approvers \(1\)/,
      );
    });
  });

  describe("Unknown Roles", () => {
    it("should reject required role with no approvers", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["security_reviewer"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /Required role "security_reviewer" for artifact type decision_lock has no approvers/,
      );
    });

    it("should reject required role with only inactive approvers", () => {
      const approvers = [
        {
          ...minimalApprover("approver-1", "security_reviewer", publicKey1),
          active: false,
        },
      ];
      const rules = [
        minimalRule("decision_lock", ["security_reviewer"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /Required role "security_reviewer" for artifact type decision_lock has no active approvers/,
      );
    });
  });

  describe("Invalid PEM Format", () => {
    it("should reject invalid PEM public key", () => {
      const approvers = [
        {
          approverId: "approver-1",
          role: "tech_lead",
          publicKeyPem: "not a valid PEM",
          active: true,
        },
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow();
      // Schema validation should catch this
      const result = ApprovalPolicySchema.safeParse(policy);
      expect(result.success).toBe(false);
    });
  });

  describe("Invalid Algorithms", () => {
    it("should reject disallowed algorithm", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = {
        ...minimalPolicy(approvers, rules),
        allowedAlgorithms: ["RSA-SHA384"],
      };

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /contains disallowed algorithms/,
      );
    });

    it("should reject empty allowedAlgorithms", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = {
        ...minimalPolicy(approvers, rules),
        allowedAlgorithms: [],
      };

      expect(() => validateApprovalPolicy(policy)).toThrow();
      const result = ApprovalPolicySchema.safeParse(policy);
      expect(result.success).toBe(false);
    });
  });

  describe("Duplicate Approver IDs", () => {
    it("should reject duplicate approverId", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-1", "tech_lead", publicKey2), // duplicate ID
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 2),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /duplicate approverId/,
      );
    });
  });

  describe("Require Distinct Approvers", () => {
    it("should reject rule with requireDistinctApprovers = false", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        {
          ...minimalRule("decision_lock", ["tech_lead"], 1, 1),
          requireDistinctApprovers: false,
        },
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).toThrow(SessionError);
      expect(() => validateApprovalPolicy(policy)).toThrow(
        /requireDistinctApprovers must be true/,
      );
    });
  });

  describe("Valid Policy", () => {
    it("should accept valid policy with single approver", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).not.toThrow();
    });

    it("should accept valid policy with multiple approvers and roles", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
        minimalApprover("approver-3", "security_reviewer", publicKey3),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 2),
        minimalRule("execution_plan", ["tech_lead", "security_reviewer"], 1, 3), // n=3 matches 2 tech_lead + 1 security_reviewer
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).not.toThrow();
    });

    it("should accept valid policy with multiple artifact types", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 2),
        minimalRule("execution_plan", ["tech_lead"], 2, 2),
        minimalRule("prompt_capsule", ["tech_lead"], 1, 2),
      ];
      const policy = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy)).not.toThrow();
    });
  });

  describe("Schema Validation", () => {
    it("should reject invalid UUIDs", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = {
        ...minimalPolicy(approvers, rules),
        sessionId: "not-a-uuid",
      };

      const result = ApprovalPolicySchema.safeParse(policy);
      expect(result.success).toBe(false);
    });

    it("should reject invalid timestamp", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = {
        ...minimalPolicy(approvers, rules),
        createdAt: "not-a-timestamp",
      };

      const result = ApprovalPolicySchema.safeParse(policy);
      expect(result.success).toBe(false);
    });

    it("should reject empty approvers array", () => {
      const approvers: Approver[] = [];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 1, 1),
      ];
      const policy = minimalPolicy(approvers, rules);

      const result = ApprovalPolicySchema.safeParse(policy);
      expect(result.success).toBe(false);
    });

    it("should reject empty rules array", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
      ];
      const rules: ApprovalRule[] = [];
      const policy = minimalPolicy(approvers, rules);

      const result = ApprovalPolicySchema.safeParse(policy);
      expect(result.success).toBe(false);
    });
  });

  describe("Deterministic Canonicalization", () => {
    it("should produce consistent results for same policy", () => {
      const approvers = [
        minimalApprover("approver-1", "tech_lead", publicKey1),
        minimalApprover("approver-2", "tech_lead", publicKey2),
      ];
      const rules = [
        minimalRule("decision_lock", ["tech_lead"], 2, 2),
      ];
      const policy1 = minimalPolicy(approvers, rules);
      const policy2 = minimalPolicy(approvers, rules);

      expect(() => validateApprovalPolicy(policy1)).not.toThrow();
      expect(() => validateApprovalPolicy(policy2)).not.toThrow();
    });
  });
});
