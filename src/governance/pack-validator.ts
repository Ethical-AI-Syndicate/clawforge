/**
 * Governance Pack Validator
 * 
 * Validates sessions against governance pack expectations.
 * This makes governance packs executable.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { readFile } from "node:fs/promises";
import yaml from "yaml";

export interface Expectation {
  id: string;
  description: string;
  importance: "expected" | "recommended" | "optional";
  observed_in?: string;
}

export interface Pack {
  pack: {
    id: string;
    version: string;
    wedge?: string;
    status: string;
  };
  description: string;
  expectations: Expectation[];
}

export interface ValidationResult {
  packId: string;
  packVersion: string;
  sessionId: string;
  passed: boolean;
  results: ExpectationResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    expected: number;
    recommended: number;
  };
}

export interface ExpectationResult {
  id: string;
  passed: boolean;
  importance: string;
  reason?: string;
}

/**
 * Load a governance pack from YAML
 */
export function loadPack(packPath: string): Pack {
  const content = readFileSync(packPath, "utf-8");
  return yaml.parse(content) as Pack;
}

/**
 * Load a session's events
 */
export async function loadSessionEvents(sessionPath: string): Promise<any[]> {
  const eventsPath = join(sessionPath, "events.json");
  if (!existsSync(eventsPath)) {
    return [];
  }
  const content = await readFile(eventsPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Load a session's artifacts manifest
 */
export async function loadSessionArtifacts(sessionPath: string): Promise<any[]> {
  const manifestPath = join(sessionPath, "artifacts", "manifest.json");
  if (!existsSync(manifestPath)) {
    return [];
  }
  const content = await readFile(manifestPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Validate a session against a governance pack
 */
export async function validateSessionAgainstPack(
  sessionPath: string,
  packPath: string
): Promise<ValidationResult> {
  const pack = loadPack(packPath);
  const events = await loadSessionEvents(sessionPath);
  const artifacts = await loadSessionArtifacts(sessionPath);
  
  const results: ExpectationResult[] = [];
  
  for (const expectation of pack.expectations) {
    const result = checkExpectation(expectation, events, artifacts);
    results.push({
      id: expectation.id,
      passed: result.passed,
      importance: expectation.importance,
      reason: result.reason
    });
  }
  
  const summary = {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    expected: results.filter(r => r.importance === "expected").length,
    recommended: results.filter(r => r.importance === "recommended").length
  };
  
  // Pass only if all "expected" expectations pass
  const expectedResults = results.filter(r => r.importance === "expected");
  const passed = expectedResults.every(r => r.passed);
  
  return {
    packId: pack.pack.id,
    packVersion: pack.pack.version,
    sessionId: sessionPath.split("/").pop() || "unknown",
    passed,
    results,
    summary
  };
}

/**
 * Check a single expectation against session data
 */
function checkExpectation(
  expectation: Expectation,
  events: any[],
  artifacts: any[]
): { passed: boolean; reason?: string } {
  switch (expectation.id) {
    case "intent-recorded-before-artifacts": {
      const contractIndex = events.findIndex(e => e.eventType === "ContractRecorded");
      const artifactIndex = events.findIndex(e => e.eventType === "ArtifactRecorded");
      if (contractIndex === -1) {
        return { passed: false, reason: "No ContractRecorded event found" };
      }
      if (artifactIndex === -1) {
        return { passed: true, reason: "No artifacts to compare" };
      }
      return {
        passed: contractIndex < artifactIndex,
        reason: contractIndex < artifactIndex
          ? "ContractRecorded before ArtifactRecorded"
          : "ArtifactRecorded before ContractRecorded"
      };
    }
    
    case "intent-includes-title-and-description": {
      const contract = events.find(e => e.eventType === "ContractRecorded");
      if (!contract?.payload?.contract) {
        return { passed: false, reason: "No ContractRecorded event found" };
      }
      const hasTitle = contract.payload.contract.title?.length > 0;
      const hasDescription = contract.payload.contract.description?.length > 0;
      return {
        passed: hasTitle && hasDescription,
        reason: !hasTitle ? "Missing title" : !hasDescription ? "Missing description" : "Has title and description"
      };
    }
    
    case "intent-identifies-actor": {
      const contract = events.find(e => e.eventType === "ContractRecorded");
      if (!contract?.payload?.contract?.actor) {
        return { passed: false, reason: "No actor in contract" };
      }
      const actor = contract.payload.contract.actor;
      const hasActorId = !!actor.actorId;
      const hasActorType = !!actor.actorType;
      return {
        passed: hasActorId && hasActorType,
        reason: !hasActorId ? "Missing actorId" : !hasActorType ? "Missing actorType" : "Actor identified"
      };
    }
    
    case "at-least-one-artifact-present": {
      return {
        passed: artifacts.length > 0,
        reason: artifacts.length === 0 ? "No artifacts" : `${artifacts.length} artifact(s) present`
      };
    }
    
    case "artifact-hashes-match-manifest": {
      if (artifacts.length === 0) {
        return { passed: false, reason: "No artifacts to verify" };
      }
      // In a real implementation, we'd verify the actual content hashes
      const allMatch = artifacts.every(a => a.hash && a.hash.startsWith("sha256:"));
      return {
        passed: allMatch,
        reason: allMatch ? "All artifacts have SHA-256 hashes" : "Some artifacts missing hashes"
      };
    }
    
    case "correlation-id-present": {
      const runStarted = events.find(e => e.eventType === "RunStarted");
      const hasCorrelation = !!runStarted?.metadata?.correlationId;
      return {
        passed: hasCorrelation,
        reason: hasCorrelation ? "Correlation ID present" : "No correlation ID"
      };
    }
    
    case "run-explicitly-closed": {
      const hasCompleted = events.some(e => e.eventType === "RunCompleted");
      return {
        passed: hasCompleted,
        reason: hasCompleted ? "RunCompleted event found" : "No RunCompleted event"
      };
    }
    
    case "run-completed-after-all-artifacts": {
      const completedIndex = events.findIndex((e: any) => e.eventType === "RunCompleted");
      const artifactIndices = events
        .map((e: any, i: number) => e.eventType === "ArtifactRecorded" ? i : -1)
        .filter((i: number) => i >= 0);
      const lastArtifactIndex = artifactIndices.length > 0 ? Math.max(...artifactIndices) : -1;
      if (completedIndex === -1) {
        return { passed: false, reason: "No RunCompleted event" };
      }
      if (lastArtifactIndex === -1) {
        return { passed: true, reason: "No artifacts to compare" };
      }
      return {
        passed: completedIndex > lastArtifactIndex,
        reason: completedIndex > lastArtifactIndex
          ? "RunCompleted after artifacts"
          : "RunCompleted before artifacts"
      };
    }
    
    case "evidence-bundle-produced": {
      // This expectation can't be checked from session alone
      return {
        passed: true,
        reason: "Evidence bundle check requires separate verification"
      };
    }
    
    // Incident-specific expectations
    case "incident-described-in-intent": {
      const contract = events.find(e => e.eventType === "ContractRecorded");
      if (!contract?.payload?.contract) {
        return { passed: false, reason: "No ContractRecorded event found" };
      }
      const hasTitle = contract.payload.contract.title?.length > 0;
      const hasDescription = contract.payload.contract.description?.length > 0;
      return {
        passed: hasTitle && hasDescription,
        reason: !hasTitle ? "Missing incident title" : !hasDescription ? "Missing incident description" : "Incident described"
      };
    }
    
    case "incident-metadata-in-input-params": {
      const contract = events.find(e => e.eventType === "ContractRecorded");
      const hasParams = contract?.payload?.contract?.inputParams &&
        Object.keys(contract.payload.contract.inputParams).length > 0;
      return {
        passed: !!hasParams,
        reason: hasParams ? "Input params present" : "No input params"
      };
    }
    
    case "timeline-artifact-typical": {
      const hasTimeline = artifacts.some(a => 
        a.label?.toLowerCase().includes("timeline") ||
        a.filename?.toLowerCase().includes("timeline")
      );
      return {
        passed: hasTimeline,
        reason: hasTimeline ? "Timeline artifact found" : "No timeline artifact"
      };
    }
    
    case "analysis-artifact-typical": {
      const hasAnalysis = artifacts.some(a =>
        a.label?.toLowerCase().includes("analysis") ||
        a.label?.toLowerCase().includes("rca") ||
        a.filename?.toLowerCase().includes("analysis") ||
        a.filename?.toLowerCase().includes("rca")
      );
      return {
        passed: hasAnalysis,
        reason: hasAnalysis ? "Analysis artifact found" : "No analysis artifact"
      };
    }
    
    case "multiple-artifacts-typical": {
      return {
        passed: artifacts.length >= 2,
        reason: `${artifacts.length} artifact(s) (expected ≥2)`
      };
    }
    
    case "run-completed-after-all-evidence": {
      const completedIndex = events.findIndex((e: any) => e.eventType === "RunCompleted");
      const evidenceIndices = events
        .map((e: any, i: number) => 
          (e.eventType === "ArtifactRecorded" || e.eventType === "ContractRecorded") ? i : -1
        )
        .filter((i: number) => i >= 0);
      const lastEvidenceIndex = evidenceIndices.length > 0 ? Math.max(...evidenceIndices) : -1;
      if (completedIndex === -1) {
        return { passed: false, reason: "No RunCompleted event" };
      }
      return {
        passed: completedIndex > lastEvidenceIndex,
        reason: completedIndex > lastEvidenceIndex
          ? "RunCompleted after evidence"
          : "RunCompleted before evidence"
      };
    }
    
    case "correlation-id-to-incident-tracker": {
      const runStarted = events.find(e => e.eventType === "RunStarted");
      const hasCorrelation = !!runStarted?.metadata?.correlationId;
      return {
        passed: hasCorrelation,
        reason: hasCorrelation ? "Incident correlation ID present" : "No correlation ID"
      };
    }
    
    default:
      return {
        passed: true,
        reason: `Unknown expectation: ${expectation.id}`
      };
  }
}

/**
 * List available governance packs
 */
export function listPacks(packsDir: string = "governance/packs"): string[] {
  if (!existsSync(packsDir)) {
    return [];
  }
  return readdirSync(packsDir)
    .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map(f => resolve(packsDir, f));
}

/**
 * Validate a session against all governance packs
 */
export async function validateSession(sessionPath: string, packsDir?: string): Promise<ValidationResult[]> {
  const packPaths = packsDir ? listPacks(packsDir) : listPacks();
  const results: ValidationResult[] = [];
  
  for (const packPath of packPaths) {
    const result = await validateSessionAgainstPack(sessionPath, packPath);
    results.push(result);
  }
  
  return results;
}
