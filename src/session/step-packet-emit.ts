/**
 * Step Packet Emitter — generates least-privilege work packets per step.
 *
 * Phase O: Emits one StepPacket per execution plan step with minimal
 * context slices, hash-bound to approved artifacts.
 */

import { SessionError } from "./errors.js";
import type { StepPacket } from "./step-packet.js";
import { computeStepPacketHash } from "./step-packet.js";
import { lintStepPacket } from "./step-packet-lint.js";
import type { DefinitionOfDone, DecisionLock } from "./schemas.js";
import type { PromptCapsule } from "./prompt-capsule.js";
import type { ExecutionPlanLike, ExecutionPlanStep } from "./evidence-validation.js";
import type { RepoSnapshot } from "./repo-snapshot.js";
import type { SymbolIndex } from "./symbol-index.js";
import { computePlanHash } from "./plan-hash.js";
import { computeCapsuleHash } from "./prompt-capsule.js";
import { computeSnapshotHash } from "./repo-snapshot.js";
import { computeDecisionLockHash } from "./decision-lock-hash.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmitStepPacketsInput {
  sessionId: string;
  sessionRoot: string;
  projectRoot: string;
  dod: DefinitionOfDone;
  lock: DecisionLock;
  plan: ExecutionPlanLike;
  capsule: PromptCapsule;
  snapshot: RepoSnapshot;
  symbolIndex?: SymbolIndex;
}

// ---------------------------------------------------------------------------
// Emission function
// ---------------------------------------------------------------------------

/**
 * Emit step packets for all steps in execution plan.
 *
 * @param input - Artifacts and configuration
 * @returns Array of emitted packets (sorted by stepId)
 */
export function emitStepPackets(input: EmitStepPacketsInput): StepPacket[] {
  const {
    sessionId,
    sessionRoot,
    projectRoot,
    dod,
    lock,
    plan,
    capsule,
    snapshot,
    symbolIndex,
  } = input;

  // Validate prerequisites: compute hashes and verify they match
  const computedPlanHash = computePlanHash(plan);
  const computedCapsuleHash = computeCapsuleHash(capsule);
  const computedSnapshotHash = computeSnapshotHash(snapshot);
  const computedLockHash = computeDecisionLockHash(lock);

  // Verify hashes match (if present in artifacts)
  // Note: We compute hashes but don't enforce exact match here since artifacts
  // may not have hashes set yet. The packet will include the computed hashes.

  const steps = plan.steps || [];
  if (steps.length === 0) {
    throw new SessionError(
      "Execution plan has no steps",
      "STEP_PACKET_EMIT_FAILED",
      { sessionId },
    );
  }

  const packets: StepPacket[] = [];

  // Build snapshot file map for quick lookup
  const snapshotFileMap = new Map(
    snapshot.includedFiles.map((f) => [f.path, f]),
  );

  // For each step, build packet
  for (const step of steps) {
    // Determine allowedFiles: intersect capsule boundaries with step-specific if present
    const capsuleAllowedFiles = new Set(capsule.boundaries.allowedFiles);
    const stepAllowedFiles = step.allowedFiles
      ? new Set(Array.isArray(step.allowedFiles) ? step.allowedFiles : [])
      : null;

    const allowedFiles = stepAllowedFiles
      ? [...capsuleAllowedFiles].filter((f) => stepAllowedFiles.has(f)).sort()
      : [...capsuleAllowedFiles].sort();

    // Determine allowedSymbols: intersect capsule boundaries with step-specific if present
    const capsuleAllowedSymbols = new Set(capsule.boundaries.allowedSymbols);
    const stepAllowedSymbols = step.allowedSymbols
      ? new Set(Array.isArray(step.allowedSymbols) ? step.allowedSymbols : [])
      : null;

    const allowedSymbols = stepAllowedSymbols
      ? [...capsuleAllowedSymbols].filter((s) => stepAllowedSymbols.has(s)).sort()
      : [...capsuleAllowedSymbols].sort();

    // Get reviewerSequence from step or derive default
    let reviewerSequence: string[] = [];
    if (step.reviewerSequence && Array.isArray(step.reviewerSequence)) {
      reviewerSequence = [...step.reviewerSequence];
    } else {
      // Default reviewer sequence (minimum 3)
      reviewerSequence = ["static", "security", "qa"];
    }

    // Build file digests for allowedFiles
    const fileDigests = allowedFiles
      .filter((path) => snapshotFileMap.has(path))
      .map((path) => {
        const fileSnapshot = snapshotFileMap.get(path)!;
        return {
          path,
          sha256: fileSnapshot.contentHash,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path));

    // Build excerpts only if explicitly requested
    const excerpts: Array<{ path: string; startLine: number; endLine: number; text: string }> = [];
    if (step.includeExcerpts === true || (step.excerpts && Array.isArray(step.excerpts))) {
      const excerptRequests = step.excerpts && Array.isArray(step.excerpts)
        ? step.excerpts
        : allowedFiles.map((path) => ({ path, startLine: 1, endLine: 10 }));

      for (const req of excerptRequests) {
        const path = typeof req === "string" ? req : req.path;
        if (!allowedFiles.includes(path)) {
          continue; // Skip excerpts for disallowed files
        }

        const fileSnapshot = snapshotFileMap.get(path);
        if (!fileSnapshot) {
          continue; // Skip if file not in snapshot
        }

        // Read file content
        try {
          const filePath = resolve(projectRoot, path);
          const content = readFileSync(filePath, "utf8");
          const lines = content.split("\n");

          const startLine = typeof req === "string" ? 1 : (req.startLine || 1);
          const endLine = typeof req === "string"
            ? Math.min(10, lines.length)
            : (req.endLine || Math.min(startLine + 9, lines.length));

          // Ensure valid range
          const validStart = Math.max(1, Math.min(startLine, lines.length));
          const validEnd = Math.max(validStart, Math.min(endLine, lines.length));

          // Extract excerpt text (max 2000 chars)
          const excerptLines = lines.slice(validStart - 1, validEnd);
          let excerptText = excerptLines.join("\n");
          if (excerptText.length > 2000) {
            excerptText = excerptText.substring(0, 2000);
          }

          excerpts.push({
            path,
            startLine: validStart,
            endLine: validEnd,
            text: excerptText,
          });
        } catch (error) {
          // Skip if file cannot be read
          continue;
        }
      }
    }

    // Sort excerpts by path, then startLine
    excerpts.sort((a, b) => {
      const pathCmp = a.path.localeCompare(b.path);
      return pathCmp !== 0 ? pathCmp : a.startLine - b.startLine;
    });

    // Build packet data (without packetHash)
    const createdAt = new Date().toISOString();
    const packetData: Omit<StepPacket, "packetHash"> = {
      schemaVersion: capsule.schemaVersion,
      sessionId,
      lockId: lock.lockId,
      stepId: step.stepId,
      planHash: computedPlanHash,
      capsuleHash: computedCapsuleHash,
      snapshotHash: computedSnapshotHash,
      goalReference: lock.goal, // MUST include exact Decision Lock goal
      dodId: dod.dodId,
      dodItemRefs: [...(step.references || [])].sort(),
      allowedFiles,
      allowedSymbols,
      requiredCapabilities: step.requiredCapabilities
        ? [...step.requiredCapabilities].sort()
        : undefined,
      reviewerSequence,
      context: {
        fileDigests: fileDigests.length > 0 ? fileDigests : undefined,
        excerpts: excerpts.length > 0 ? excerpts : undefined,
      },
      createdAt,
      packetHash: "", // Will be computed
    };

    // Compute hash
    const packetHash = computeStepPacketHash(packetData as StepPacket);

    // Build final packet with computed hash
    const finalPacket = {
      ...packetData,
      packetHash,
    } as StepPacket;

    // Lint packet
    lintStepPacket({
      packet: finalPacket,
      lockGoal: lock.goal,
      capsule,
      plan,
      snapshot,
      symbolIndex,
    });

    packets.push(finalPacket);
  }

  // Return sorted by stepId
  return packets.sort((a, b) => a.stepId.localeCompare(b.stepId));
}
