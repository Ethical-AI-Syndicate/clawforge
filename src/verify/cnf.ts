/**
 * CNF (Conformance Normal Form) Converter
 * 
 * Converts TypeScript validator output to canonical CNF format.
 * This is the Tier 1 specification - changes require major version bump.
 * 
 * CNF Structure:
 * {
 *   specVersion: string,
 *   mode: "session" | "sealed-package",
 *   verdict: "pass" | "fail",
 *   exitCode: 0 | 1,
 *   hashes: { planHash?, packageHash?, evidenceChainTailHash?, anchorHash? },
 *   errors: [{ code, artifactType?, path?, message }]
 * }
 * 
 * Key Requirements:
 * - Error sorting: code → artifactType → path → message
 * - Hex: 64-char lowercase only
 * - No timestamps, no stack traces
 * - Canonical JSON: keys sorted, no extra whitespace
 */

import { createHash } from "node:crypto";
import type { VerificationReport } from "./verification-report.js";

// CNF Spec Version
export const CNF_SPEC_VERSION = "1.0.0";

/**
 * CNF Error structure
 */
export interface CNFError {
  code: string;
  artifactType?: string;
  path?: string;
  message: string;
}

/**
 * CNF Hashes structure
 */
export interface CNFHashes {
  planHash?: string;
  packageHash?: string;
  evidenceChainTailHash?: string;
  anchorHash?: string;
}

/**
 * CNF Conformance Normal Form output
 */
export interface CNF {
  specVersion: string;
  mode: "session" | "sealed-package";
  verdict: "pass" | "fail";
  exitCode: number;
  hashes: CNFHashes;
  errors: CNFError[];
}

/**
 * Sort errors deterministically
 * Order: code → artifactType → path → message (nulls last for optional fields)
 */
function sortErrors(errors: CNFError[]): CNFError[] {
  return [...errors].sort((a, b) => {
    // Sort by code first
    const codeCompare = (a.code || "").localeCompare(b.code || "");
    if (codeCompare !== 0) return codeCompare;
    
    // Then by artifactType (nulls last)
    const aType = a.artifactType || "\uffff";
    const bType = b.artifactType || "\uffff";
    const typeCompare = aType.localeCompare(bType);
    if (typeCompare !== 0) return typeCompare;
    
    // Then by path (nulls last)
    const aPath = a.path || "\uffff";
    const bPath = b.path || "\uffff";
    const pathCompare = aPath.localeCompare(bPath);
    if (pathCompare !== 0) return pathCompare;
    
    // Finally by message
    return (a.message || "").localeCompare(b.message || "");
  });
}

/**
 * Convert VerificationReport to CNF
 */
export function toCNF(report: VerificationReport, mode: "session" | "sealed-package" = "sealed-package"): CNF {
  const errors: CNFError[] = [];
  
  // Collect all errors from report
  if (report.errors && report.errors.length > 0) {
    for (const error of report.errors) {
      errors.push({
        code: error.code || "UNKNOWN_ERROR",
        artifactType: error.artifactType,
        path: error.path,
        message: error.message || String(error),
      });
    }
  }
  
  // Sort errors deterministically
  const sortedErrors = sortErrors(errors);
  
  // Determine verdict
  const verdict: "pass" | "fail" = report.passed ? "pass" : "fail";
  const exitCode: 0 | 1 = report.passed ? 0 : 1;
  
  // Build hashes object
  const hashes: CNFHashes = {};
  if (report.hashes) {
    if (report.hashes.planHash) hashes.planHash = report.hashes.planHash;
    if (report.hashes.packageHash) hashes.packageHash = report.hashes.packageHash;
    if (report.hashes.evidenceChainTailHash) hashes.evidenceChainTailHash = report.hashes.evidenceChainTailHash;
    if (report.hashes.anchorHash) hashes.anchorHash = report.hashes.anchorHash;
  }
  
  // Build CNF
  const cnf: CNF = {
    specVersion: CNF_SPEC_VERSION,
    mode,
    verdict,
    exitCode,
    hashes: Object.keys(hashes).length > 0 ? hashes : {},
    errors: sortedErrors,
  };
  
  return cnf;
}

/**
 * Serialize CNF to canonical JSON
 * Keys sorted lexicographically, no extra whitespace
 */
export function canonicalizeCNF(cnf: CNF): string {
  return JSON.stringify(toSortedValue(cnf));
}

/**
 * Recursively sort object keys for canonical JSON
 */
function toSortedValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  
  if (Array.isArray(value)) {
    return value.map(toSortedValue);
  }
  
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      const v = obj[key];
      if (v !== undefined) {
        sorted[key] = toSortedValue(v);
      }
    }
    return sorted;
  }
  
  // string | number | boolean - pass through
  return value;
}

/**
 * Compute SHA-256 hash of CNF (canonical form)
 */
export function computeCNFHash(cnf: CNF): string {
  const canonical = canonicalizeCNF(cnf);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Validate CNF structure (check required fields and types)
 */
export function validateCNF(cnf: unknown): { valid: boolean; errors: string[] } {
  const validationErrors: string[] = [];
  
  if (!cnf || typeof cnf !== "object") {
    return { valid: false, errors: ["CNF must be an object"] };
  }
  
  const obj = cnf as Record<string, unknown>;
  
  // Required fields
  if (typeof obj.specVersion !== "string") {
    validationErrors.push("specVersion must be a string");
  }
  
  if (obj.verdict !== "pass" && obj.verdict !== "fail") {
    validationErrors.push("verdict must be 'pass' or 'fail'");
  }
  
  if (obj.exitCode !== 0 && obj.exitCode !== 1) {
    validationErrors.push("exitCode must be 0 or 1");
  }
  
  // Validate hashes if present
  if (obj.hashes && typeof obj.hashes === "object") {
    const hashes = obj.hashes as Record<string, unknown>;
    const hexRegex = /^[0-9a-f]{64}$/;
    
    for (const [key, value] of Object.entries(hashes)) {
      if (value && typeof value === "string") {
        if (!hexRegex.test(value)) {
          validationErrors.push(`Hash ${key} must be 64-char lowercase hex`);
        }
      }
    }
  }
  
  // Validate errors if present
  if (obj.errors && Array.isArray(obj.errors)) {
    for (let i = 0; i < obj.errors.length; i++) {
      const error = obj.errors[i];
      if (!error || typeof error !== "object") {
        validationErrors.push(`errors[${i}] must be an object`);
        continue;
      }
      
      const err = error as Record<string, unknown>;
      if (typeof err.code !== "string") {
        validationErrors.push(`errors[${i}].code must be a string`);
      }
      if (typeof err.message !== "string") {
        validationErrors.push(`errors[${i}].message must be a string`);
      }
    }
  }
  
  return {
    valid: validationErrors.length === 0,
    errors: validationErrors,
  };
}

/**
 * Compare two CNF structures for equivalence
 */
export function compareCNF(left: CNF, right: CNF): { equal: boolean; differences: string[] } {
  const differences: string[] = [];
  
  if (left.specVersion !== right.specVersion) {
    differences.push(`specVersion: ${left.specVersion} !== ${right.specVersion}`);
  }
  
  if (left.mode !== right.mode) {
    differences.push(`mode: ${left.mode} !== ${right.mode}`);
  }
  
  if (left.verdict !== right.verdict) {
    differences.push(`verdict: ${left.verdict} !== ${right.verdict}`);
  }
  
  if (left.exitCode !== right.exitCode) {
    differences.push(`exitCode: ${left.exitCode} !== ${right.exitCode}`);
  }
  
  // Compare hashes
  const leftHashes = left.hashes || {};
  const rightHashes = right.hashes || {};
  if (JSON.stringify(leftHashes) !== JSON.stringify(rightHashes)) {
    differences.push(`hashes: ${JSON.stringify(leftHashes)} !== ${JSON.stringify(rightHashes)}`);
  }
  
  // Compare errors (already sorted)
  const leftErrors = left.errors || [];
  const rightErrors = right.errors || [];
  if (leftErrors.length !== rightErrors.length) {
    differences.push(`errors count: ${leftErrors.length} !== ${rightErrors.length}`);
  } else {
    for (let i = 0; i < leftErrors.length; i++) {
      if (JSON.stringify(leftErrors[i]) !== JSON.stringify(rightErrors[i])) {
        differences.push(`errors[${i}]: ${JSON.stringify(leftErrors[i])} !== ${JSON.stringify(rightErrors[i])}`);
      }
    }
  }
  
  return {
    equal: differences.length === 0,
    differences,
  };
}
