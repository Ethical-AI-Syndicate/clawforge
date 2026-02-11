/**
 * Capability Registry Tests — Phase G
 *
 * Tests for capability registry, capability queries, and role-to-capability mapping.
 */

import { describe, it, expect } from "vitest";
import {
  CAPABILITY_REGISTRY,
  getCapability,
  isCapabilityRegistered,
  getAllCapabilityIds,
  isRoleAllowedForCapability,
  requiresHumanConfirmation,
  type CapabilityDefinition,
} from "../src/session/capabilities.js";
import type { ReviewerRole } from "../src/session/reviewer-contract.js";

describe("Capability Registry", () => {
  describe("CAPABILITY_REGISTRY", () => {
    it("should be a non-empty map", () => {
      expect(CAPABILITY_REGISTRY).toBeInstanceOf(Map);
      expect(CAPABILITY_REGISTRY.size).toBeGreaterThan(0);
    });

    it("should contain only valid capability definitions", () => {
      for (const [id, def] of CAPABILITY_REGISTRY) {
        expect(id).toBeTruthy();
        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
        expect(def).toBeDefined();
        expect(def.id).toBe(id);
        expect(def.description).toBeTruthy();
        expect(typeof def.description).toBe("string");
        expect(["filesystem", "validation", "computation", "transformation", "verification", "metadata"]).toContain(def.category);
        expect(["low", "medium", "high", "critical"]).toContain(def.riskLevel);
        expect(Array.isArray(def.allowedRoles)).toBe(true);
        expect(def.allowedRoles.length).toBeGreaterThan(0);
        expect(typeof def.requiresHumanConfirmation).toBe("boolean");
      }
    });

    it("should have unique capability IDs", () => {
      const ids = Array.from(CAPABILITY_REGISTRY.keys());
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have at least one capability requiring human confirmation", () => {
      let found = false;
      for (const def of CAPABILITY_REGISTRY.values()) {
        if (def.requiresHumanConfirmation) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it("should have capabilities across multiple categories", () => {
      const categories = new Set(
        Array.from(CAPABILITY_REGISTRY.values()).map((d) => d.category),
      );
      expect(categories.size).toBeGreaterThan(1);
    });
  });

  describe("getCapability", () => {
    it("should return capability definition for registered capability", () => {
      const firstId = Array.from(CAPABILITY_REGISTRY.keys())[0];
      const cap = getCapability(firstId!);
      expect(cap).toBeDefined();
      expect(cap?.id).toBe(firstId);
    });

    it("should return undefined for unregistered capability", () => {
      const cap = getCapability("nonexistent_capability_xyz");
      expect(cap).toBeUndefined();
    });

    it("should return same instance as registry", () => {
      const firstId = Array.from(CAPABILITY_REGISTRY.keys())[0];
      const cap1 = getCapability(firstId!);
      const cap2 = CAPABILITY_REGISTRY.get(firstId!);
      expect(cap1).toBe(cap2);
    });
  });

  describe("isCapabilityRegistered", () => {
    it("should return true for registered capability", () => {
      const firstId = Array.from(CAPABILITY_REGISTRY.keys())[0];
      expect(isCapabilityRegistered(firstId!)).toBe(true);
    });

    it("should return false for unregistered capability", () => {
      expect(isCapabilityRegistered("nonexistent_capability_xyz")).toBe(false);
    });

    it("should return false for empty string", () => {
      expect(isCapabilityRegistered("")).toBe(false);
    });
  });

  describe("getAllCapabilityIds", () => {
    it("should return all capability IDs", () => {
      const ids = getAllCapabilityIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBe(CAPABILITY_REGISTRY.size);
      for (const id of ids) {
        expect(CAPABILITY_REGISTRY.has(id)).toBe(true);
      }
    });

    it("should return array of capability IDs", () => {
      const ids = getAllCapabilityIds();
      expect(Array.isArray(ids)).toBe(true);
      expect(ids.length).toBe(CAPABILITY_REGISTRY.size);
    });
  });

  describe("isRoleAllowedForCapability", () => {
    it("should return true for allowed role", () => {
      const firstId = Array.from(CAPABILITY_REGISTRY.keys())[0];
      const cap = CAPABILITY_REGISTRY.get(firstId!);
      if (cap && cap.allowedRoles.length > 0) {
        const role = cap.allowedRoles[0] as ReviewerRole;
        expect(isRoleAllowedForCapability(role, firstId!)).toBe(true);
      }
    });

    it("should return false for unregistered capability", () => {
      expect(isRoleAllowedForCapability("static", "nonexistent_capability_xyz")).toBe(false);
    });

    it("should return false for disallowed role", () => {
      // Find a capability that doesn't allow "automation" role
      for (const [id, def] of CAPABILITY_REGISTRY) {
        if (!def.allowedRoles.includes("automation")) {
          expect(isRoleAllowedForCapability("automation", id)).toBe(false);
          break;
        }
      }
    });
  });

  describe("requiresHumanConfirmation", () => {
    it("should return true for capability requiring human confirmation", () => {
      for (const [id, def] of CAPABILITY_REGISTRY) {
        if (def.requiresHumanConfirmation) {
          expect(requiresHumanConfirmation(id)).toBe(true);
          break;
        }
      }
    });

    it("should return false for capability not requiring human confirmation", () => {
      for (const [id, def] of CAPABILITY_REGISTRY) {
        if (!def.requiresHumanConfirmation) {
          expect(requiresHumanConfirmation(id)).toBe(false);
          break;
        }
      }
    });

    it("should return false for unregistered capability", () => {
      expect(requiresHumanConfirmation("nonexistent_capability_xyz")).toBe(false);
    });
  });

  describe("Capability definition structure", () => {
    it("should have all required fields", () => {
      for (const def of CAPABILITY_REGISTRY.values()) {
        expect(def.id).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.category).toBeTruthy();
        expect(def.riskLevel).toBeTruthy();
        expect(def.allowedRoles).toBeTruthy();
        expect(Array.isArray(def.allowedRoles)).toBe(true);
        expect(typeof def.requiresHumanConfirmation).toBe("boolean");
      }
    });

    it("should have valid reviewer roles", () => {
      const validRoles: ReviewerRole[] = ["static", "security", "qa", "e2e", "automation"];
      for (const def of CAPABILITY_REGISTRY.values()) {
        for (const role of def.allowedRoles) {
          expect(validRoles).toContain(role);
        }
      }
    });

    it("should have non-empty allowedRoles arrays", () => {
      for (const def of CAPABILITY_REGISTRY.values()) {
        expect(def.allowedRoles.length).toBeGreaterThan(0);
      }
    });
  });
});
