/**
 * Capability Registry — centralized, typed capability model.
 *
 * Phase G: Defines all allowed capability strings centrally.
 * No dynamic capability creation allowed. Capabilities must be declared here or nowhere.
 *
 * This module enforces authority boundaries by:
 * - Defining all allowed capabilities with metadata
 * - Binding capabilities to allowed roles
 * - Requiring human confirmation for high-risk capabilities
 * - Preventing capability escalation across steps
 */

import type { ReviewerRole } from "./reviewer-contract.js";

// ---------------------------------------------------------------------------
// Capability metadata
// ---------------------------------------------------------------------------

export type CapabilityCategory =
  | "filesystem"
  | "validation"
  | "computation"
  | "transformation"
  | "verification"
  | "metadata";

export type CapabilityRiskLevel = "low" | "medium" | "high" | "critical";

export interface CapabilityDefinition {
  id: string;
  description: string;
  category: CapabilityCategory;
  riskLevel: CapabilityRiskLevel;
  allowedRoles: readonly ReviewerRole[];
  requiresHumanConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// Capability Registry
// ---------------------------------------------------------------------------

/**
 * Central registry of all allowed capabilities.
 * No capability can be used unless it is declared here.
 */
const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  // Filesystem capabilities
  {
    id: "read_only",
    description: "Read-only access to filesystem (for backward compatibility)",
    category: "filesystem" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e", "automation"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "read_file",
    description: "Read file contents for validation or analysis",
    category: "filesystem" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e", "automation"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "list_directory",
    description: "List directory contents for verification",
    category: "filesystem" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e", "automation"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "compute_hash",
    description: "Compute SHA-256 hash of file or artifact",
    category: "computation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e", "automation"] as const,
    requiresHumanConfirmation: false,
  },
  // Validation capabilities
  {
    id: "validate_schema",
    description: "Validate JSON or structured data against schema",
    category: "validation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "validate_syntax",
    description: "Validate code syntax without execution",
    category: "validation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "validate_references",
    description: "Validate cross-references and dependencies",
    category: "validation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "validate",
    description: "Generic validation capability (for backward compatibility)",
    category: "validation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e", "automation"] as const,
    requiresHumanConfirmation: false,
  },
  // Transformation capabilities
  {
    id: "normalize_data",
    description: "Normalize data format for comparison",
    category: "transformation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "qa", "e2e"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "canonicalize",
    description: "Canonicalize structure for deterministic hashing",
    category: "transformation" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e"] as const,
    requiresHumanConfirmation: false,
  },
  // Verification capabilities
  {
    id: "verify_hash_match",
    description: "Verify artifact hash matches expected value",
    category: "verification" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "verify_signature",
    description: "Verify digital signature",
    category: "verification" as CapabilityCategory,
    riskLevel: "high" as CapabilityRiskLevel,
    allowedRoles: ["security"] as const,
    requiresHumanConfirmation: true,
  },
  {
    id: "verify_chain",
    description: "Verify tamper-evident chain integrity",
    category: "verification" as CapabilityCategory,
    riskLevel: "medium" as CapabilityRiskLevel,
    allowedRoles: ["security", "e2e"] as const,
    requiresHumanConfirmation: false,
  },
  // Metadata capabilities
  {
    id: "extract_metadata",
    description: "Extract metadata from artifacts",
    category: "metadata" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "qa", "e2e", "automation"] as const,
    requiresHumanConfirmation: false,
  },
  {
    id: "parse_evidence",
    description: "Parse runner evidence structure",
    category: "metadata" as CapabilityCategory,
    riskLevel: "low" as CapabilityRiskLevel,
    allowedRoles: ["static", "security", "qa", "e2e"] as const,
    requiresHumanConfirmation: false,
  },
] as const;

export const CAPABILITY_REGISTRY: ReadonlyMap<string, CapabilityDefinition> =
  new Map(CAPABILITY_DEFINITIONS.map((def) => [def.id, def]));

// ---------------------------------------------------------------------------
// Registry queries
// ---------------------------------------------------------------------------

/**
 * Get capability definition by ID.
 * Returns undefined if capability is not in registry.
 */
export function getCapability(id: string): CapabilityDefinition | undefined {
  return CAPABILITY_REGISTRY.get(id);
}

/**
 * Check if capability ID exists in registry.
 */
export function isCapabilityRegistered(id: string): boolean {
  return CAPABILITY_REGISTRY.has(id);
}

/**
 * Get all capability IDs.
 */
export function getAllCapabilityIds(): readonly string[] {
  return Array.from(CAPABILITY_REGISTRY.keys());
}

/**
 * Check if role is allowed for capability.
 */
export function isRoleAllowedForCapability(
  role: ReviewerRole,
  capabilityId: string,
): boolean {
  const cap = getCapability(capabilityId);
  if (!cap) return false;
  return cap.allowedRoles.includes(role);
}

/**
 * Check if capability requires human confirmation.
 */
export function requiresHumanConfirmation(capabilityId: string): boolean {
  const cap = getCapability(capabilityId);
  if (!cap) return false;
  return cap.requiresHumanConfirmation;
}
