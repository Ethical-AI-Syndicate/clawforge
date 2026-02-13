/**
 * Extension Registry Validator (Runtime)
 * 
 * Validates extensions at runtime - enforces registry rules.
 * This is NOT documentation - this is enforcement.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Extension validation error
 */
export class ExtensionValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public extensionId: string = ""
  ) {
    super(`[${code}] ${message}`);
    this.name = "ExtensionValidationError";
  }
}

/**
 * Extension registry entry
 */
export interface ExtensionEntry {
  extensionId: string;
  artifactType: string;
  schemaVersion: string;
  status: "active" | "deprecated" | "removed";
  registeredAt: string;
  hashExclusions?: string[];
  bindingTargets?: string[];
  errorCodes?: string[];
}

/**
 * Extension registry
 */
export class ExtensionRegistry {
  private registry: {
    registryVersion: string;
    extensions: ExtensionEntry[];
  };
  
  private extensions: Map<string, ExtensionEntry> = new Map();
  
  constructor(registryPath?: string) {
    const path = registryPath || resolve(process.cwd(), "extensions/registry.yaml");
    this.registry = this.loadRegistry(path);
    
    for (const ext of this.registry.extensions) {
      this.extensions.set(ext.extensionId, ext);
    }
  }
  
  private loadRegistry(path: string): { registryVersion: string; extensions: ExtensionEntry[] } {
    if (!existsSync(path)) {
      return { registryVersion: "1.0.0", extensions: [] };
    }
    
    try {
      const content = readFileSync(path, "utf-8");
      // Simple YAML parser for registry
      return this.parseYaml(content);
    } catch {
      return { registryVersion: "1.0.0", extensions: [] };
    }
  }
  
  private parseYaml(content: string): { registryVersion: string; extensions: ExtensionEntry[] } {
    // Simple YAML parsing for registry format
    const result: { registryVersion: string; extensions: ExtensionEntry[] } = {
      registryVersion: "1.0.0",
      extensions: []
    };
    
    const lines = content.split("\n");
    let currentExt: Partial<ExtensionEntry> = {};
    let inExtensions = false;
    
    for (const line of lines) {
      if (line.startsWith("extensions:")) {
        inExtensions = true;
        continue;
      }
      
      if (inExtensions && line.trim().startsWith("- extensionId:")) {
        if (Object.keys(currentExt).length > 0) {
          result.extensions.push(currentExt as ExtensionEntry);
        }
        currentExt = { status: "active" };
        const parts = line.split("extensionId:");
        currentExt.extensionId = parts[1]?.trim() ?? "";
      }
      
      if (inExtensions && currentExt.extensionId) {
        if (line.includes("artifactType:")) {
          const parts = line.split("artifactType:");
          currentExt.artifactType = parts[1]?.trim() ?? "";
        }
        if (line.includes("schemaVersion:")) {
          const parts = line.split("schemaVersion:");
          currentExt.schemaVersion = parts[1]?.trim().replace(/"/g, "") ?? "";
        }
        if (line.includes("status:")) {
          const parts = line.split("status:");
          currentExt.status = (parts[1]?.trim() ?? "active") as any;
        }
        if (line.includes("registeredAt:")) {
          const parts = line.split("registeredAt:");
          currentExt.registeredAt = parts[1]?.trim().replace(/"/g, "") ?? "";
        }
      }
    }
    
    if (Object.keys(currentExt).length > 0) {
      result.extensions.push(currentExt as ExtensionEntry);
    }
    
    return result;
  }
  
  isRegistered(extensionId: string): boolean {
    return this.extensions.has(extensionId);
  }
  
  getExtension(extensionId: string): ExtensionEntry | undefined {
    return this.extensions.get(extensionId);
  }
  
  validateExtensionStrict(extensionData: Record<string, unknown>): ExtensionValidationError[] {
    const errors: ExtensionValidationError[] = [];
    
    const extensionId = extensionData.extensionId as string || "";
    const artifactType = extensionData.artifactType as string || "";
    
    // 1. Must be registered
    if (!this.isRegistered(extensionId)) {
      errors.push(new ExtensionValidationError(
        "EXT_NOT_REGISTERED",
        `Extension '${extensionId}' is not in registry`,
        extensionId
      ));
      return errors;
    }
    
    const registered = this.getExtension(extensionId)!;
    
    // 2. Schema version must match
    const declaredVersion = extensionData.schemaVersion as string || "";
    if (declaredVersion !== registered.schemaVersion) {
      errors.push(new ExtensionValidationError(
        "EXT_VERSION_MISMATCH",
        `Schema version '${declaredVersion}' != registered '${registered.schemaVersion}'`,
        extensionId
      ));
    }
    
    // 3. Hash algorithm MUST be SHA-256
    const hashAlgo = (extensionData.hashAlgorithm as string || "sha256").toLowerCase();
    if (hashAlgo !== "sha256") {
      errors.push(new ExtensionValidationError(
        "EXT_INVALID_HASH_ALGO",
        `Hash algorithm must be SHA-256, got '${hashAlgo}'`,
        extensionId
      ));
    }
    
    // 4. Canonicalization MUST be RFC 8785
    const canonical = extensionData.canonicalization as string || "";
    if (canonical !== "rfc8785") {
      errors.push(new ExtensionValidationError(
        "EXT_INVALID_CANONICAL",
        `Canonicalization must be 'rfc8785', got '${canonical}'`,
        extensionId
      ));
    }
    
    // 5. Binding targets must be declared
    const declaredTargets = (extensionData.bindingTargets as string[]) || [];
    const registeredTargets = registered.bindingTargets || [];
    for (const target of declaredTargets) {
      if (!registeredTargets.includes(target)) {
        errors.push(new ExtensionValidationError(
          "EXT_UNDECLARED_BINDING",
          `Binding target '${target}' not in registry`,
          extensionId
        ));
      }
    }
    
    // 6. Error codes must be namespaced
    const declaredCodes = (extensionData.errorCodes as string[]) || [];
    for (const code of declaredCodes) {
      const prefix = artifactType.toUpperCase().replace(/-/g, "_");
      if (!code.startsWith(prefix)) {
        errors.push(new ExtensionValidationError(
          "EXT_UNNAMESPACED_ERROR",
          `Error code '${code}' must be namespaced with '${artifactType}'`,
          extensionId
        ));
      }
    }
    
    // 7. Cannot change Tier 1
    if ((extensionData.tier as number) !== 2) {
      errors.push(new ExtensionValidationError(
        "EXT_TIER_VIOLATION",
        "Extensions must be Tier 2",
        extensionId
      ));
    }
    
    return errors;
  }
}

/**
 * Validate extension against registry
 */
export function validateExtension(extensionData: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const registry = new ExtensionRegistry();
  const errors = registry.validateExtensionStrict(extensionData);
  return {
    valid: errors.length === 0,
    errors: errors.map(e => e.message)
  };
}

/**
 * Enforce extension registry - throws on violation
 */
export function enforceExtensionRegistry(extensionData: Record<string, unknown>): void {
  const registry = new ExtensionRegistry();
  const errors = registry.validateExtensionStrict(extensionData);
  
  if (errors.length > 0) {
    throw errors[0];
  }
}
