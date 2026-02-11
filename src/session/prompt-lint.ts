/**
 * Prompt Capsule and Model Response Linter — deterministic structural validation.
 *
 * Phase K: Validates prompt capsules and model responses against strict boundaries.
 * All validation is structural and deterministic. No heuristics, no AI interpretation.
 */

import { SessionError } from "./errors.js";
import type { PromptCapsule } from "./prompt-capsule.js";
import type { ModelResponseArtifact, ChangeProposal } from "./model-response.js";
import type { DefinitionOfDone, DecisionLock } from "./schemas.js";
import type { ExecutionPlanLike } from "./evidence-validation.js";
import { computePlanHash } from "./plan-hash.js";
import { computeCapsuleHash } from "./prompt-capsule.js";
import { computeResponseHash } from "./model-response.js";
import {
  CAPABILITY_REGISTRY,
  isCapabilityRegistered,
} from "./capabilities.js";
import { extractReferencedFilePathsFromPatch } from "./symbol-boundary.js";

// ---------------------------------------------------------------------------
// Forbidden patterns (from execution-plan-lint.ts pattern)
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Patterns matched as whole words only
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

// Network patterns (substring match)
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

// Filesystem mutation patterns
const FORBIDDEN_FILESYSTEM_PATTERNS: ReadonlyArray<string> = [
  "writeFile",
  "unlink",
  "rmdir",
  "mkdir",
  "chmod",
  "chown",
];

// Process spawning patterns
const FORBIDDEN_PROCESS_PATTERNS: ReadonlyArray<string> = [
  "child_process",
  "spawn(",
  "exec(",
  "execFile(",
  "fork(",
];

// Vague placeholders
const FORBIDDEN_VAGUE_PATTERNS: ReadonlyArray<string> = [
  "TODO",
  "TBD",
  "FIXME",
  "PLACEHOLDER",
  "XXX",
];

/**
 * Check if text contains forbidden tokens.
 *
 * @param text - Text to scan
 * @returns Array of detected forbidden patterns
 */
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
// lintPromptCapsule
// ---------------------------------------------------------------------------

/**
 * Lint prompt capsule against DoD, Lock, and Plan.
 * Throws SessionError on any validation failure.
 *
 * @param capsule - Prompt capsule to validate
 * @param dod - Definition of Done
 * @param lock - Decision Lock
 * @param plan - Execution Plan
 */
export function lintPromptCapsule(
  capsule: PromptCapsule,
  dod: DefinitionOfDone,
  lock: DecisionLock,
  plan: ExecutionPlanLike,
): void {
  // 1. Schema parse success (should already be validated, but double-check)
  // This is handled by the caller parsing with PromptCapsuleSchema

  // 2. capsule.sessionId matches DoD/Lock/Plan sessionId
  if (capsule.sessionId !== dod.sessionId) {
    throw new SessionError(
      `Capsule sessionId "${capsule.sessionId}" does not match DoD sessionId "${dod.sessionId}"`,
      "PROMPT_CAPSULE_LINT_FAILED",
      {
        capsuleSessionId: capsule.sessionId,
        dodSessionId: dod.sessionId,
      },
    );
  }

  if (capsule.sessionId !== lock.sessionId) {
    throw new SessionError(
      `Capsule sessionId "${capsule.sessionId}" does not match Lock sessionId "${lock.sessionId}"`,
      "PROMPT_CAPSULE_LINT_FAILED",
      {
        capsuleSessionId: capsule.sessionId,
        lockSessionId: lock.sessionId,
      },
    );
  }

  if (plan.sessionId && capsule.sessionId !== plan.sessionId) {
    throw new SessionError(
      `Capsule sessionId "${capsule.sessionId}" does not match Plan sessionId "${plan.sessionId}"`,
      "PROMPT_CAPSULE_LINT_FAILED",
      {
        capsuleSessionId: capsule.sessionId,
        planSessionId: plan.sessionId,
      },
    );
  }

  // 3. capsule.lockId matches lock.lockId
  if (capsule.lockId !== lock.lockId) {
    throw new SessionError(
      `Capsule lockId "${capsule.lockId}" does not match Lock lockId "${lock.lockId}"`,
      "PROMPT_CAPSULE_LINT_FAILED",
      {
        capsuleLockId: capsule.lockId,
        lockLockId: lock.lockId,
      },
    );
  }

  // 4. capsule.planHash matches computed planHash
  const computedPlanHash = computePlanHash(plan);
  if (capsule.planHash !== computedPlanHash) {
    throw new SessionError(
      `Capsule planHash "${capsule.planHash}" does not match computed planHash "${computedPlanHash}"`,
      "PROMPT_CAPSULE_LINT_FAILED",
      {
        capsulePlanHash: capsule.planHash,
        computedPlanHash,
      },
    );
  }

  // 5. capsule.model constraints (temperature 0, topP 1, seed required)
  // These are already validated by schema, but double-check for clarity
  if (capsule.model.temperature !== 0) {
    throw new SessionError(
      `Capsule model temperature must be 0, got ${capsule.model.temperature}`,
      "PROMPT_CAPSULE_LINT_FAILED",
      { temperature: capsule.model.temperature },
    );
  }

  if (capsule.model.topP !== 1) {
    throw new SessionError(
      `Capsule model topP must be 1, got ${capsule.model.topP}`,
      "PROMPT_CAPSULE_LINT_FAILED",
      { topP: capsule.model.topP },
    );
  }

  // 6. allowedCapabilities subset_of plan.allowedCapabilities AND exist in registry
  const planAllowedCapabilities = plan.allowedCapabilities ?? [];
  const planAllowedSet = new Set(planAllowedCapabilities);
  const capsuleAllowedSet = new Set(capsule.boundaries.allowedCapabilities);

  for (const cap of capsule.boundaries.allowedCapabilities) {
    if (!isCapabilityRegistered(cap)) {
      throw new SessionError(
        `Capsule allowedCapability "${cap}" is not registered in CAPABILITY_REGISTRY`,
        "PROMPT_CAPSULE_LINT_FAILED",
        { capability: cap },
      );
    }

    if (!planAllowedSet.has(cap)) {
      throw new SessionError(
        `Capsule allowedCapability "${cap}" is not in plan.allowedCapabilities`,
        "PROMPT_CAPSULE_LINT_FAILED",
        { capability: cap, planAllowedCapabilities },
      );
    }
  }

  // 7. allowedDoDItems subset_of DoD.items[].id
  const dodItemIds = new Set(dod.items.map((item) => item.id));
  for (const itemId of capsule.boundaries.allowedDoDItems) {
    if (!dodItemIds.has(itemId)) {
      throw new SessionError(
        `Capsule allowedDoDItem "${itemId}" does not exist in DoD`,
        "PROMPT_CAPSULE_LINT_FAILED",
        { itemId, dodItemIds: Array.from(dodItemIds) },
      );
    }
  }

  // 8. allowedPlanStepIds subset_of plan.steps[].stepId
  const planSteps = plan.steps ?? [];
  const planStepIds = new Set(
    planSteps.map((step: { stepId?: string }) => step.stepId).filter(Boolean),
  );
  for (const stepId of capsule.boundaries.allowedPlanStepIds) {
    if (!planStepIds.has(stepId)) {
      throw new SessionError(
        `Capsule allowedPlanStepId "${stepId}" does not exist in plan`,
        "PROMPT_CAPSULE_LINT_FAILED",
        { stepId, planStepIds: Array.from(planStepIds) },
      );
    }
  }

  // 9. fileDigests validation
  const allowedFilesSet = new Set(capsule.boundaries.allowedFiles);
  for (const digest of capsule.inputs.fileDigests) {
    if (!allowedFilesSet.has(digest.path)) {
      throw new SessionError(
        `FileDigest path "${digest.path}" is not in allowedFiles`,
        "PROMPT_CAPSULE_LINT_FAILED",
        { path: digest.path },
      );
    }

    // sha256 format already validated by schema
    if (digest.sha256.length !== 64) {
      throw new SessionError(
        `FileDigest sha256 must be 64 chars, got ${digest.sha256.length}`,
        "PROMPT_CAPSULE_LINT_FAILED",
        { path: digest.path },
      );
    }
  }

  // Coverage check (if partialCoverage=false)
  if (!capsule.inputs.partialCoverage) {
    const digestPaths = new Set(
      capsule.inputs.fileDigests.map((d) => d.path),
    );
    for (const allowedFile of capsule.boundaries.allowedFiles) {
      if (!digestPaths.has(allowedFile)) {
        throw new SessionError(
          `FileDigest missing for allowedFile "${allowedFile}" (partialCoverage=false)`,
          "PROMPT_CAPSULE_LINT_FAILED",
          { allowedFile },
        );
      }
    }
  }

  // 10. goalExcerpt must include exact lock.goal substring
  if (!capsule.intent.goalExcerpt.includes(lock.goal)) {
    throw new SessionError(
      `Capsule goalExcerpt must include exact lock.goal substring`,
      "PROMPT_CAPSULE_LINT_FAILED",
      {
        goalExcerpt: capsule.intent.goalExcerpt,
        lockGoal: lock.goal,
      },
    );
  }

  // 11. capsuleHash recomputation match
  const computedCapsuleHash = computeCapsuleHash(capsule);
  if (capsule.hash.capsuleHash !== computedCapsuleHash) {
    throw new SessionError(
      `Capsule hash mismatch: expected ${computedCapsuleHash}, got ${capsule.hash.capsuleHash}`,
      "CAPSULE_HASH_MISMATCH",
      {
        expected: computedCapsuleHash,
        got: capsule.hash.capsuleHash,
      },
    );
  }
}

// ---------------------------------------------------------------------------
// lintModelResponse
// ---------------------------------------------------------------------------

/**
 * Lint model response against capsule boundaries.
 * Throws SessionError on any validation failure.
 *
 * @param response - Model response artifact to validate
 * @param capsule - Prompt capsule (source of boundaries)
 * @param dod - Definition of Done
 * @param lock - Decision Lock
 * @param plan - Execution Plan
 */
export function lintModelResponse(
  response: ModelResponseArtifact,
  capsule: PromptCapsule,
  dod: DefinitionOfDone,
  lock: DecisionLock,
  plan: ExecutionPlanLike,
): void {
  // 1. Schema parse success (should already be validated)

  // 2. response.sessionId == capsule.sessionId, response.capsuleId == capsule.capsuleId
  if (response.sessionId !== capsule.sessionId) {
    throw new SessionError(
      `Response sessionId "${response.sessionId}" does not match capsule sessionId "${capsule.sessionId}"`,
      "MODEL_RESPONSE_LINT_FAILED",
      {
        responseSessionId: response.sessionId,
        capsuleSessionId: capsule.sessionId,
      },
    );
  }

  if (response.capsuleId !== capsule.capsuleId) {
    throw new SessionError(
      `Response capsuleId "${response.capsuleId}" does not match capsule capsuleId "${capsule.capsuleId}"`,
      "MODEL_RESPONSE_LINT_FAILED",
      {
        responseCapsuleId: response.capsuleId,
        capsuleCapsuleId: capsule.capsuleId,
      },
    );
  }

  // 3. response.model.seed matches capsule.model.seed and modelId/provider matches
  if (response.model.seed !== capsule.model.seed) {
    throw new SessionError(
      `Response model.seed ${response.model.seed} does not match capsule model.seed ${capsule.model.seed}`,
      "MODEL_RESPONSE_LINT_FAILED",
      {
        responseSeed: response.model.seed,
        capsuleSeed: capsule.model.seed,
      },
    );
  }

  if (response.model.modelId !== capsule.model.modelId) {
    throw new SessionError(
      `Response model.modelId "${response.model.modelId}" does not match capsule model.modelId "${capsule.model.modelId}"`,
      "MODEL_RESPONSE_LINT_FAILED",
      {
        responseModelId: response.model.modelId,
        capsuleModelId: capsule.model.modelId,
      },
    );
  }

  if (response.model.provider !== capsule.model.provider) {
    throw new SessionError(
      `Response model.provider "${response.model.provider}" does not match capsule model.provider "${capsule.model.provider}"`,
      "MODEL_RESPONSE_LINT_FAILED",
      {
        responseProvider: response.model.provider,
        capsuleProvider: capsule.model.provider,
      },
    );
  }

  // 4. responseHash recomputation match
  const computedResponseHash = computeResponseHash(response);
  if (response.hash.responseHash !== computedResponseHash) {
    throw new SessionError(
      `Response hash mismatch: expected ${computedResponseHash}, got ${response.hash.responseHash}`,
      "RESPONSE_HASH_MISMATCH",
      {
        expected: computedResponseHash,
        got: response.hash.responseHash,
      },
    );
  }

  // 5. ChangeProposal boundary checks
  const allowedFilesSet = new Set(capsule.boundaries.allowedFiles);
  const allowedDoDItemsSet = new Set(capsule.boundaries.allowedDoDItems);
  const allowedPlanStepIdsSet = new Set(
    capsule.boundaries.allowedPlanStepIds,
  );
  const allowedSymbolsSet = new Set(capsule.boundaries.allowedSymbols);
  const allowedExternalModulesSet = new Set(
    capsule.boundaries.allowedExternalModules,
  );

  for (const change of response.output.proposedChanges) {
    // targetPath must be in allowedFiles unless no_change
    if (change.changeType !== "no_change") {
      if (!allowedFilesSet.has(change.targetPath)) {
        throw new SessionError(
          `ChangeProposal targetPath "${change.targetPath}" is not in allowedFiles`,
          "BOUNDARY_VIOLATION",
          {
            changeId: change.changeId,
            targetPath: change.targetPath,
            changeType: change.changeType,
          },
        );
      }

      // add_file must be pre-approved (targetPath must be in allowedFiles)
      if (change.changeType === "add_file") {
        if (!allowedFilesSet.has(change.targetPath)) {
          throw new SessionError(
            `add_file change targetPath "${change.targetPath}" must be pre-approved in allowedFiles`,
            "BOUNDARY_VIOLATION",
            {
              changeId: change.changeId,
              targetPath: change.targetPath,
            },
          );
        }
      }
    }

    // referencedDoDItems subset_of capsule.boundaries.allowedDoDItems
    for (const itemId of change.referencedDoDItems) {
      if (!allowedDoDItemsSet.has(itemId)) {
        throw new SessionError(
          `ChangeProposal referencedDoDItem "${itemId}" is not in allowedDoDItems`,
          "BOUNDARY_VIOLATION",
          {
            changeId: change.changeId,
            itemId,
          },
        );
      }
    }

    // referencedPlanStepIds subset_of capsule.boundaries.allowedPlanStepIds
    for (const stepId of change.referencedPlanStepIds) {
      if (!allowedPlanStepIdsSet.has(stepId)) {
        throw new SessionError(
          `ChangeProposal referencedPlanStepId "${stepId}" is not in allowedPlanStepIds`,
          "BOUNDARY_VIOLATION",
          {
            changeId: change.changeId,
            stepId,
          },
        );
      }
    }

    // referencedSymbols subset_of capsule.boundaries.allowedSymbols
    for (const symbol of change.referencedSymbols) {
      if (!allowedSymbolsSet.has(symbol)) {
        throw new SessionError(
          `ChangeProposal referencedSymbol "${symbol}" is not in allowedSymbols`,
          "BOUNDARY_VIOLATION",
          {
            changeId: change.changeId,
            symbol,
          },
        );
      }
    }

    // Patch import boundary check
    if (change.patch) {
      const referencedPaths = extractReferencedFilePathsFromPatch(change.patch);
      for (const refPath of referencedPaths) {
        // Check if it's an external module
        if (!refPath.includes("/") && !refPath.startsWith(".")) {
          // Likely external module (e.g., "lodash", "axios")
          if (!allowedExternalModulesSet.has(refPath)) {
            throw new SessionError(
              `ChangeProposal patch imports external module "${refPath}" which is not in allowedExternalModules`,
              "IMPORT_BOUNDARY_VIOLATION",
              {
                changeId: change.changeId,
                externalModule: refPath,
              },
            );
          }
        } else {
          // Repo-relative path
          if (!allowedFilesSet.has(refPath)) {
            throw new SessionError(
              `ChangeProposal patch imports file "${refPath}" which is not in allowedFiles`,
              "IMPORT_BOUNDARY_VIOLATION",
              {
                changeId: change.changeId,
                filePath: refPath,
              },
            );
          }
        }
      }
    }
  }

  // 6. Citation boundary checks
  for (const citation of response.output.citations) {
    let isValid = false;

    switch (citation.type) {
      case "file":
        isValid = allowedFilesSet.has(citation.ref);
        break;
      case "symbol":
        isValid = allowedSymbolsSet.has(citation.ref);
        break;
      case "dod_item":
        isValid = allowedDoDItemsSet.has(citation.ref);
        break;
      case "plan_step":
        isValid = allowedPlanStepIdsSet.has(citation.ref);
        break;
      case "policy":
        // Policy references are allowed (no explicit allowlist for policies)
        isValid = true;
        break;
      case "other":
        // Other references need explicit validation - for now, reject
        isValid = false;
        break;
    }

    if (!isValid) {
      throw new SessionError(
        `Citation ref "${citation.ref}" of type "${citation.type}" is not in allowed boundary set`,
        "BOUNDARY_VIOLATION",
        {
          citationType: citation.type,
          ref: citation.ref,
        },
      );
    }
  }

  // 7. Forbidden token scanning
  const textToScan = [
    response.output.summary,
    ...response.output.proposedChanges.flatMap((c) => c.riskNotes),
    ...response.output.citations.map((c) => c.note),
    ...response.output.proposedChanges
      .map((c) => c.patch)
      .filter((p): p is string => p !== null),
  ].join("\n");

  const detectedTokens = scanForbiddenTokens(textToScan);
  if (detectedTokens.length > 0) {
    throw new SessionError(
      `Response contains forbidden tokens: ${detectedTokens.join(", ")}`,
      "FORBIDDEN_TOKEN_DETECTED",
      {
        detectedTokens,
      },
    );
  }

  // 8. No new symbol invention (structural checks)
  // Check if response mentions file paths not in allowedFiles
  const filePathRe = /src\/[^\s"']+\.(ts|js|tsx|jsx|json)/g;
  const mentionedPaths = new Set<string>();
  let pathMatch: RegExpExecArray | null;
  while ((pathMatch = filePathRe.exec(textToScan)) !== null) {
    mentionedPaths.add(pathMatch[0]);
  }

  for (const mentionedPath of mentionedPaths) {
    if (!allowedFilesSet.has(mentionedPath)) {
      throw new SessionError(
        `Response mentions file path "${mentionedPath}" which is not in allowedFiles`,
        "BOUNDARY_VIOLATION",
        {
          mentionedPath,
        },
      );
    }
  }
}
