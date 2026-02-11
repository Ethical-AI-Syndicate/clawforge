/**
 * Step Packet Linter — structural validation for step packets.
 *
 * Phase O: Validates step packets against approved artifacts and boundaries.
 * Ensures packets contain only allowed context and no executable/side-effect language.
 */

import { SessionError } from "./errors.js";
import type { StepPacket } from "./step-packet.js";
import type { DecisionLock, DefinitionOfDone } from "./schemas.js";
import type { PromptCapsule } from "./prompt-capsule.js";
import type { ExecutionPlanLike, ExecutionPlanStep } from "./evidence-validation.js";
import type { RepoSnapshot } from "./repo-snapshot.js";
import type { SymbolIndex } from "./symbol-index.js";
import {
  CAPABILITY_REGISTRY,
  isCapabilityRegistered,
} from "./capabilities.js";
import { REVIEWER_ROLES } from "./reviewer-contract.js";

// Reuse forbidden token scanning logic from prompt-lint.ts
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FORBIDDEN_WORD_PATTERNS: ReadonlyArray<string> = [
  "rm ",
  "mv ",
  "cp ",
  "chmod",
  "chown",
  "sudo",
  "bash",
  "sh ",
  "zsh",
  "powershell",
  "cmd.exe",
];

const FORBIDDEN_NETWORK_PATTERNS: ReadonlyArray<string> = [
  "curl",
  "wget",
  "http://",
  "https://",
  "fetch(",
  "axios",
  "XMLHttpRequest",
  "net.",
  "tls.",
  "ssh",
  "scp",
];

const FORBIDDEN_FILESYSTEM_PATTERNS: ReadonlyArray<string> = [
  "writeFile",
  "unlink",
  "rmdir",
  "mkdir",
  "chmod",
  "chown",
];

const FORBIDDEN_PROCESS_PATTERNS: ReadonlyArray<string> = [
  "child_process",
  "spawn(",
  "exec(",
  "execFile(",
  "fork(",
];

const FORBIDDEN_VAGUE_PATTERNS: ReadonlyArray<string> = [
  "TODO",
  "TBD",
  "FIXME",
  "PLACEHOLDER",
  "XXX",
];

function scanForbiddenTokens(text: string): string[] {
  const detected: string[] = [];
  const textLower = text.toLowerCase();

  // Word-boundary patterns
  for (const pattern of FORBIDDEN_WORD_PATTERNS) {
    const re = new RegExp(`\\b${escapeRegex(pattern)}\\b`, "i");
    if (re.test(text)) {
      detected.push(pattern);
    }
  }

  // Substring patterns (network)
  for (const pattern of FORBIDDEN_NETWORK_PATTERNS) {
    if (textLower.includes(pattern.toLowerCase())) {
      detected.push(pattern);
    }
  }

  // Substring patterns (filesystem)
  for (const pattern of FORBIDDEN_FILESYSTEM_PATTERNS) {
    if (textLower.includes(pattern.toLowerCase())) {
      detected.push(pattern);
    }
  }

  // Substring patterns (process)
  for (const pattern of FORBIDDEN_PROCESS_PATTERNS) {
    if (textLower.includes(pattern.toLowerCase())) {
      detected.push(pattern);
    }
  }

  // Substring patterns (vague)
  for (const pattern of FORBIDDEN_VAGUE_PATTERNS) {
    if (text.includes(pattern)) {
      detected.push(pattern);
    }
  }

  return detected;
}

// ---------------------------------------------------------------------------
// Forbidden tokens helper
// ---------------------------------------------------------------------------

/**
 * Scan for HTTP methods with word boundary.
 */
function scanHttpMethods(text: string): string[] {
  const httpMethodPattern = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/i;
  const detected: string[] = [];
  if (httpMethodPattern.test(text)) {
    detected.push("HTTP method detected");
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Linting function
// ---------------------------------------------------------------------------

export interface LintStepPacketInput {
  packet: StepPacket;
  lockGoal: string; // Exact Decision Lock goal string
  capsule: PromptCapsule;
  plan: ExecutionPlanLike;
  snapshot: RepoSnapshot;
  symbolIndex?: SymbolIndex;
}

/**
 * Lint step packet against approved artifacts and boundaries.
 *
 * @param input - Packet and artifacts to validate against
 * @throws SessionError with code STEP_PACKET_LINT_FAILED on any failure
 */
export function lintStepPacket(input: LintStepPacketInput): void {
  const { packet, lockGoal, capsule, plan, snapshot, symbolIndex } = input;
  const errors: string[] = [];

  // 1. Step Validation
  const steps = plan.steps || [];
  const step = steps.find((s) => s.stepId === packet.stepId);
  if (!step) {
    throw new SessionError(
      `Step packet stepId "${packet.stepId}" does not exist in execution plan`,
      "STEP_PACKET_LINT_FAILED",
      { stepId: packet.stepId },
    );
  }

  // 2. Goal Reference
  if (!packet.goalReference.includes(lockGoal)) {
    errors.push(
      `Packet goalReference must contain exact Decision Lock goal string`,
    );
  }

  // 3. DoD References (set-equal, not just subset)
  const packetRefs = new Set([...packet.dodItemRefs].sort());
  const stepRefs = new Set([...(step.references || [])].sort());
  if (packetRefs.size !== stepRefs.size) {
    errors.push(
      `Packet dodItemRefs (${packet.dodItemRefs.length}) must be set-equal to step.references (${step.references?.length || 0})`,
    );
  } else {
    for (const ref of packetRefs) {
      if (!stepRefs.has(ref)) {
        errors.push(`Packet dodItemRefs contains "${ref}" not in step.references`);
      }
    }
    for (const ref of stepRefs) {
      if (!packetRefs.has(ref)) {
        errors.push(`Step.references contains "${ref}" not in packet.dodItemRefs`);
      }
    }
  }

  // 4. File Boundaries
  const capsuleAllowedFiles = new Set(capsule.boundaries.allowedFiles);
  const stepAllowedFiles = step.allowedFiles
    ? new Set(Array.isArray(step.allowedFiles) ? step.allowedFiles : [])
    : null;

  // Intersect step-specific files if present
  const expectedAllowedFiles = stepAllowedFiles
    ? [...capsuleAllowedFiles].filter((f) => stepAllowedFiles.has(f))
    : [...capsuleAllowedFiles];

  const packetAllowedFilesSet = new Set(packet.allowedFiles);
  const expectedAllowedFilesSet = new Set(expectedAllowedFiles);

  // Check packet.allowedFiles is subset of expected
  for (const file of packet.allowedFiles) {
    if (!expectedAllowedFilesSet.has(file)) {
      errors.push(
        `Packet allowedFiles contains "${file}" which is not in capsule.boundaries.allowedFiles${stepAllowedFiles ? " or step.allowedFiles" : ""}`,
      );
    }
  }

  // Check all packet files exist in snapshot
  const snapshotFiles = new Set(snapshot.includedFiles.map((f) => f.path));
  for (const file of packet.allowedFiles) {
    if (!snapshotFiles.has(file)) {
      errors.push(
        `Packet allowedFiles contains "${file}" which does not exist in snapshot`,
      );
    }
  }

  // 5. Symbol Boundaries
  const capsuleAllowedSymbols = new Set(capsule.boundaries.allowedSymbols);
  const stepAllowedSymbols = step.allowedSymbols
    ? new Set(Array.isArray(step.allowedSymbols) ? step.allowedSymbols : [])
    : null;

  const expectedAllowedSymbols = stepAllowedSymbols
    ? [...capsuleAllowedSymbols].filter((s) => stepAllowedSymbols.has(s))
    : [...capsuleAllowedSymbols];

  const packetAllowedSymbolsSet = new Set(packet.allowedSymbols);
  const expectedAllowedSymbolsSet = new Set(expectedAllowedSymbols);

  for (const symbol of packet.allowedSymbols) {
    if (!expectedAllowedSymbolsSet.has(symbol)) {
      errors.push(
        `Packet allowedSymbols contains "${symbol}" which is not in capsule.boundaries.allowedSymbols${stepAllowedSymbols ? " or step.allowedSymbols" : ""}`,
      );
    }
  }

  // 6. Capabilities
  const planAllowedCapabilities = new Set(plan.allowedCapabilities || []);
  if (packet.requiredCapabilities) {
    for (const cap of packet.requiredCapabilities) {
      if (!planAllowedCapabilities.has(cap)) {
        errors.push(
          `Packet requiredCapabilities contains "${cap}" which is not in plan.allowedCapabilities`,
        );
      }
      if (!isCapabilityRegistered(cap)) {
        errors.push(
          `Packet requiredCapabilities contains "${cap}" which is not registered in CAPABILITY_REGISTRY`,
        );
      }
    }
  }

  // 7. Reviewer Sequence
  if (packet.reviewerSequence.length < 3) {
    errors.push(
      `Packet reviewerSequence must have at least 3 reviewers, got ${packet.reviewerSequence.length}`,
    );
  }

  const knownRoles = new Set(REVIEWER_ROLES);
  for (const role of packet.reviewerSequence) {
    if (!knownRoles.has(role as typeof REVIEWER_ROLES[number])) {
      errors.push(`Packet reviewerSequence contains unknown role "${role}"`);
    }
  }

  // Check if step has reviewerSequence and it matches
  if (step.reviewerSequence && Array.isArray(step.reviewerSequence)) {
    const stepReviewerSequence = step.reviewerSequence as string[];
    if (stepReviewerSequence.length !== packet.reviewerSequence.length) {
      errors.push(
        `Packet reviewerSequence length (${packet.reviewerSequence.length}) does not match step.reviewerSequence length (${stepReviewerSequence.length})`,
      );
    } else {
      for (let i = 0; i < stepReviewerSequence.length; i++) {
        if (stepReviewerSequence[i] !== packet.reviewerSequence[i]) {
          errors.push(
            `Packet reviewerSequence[${i}] "${packet.reviewerSequence[i]}" does not match step.reviewerSequence[${i}] "${stepReviewerSequence[i]}"`,
          );
        }
      }
    }
  }

  // 8. Forbidden Tokens
  const forbiddenInGoal = scanForbiddenTokens(packet.goalReference);
  if (forbiddenInGoal.length > 0) {
    errors.push(
      `Packet goalReference contains forbidden tokens: ${forbiddenInGoal.join(", ")}`,
    );
  }

  const httpInGoal = scanHttpMethods(packet.goalReference);
  if (httpInGoal.length > 0) {
    errors.push(`Packet goalReference contains HTTP methods`);
  }

  // Scan excerpts
  if (packet.context.excerpts) {
    for (const excerpt of packet.context.excerpts) {
      const forbiddenInExcerpt = scanForbiddenTokens(excerpt.text);
      if (forbiddenInExcerpt.length > 0) {
        errors.push(
          `Packet excerpt for "${excerpt.path}" contains forbidden tokens: ${forbiddenInExcerpt.join(", ")}`,
        );
      }

      const httpInExcerpt = scanHttpMethods(excerpt.text);
      if (httpInExcerpt.length > 0) {
        errors.push(`Packet excerpt for "${excerpt.path}" contains HTTP methods`);
      }
    }
  }

  // Scan serialized JSON
  const packetJson = JSON.stringify(packet);
  const forbiddenInJson = scanForbiddenTokens(packetJson);
  if (forbiddenInJson.length > 0) {
    errors.push(
      `Packet JSON contains forbidden tokens: ${forbiddenInJson.join(", ")}`,
    );
  }

  const httpInJson = scanHttpMethods(packetJson);
  if (httpInJson.length > 0) {
    errors.push(`Packet JSON contains HTTP methods`);
  }

  // 9. Excerpts Validation
  if (packet.context.excerpts) {
    const allowedFilesSet = new Set(packet.allowedFiles);
    for (const excerpt of packet.context.excerpts) {
      // Excerpts only for allowed files
      if (!allowedFilesSet.has(excerpt.path)) {
        errors.push(
          `Packet excerpt path "${excerpt.path}" is not in packet.allowedFiles`,
        );
      }

      // Text length check
      if (excerpt.text.length > 2000) {
        errors.push(
          `Packet excerpt for "${excerpt.path}" text length (${excerpt.text.length}) exceeds 2000 characters`,
        );
      }

      // Line range validation
      if (excerpt.startLine < 1) {
        errors.push(
          `Packet excerpt for "${excerpt.path}" startLine (${excerpt.startLine}) must be >= 1`,
        );
      }
      if (excerpt.endLine < 1) {
        errors.push(
          `Packet excerpt for "${excerpt.path}" endLine (${excerpt.endLine}) must be >= 1`,
        );
      }
      if (excerpt.startLine > excerpt.endLine) {
        errors.push(
          `Packet excerpt for "${excerpt.path}" startLine (${excerpt.startLine}) must be <= endLine (${excerpt.endLine})`,
        );
      }

      // Line range sanity check
      if (excerpt.endLine - excerpt.startLine > 100) {
        errors.push(
          `Packet excerpt for "${excerpt.path}" line range (${excerpt.endLine - excerpt.startLine} lines) exceeds 100 lines`,
        );
      }
    }
  }

  // 10. Context File Digests
  if (packet.context.fileDigests) {
    const allowedFilesSet = new Set(packet.allowedFiles);
    const snapshotFileMap = new Map(
      snapshot.includedFiles.map((f) => [f.path, f.contentHash]),
    );

    for (const digest of packet.context.fileDigests) {
      // All paths in allowedFiles
      if (!allowedFilesSet.has(digest.path)) {
        errors.push(
          `Packet context.fileDigests path "${digest.path}" is not in packet.allowedFiles`,
        );
      }

      // Path exists in snapshot
      const snapshotHash = snapshotFileMap.get(digest.path);
      if (!snapshotHash) {
        errors.push(
          `Packet context.fileDigests path "${digest.path}" does not exist in snapshot`,
        );
      } else if (snapshotHash !== digest.sha256) {
        errors.push(
          `Packet context.fileDigests hash for "${digest.path}" (${digest.sha256}) does not match snapshot hash (${snapshotHash})`,
        );
      }
    }
  }

  // Throw if any errors found
  if (errors.length > 0) {
    throw new SessionError(
      `Step packet linting failed: ${errors.join("; ")}`,
      "STEP_PACKET_LINT_FAILED",
      { stepId: packet.stepId, errors },
    );
  }
}
