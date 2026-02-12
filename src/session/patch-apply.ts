/**
 * Patch Applicability Prover — deterministic patch application proof.
 *
 * Phase M: Proves whether patches apply cleanly to repo snapshots without
 * writing to disk. Uses strict unified diff parsing with exact hunk matching.
 */

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "./crypto.js";
import { SessionError } from "./errors.js";
import type { PatchArtifact } from "./patch-artifact.js";
import type { RepoSnapshot } from "./repo-snapshot.js";
import { findFileSnapshot } from "./repo-snapshot.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatchApplyReport {
  schemaVersion: string;
  sessionId: string;
  patchId: string;
  baseSnapshotHash: string;
  applied: boolean;
  touchedFiles: TouchedFile[];
  conflicts: Conflict[];
  reportHash: string;
}

export interface TouchedFile {
  path: string;
  changeType: "create" | "modify" | "delete";
  preHash?: string; // hash before apply (for modify/delete)
  postHash?: string; // hash after apply (for create/modify)
}

export interface Conflict {
  filePath: string;
  hunkIndex: number; // 0-based index of hunk
  reason: string;
  expectedHash?: string;
  actualHash?: string;
}

export interface ProvePatchAppliesOptions {
  projectRoot: string;
  allowDeletes?: boolean; // default false
  allowedFiles?: string[]; // validate patch files are in this list
}

interface DiffHunk {
  oldStart: number; // 1-based line number
  oldCount: number;
  newStart: number; // 1-based line number
  newCount: number;
  lines: HunkLine[];
}

interface HunkLine {
  type: "context" | "remove" | "add";
  content: string; // without prefix character
  lineNumber?: number; // original line number for context
}

// ---------------------------------------------------------------------------
// Unified diff parsing
// ---------------------------------------------------------------------------

/**
 * Parse unified diff into hunks.
 */
function parseUnifiedDiff(diff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = diff.split("\n");

  let currentHunk: DiffHunk | null = null;
  let hunkIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkHeaderRe = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;
    const hunkMatch = line.match(hunkHeaderRe);

    if (hunkMatch) {
      // Save previous hunk if exists
      if (currentHunk) {
        hunks.push(currentHunk);
      }

      const oldStart = parseInt(hunkMatch[1]!, 10);
      const oldCount = parseInt(hunkMatch[2] || "1", 10);
      const newStart = parseInt(hunkMatch[3]!, 10);
      const newCount = parseInt(hunkMatch[4] || "1", 10);

      currentHunk = {
        oldStart,
        oldCount,
        newStart,
        newCount,
        lines: [],
      };
      continue;
    }

    // Skip file headers (--- a/... and +++ b/...)
    if (line.startsWith("---") || line.startsWith("+++")) {
      continue;
    }

    // Parse hunk lines
    if (currentHunk) {
      if (line.startsWith(" ")) {
        // Context line
        currentHunk.lines.push({
          type: "context",
          content: line.slice(1),
        });
      } else if (line.startsWith("-")) {
        // Removed line
        currentHunk.lines.push({
          type: "remove",
          content: line.slice(1),
        });
      } else if (line.startsWith("+")) {
        // Added line
        currentHunk.lines.push({
          type: "add",
          content: line.slice(1),
        });
      }
      // Ignore other lines (e.g., \ No newline at end of file)
    }
  }

  // Add last hunk
  if (currentHunk) {
    hunks.push(currentHunk);
  }

  return hunks;
}

// ---------------------------------------------------------------------------
// In-memory patch application
// ---------------------------------------------------------------------------

/**
 * Apply a single hunk to file content in-memory.
 */
function applyHunk(
  fileContent: string,
  hunk: DiffHunk,
  hunkIndex: number,
): { result: string; conflict: Conflict | null } {
  const lines = fileContent.split("\n");
  const resultLines: string[] = [];
  let lineIndex = 0;
  let hunkLineIndex = 0;

  // Convert 1-based hunk oldStart to 0-based array index
  const startLine = hunk.oldStart - 1;

  // Copy lines before hunk
  while (lineIndex < startLine && lineIndex < lines.length) {
    resultLines.push(lines[lineIndex]!);
    lineIndex++;
  }

  // Verify all hunk lines match file (context and remove), using a single file-line cursor
  let verifyLineIndex = lineIndex;
  for (const hunkLine of hunk.lines) {
    if (hunkLine.type === "context" || hunkLine.type === "remove") {
      const expectedLine = hunkLine.content;
      const actualLine =
        verifyLineIndex < lines.length ? lines[verifyLineIndex]! : undefined;
      if (actualLine !== expectedLine) {
        const kind = hunkLine.type === "context" ? "Context" : "Removed";
        return {
          result: fileContent,
          conflict: {
            filePath: "",
            hunkIndex,
            reason: `${kind} line mismatch at line ${verifyLineIndex + 1}: expected "${expectedLine}", got "${actualLine ?? "EOF"}"`,
            expectedHash: sha256Hex(expectedLine),
            actualHash: actualLine ? sha256Hex(actualLine) : undefined,
          },
        };
      }
      verifyLineIndex++;
    }
  }

  // Apply hunk: remove and add lines
  let removedCount = 0;
  let addedCount = 0;

  for (const hunkLine of hunk.lines) {
    if (hunkLine.type === "context") {
      // Skip context lines (already verified)
      if (lineIndex < lines.length) {
        resultLines.push(lines[lineIndex]!);
        lineIndex++;
      }
    } else if (hunkLine.type === "remove") {
      // Remove line
      if (lineIndex < lines.length) {
        const expectedLine = hunkLine.content;
        const actualLine = lines[lineIndex]!;

        if (actualLine !== expectedLine) {
          return {
            result: fileContent,
            conflict: {
              filePath: "", // Will be set by caller
              hunkIndex,
              reason: `Removed line mismatch at line ${lineIndex + 1}: expected "${expectedLine}", got "${actualLine}"`,
              expectedHash: sha256Hex(expectedLine),
              actualHash: sha256Hex(actualLine),
            },
          };
        }

        lineIndex++;
        removedCount++;
      } else {
        return {
          result: fileContent,
          conflict: {
            filePath: "", // Will be set by caller
            hunkIndex,
            reason: `Cannot remove line ${lineIndex + 1}: file has only ${lines.length} lines`,
          },
        };
      }
    } else if (hunkLine.type === "add") {
      // Add line
      resultLines.push(hunkLine.content);
      addedCount++;
    }
  }

  // Copy remaining lines after hunk
  while (lineIndex < lines.length) {
    resultLines.push(lines[lineIndex]!);
    lineIndex++;
  }

  const result = resultLines.join("\n");
  return { result, conflict: null };
}

/**
 * Get file content from snapshot (in-memory lookup).
 */
function getFileContentFromSnapshot(
  snapshot: RepoSnapshot,
  filePath: string,
  projectRoot: string,
): string | null {
  const fileSnapshot = findFileSnapshot(snapshot, filePath);
  if (!fileSnapshot) {
    return null;
  }

  // Read file from disk using projectRoot + filePath
  // This is read-only, no writes
  try {
    const resolvedPath = resolve(projectRoot, filePath);
    return readFileSync(resolvedPath, "utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Patch application proof
// ---------------------------------------------------------------------------

/**
 * Prove patch applies to snapshot (in-memory only, no disk writes).
 *
 * @param patchArtifact - Patch to apply
 * @param snapshot - Repo snapshot to apply against
 * @param options - Options for application
 * @returns PatchApplyReport with conflicts if any
 */
export function provePatchApplies(
  patchArtifact: PatchArtifact,
  snapshot: RepoSnapshot,
  options: ProvePatchAppliesOptions,
): PatchApplyReport {
  const { projectRoot, allowDeletes = false, allowedFiles } = options;

  const touchedFiles: TouchedFile[] = [];
  const conflicts: Conflict[] = [];

  // Validate base snapshot hash matches (if provided in patch)
  const patchWithHash = patchArtifact as PatchArtifact & {
    baseSnapshotHash?: string;
  };
  const baseSnapshotHash = patchWithHash.baseSnapshotHash ?? snapshot.snapshotHash;

  if (baseSnapshotHash !== snapshot.snapshotHash) {
    throw new SessionError(
      `Patch baseSnapshotHash "${baseSnapshotHash}" does not match snapshot hash "${snapshot.snapshotHash}"`,
      "PATCH_BASE_MISMATCH",
      {
        patchId: patchArtifact.patchId,
        baseSnapshotHash,
        snapshotHash: snapshot.snapshotHash,
      },
    );
  }

  // Process each file change
  for (const fileChange of patchArtifact.filesChanged) {
    const filePath = fileChange.path;

    // Validate file is in allowedFiles if provided
    if (allowedFiles && !allowedFiles.includes(filePath)) {
      conflicts.push({
        filePath,
        hunkIndex: 0,
        reason: `File "${filePath}" is not in allowedFiles`,
      });
      continue;
    }

      const fileSnapshot = findFileSnapshot(snapshot, filePath);

    // Handle different change types
    if (fileChange.changeType === "create") {
      // Create: file must not exist in snapshot
      if (fileSnapshot) {
        conflicts.push({
          filePath,
          hunkIndex: 0,
          reason: `Cannot create file "${filePath}": file already exists in snapshot`,
          expectedHash: undefined,
          actualHash: fileSnapshot.contentHash,
        });
        continue;
      }

      // Parse diff and build new file
      const hunks = parseUnifiedDiff(fileChange.diff);
      let newContent = "";

      for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i]!;
        // For create, all lines should be additions
        for (const hunkLine of hunk.lines) {
          if (hunkLine.type === "add") {
            newContent += hunkLine.content + "\n";
          } else if (hunkLine.type === "context") {
            // Context lines in create are treated as additions
            newContent += hunkLine.content + "\n";
          }
        }
      }

      // Remove trailing newline if added
      if (newContent.endsWith("\n")) {
        newContent = newContent.slice(0, -1);
      }

      const postHash = sha256Hex(newContent);
      touchedFiles.push({
        path: filePath,
        changeType: "create",
        postHash,
      });
    } else if (fileChange.changeType === "modify") {
      // Modify: file must exist in snapshot
      if (!fileSnapshot) {
        conflicts.push({
          filePath,
          hunkIndex: 0,
          reason: `Cannot modify file "${filePath}": file does not exist in snapshot`,
        });
        continue;
      }

      // Get file content
      const fileContent = getFileContentFromSnapshot(
        snapshot,
        filePath,
        projectRoot,
      );
      if (!fileContent) {
        conflicts.push({
          filePath,
          hunkIndex: 0,
          reason: `Cannot read file "${filePath}" from snapshot`,
        });
        continue;
      }

      const preHash = fileSnapshot.contentHash;

      // Parse and apply hunks
      const hunks = parseUnifiedDiff(fileChange.diff);
      let currentContent = fileContent;

      for (let i = 0; i < hunks.length; i++) {
        const hunk = hunks[i]!;
        const { result, conflict } = applyHunk(currentContent, hunk, i);

        if (conflict) {
          conflict.filePath = filePath;
          conflicts.push(conflict);
          break;
        }

        currentContent = result;
      }

      if (conflicts.some((c) => c.filePath === filePath)) {
        // Skip if conflicts found
        continue;
      }

      const postHash = sha256Hex(currentContent);
      touchedFiles.push({
        path: filePath,
        changeType: "modify",
        preHash,
        postHash,
      });
    } else if (fileChange.changeType === "delete") {
      // Delete: reject by default unless explicitly allowed
      if (!allowDeletes) {
        conflicts.push({
          filePath,
          hunkIndex: 0,
          reason: `Delete operations are not allowed`,
        });
        continue;
      }

      // Delete: file must exist in snapshot
      if (!fileSnapshot) {
        conflicts.push({
          filePath,
          hunkIndex: 0,
          reason: `Cannot delete file "${filePath}": file does not exist in snapshot`,
        });
        continue;
      }

      // Verify diff matches file content exactly
      const fileContent = getFileContentFromSnapshot(
        snapshot,
        filePath,
        projectRoot,
      );
      if (!fileContent) {
        conflicts.push({
          filePath,
          hunkIndex: 0,
          reason: `Cannot read file "${filePath}" from snapshot`,
        });
        continue;
      }

      const hunks = parseUnifiedDiff(fileChange.diff);
      // For delete, verify all lines match
      const diffLines = fileChange.diff.split("\n");
      const fileLines = fileContent.split("\n");

      // Simple verification: all removed lines should match file content
      let fileLineIndex = 0;
      for (const hunk of hunks) {
        for (const hunkLine of hunk.lines) {
          if (hunkLine.type === "remove") {
            if (fileLineIndex >= fileLines.length) {
              conflicts.push({
                filePath,
                hunkIndex: hunks.indexOf(hunk),
                reason: `Delete hunk references line ${fileLineIndex + 1} but file has only ${fileLines.length} lines`,
              });
              break;
            }

            const expectedLine = hunkLine.content;
            const actualLine = fileLines[fileLineIndex]!;

            if (actualLine !== expectedLine) {
              conflicts.push({
                filePath,
                hunkIndex: hunks.indexOf(hunk),
                reason: `Delete line mismatch at line ${fileLineIndex + 1}: expected "${expectedLine}", got "${actualLine}"`,
                expectedHash: sha256Hex(expectedLine),
                actualHash: sha256Hex(actualLine),
              });
              break;
            }

            fileLineIndex++;
          } else if (hunkLine.type === "context") {
            fileLineIndex++;
          }
        }

        if (conflicts.some((c) => c.filePath === filePath)) {
          break;
        }
      }

      if (!conflicts.some((c) => c.filePath === filePath)) {
        touchedFiles.push({
          path: filePath,
          changeType: "delete",
          preHash: fileSnapshot.contentHash,
        });
      }
    }
  }

  // Sort conflicts and touchedFiles for determinism
  conflicts.sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.hunkIndex - b.hunkIndex;
  });

  touchedFiles.sort((a, b) => a.path.localeCompare(b.path));

  const applied = conflicts.length === 0;

  // Build report
  const report: Omit<PatchApplyReport, "reportHash"> = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: patchArtifact.sessionId,
    patchId: patchArtifact.patchId,
    baseSnapshotHash,
    applied,
    touchedFiles,
    conflicts,
  };

  // Compute report hash
  const canonical = canonicalJson(report);
  const reportHash = sha256Hex(canonical);

  return {
    ...report,
    reportHash,
  };
}
