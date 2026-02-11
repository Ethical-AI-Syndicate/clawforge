/**
 * Repo Snapshot Builder — deterministic repository state capture.
 *
 * Phase M: Builds a complete snapshot of repository files with content hashes
 * for deterministic patch binding and validation.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "./crypto.js";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RepoSnapshot {
  schemaVersion: string;
  sessionId: string; // UUID
  snapshotId: string; // UUID
  generatedAt: string; // ISO timestamp
  rootDescriptor: string; // Description of root
  includedFiles: FileSnapshot[]; // sorted by path
  snapshotHash: string; // sha256(canonicalJson(normalized))
}

export interface FileSnapshot {
  path: string; // POSIX relative path
  contentHash: string; // sha256(file content)
}

export interface BuildRepoSnapshotOptions {
  projectRoot: string;
  fileList: string[]; // array of paths (already expanded by caller)
  sessionId: string; // UUID
  rootDescriptor?: string; // optional description
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize file path to POSIX relative path from project root.
 */
function normalizePath(projectRoot: string, filePath: string): string {
  const resolved = resolve(filePath);
  const rootResolved = resolve(projectRoot);
  const relativePath = relative(rootResolved, resolved);
  // Convert to POSIX (forward slashes)
  return relativePath.split(sep).join("/");
}

/**
 * Validate path is safe (no traversal).
 */
function validatePath(path: string): void {
  if (path.includes("..")) {
    throw new SessionError(
      `Path traversal detected: ${path}`,
      "REPO_SNAPSHOT_INVALID",
      { path },
    );
  }
}

// ---------------------------------------------------------------------------
// Snapshot hash computation
// ---------------------------------------------------------------------------

/**
 * Compute snapshot hash from normalized snapshot (excluding snapshotHash field).
 */
export function computeSnapshotHash(snapshot: RepoSnapshot): string {
  // Create normalized copy without snapshotHash
  const { snapshotHash, ...normalized } = snapshot;
  const canonical = canonicalJson(normalized);
  return sha256Hex(canonical);
}

// ---------------------------------------------------------------------------
// Snapshot builder
// ---------------------------------------------------------------------------

/**
 * Build a deterministic repo snapshot from project files.
 *
 * @param options - Build options
 * @returns RepoSnapshot with all file content hashes
 */
export function buildRepoSnapshot(
  options: BuildRepoSnapshotOptions,
): RepoSnapshot {
  const { projectRoot, fileList, sessionId, rootDescriptor } = options;

  // Validate project root exists
  if (!existsSync(projectRoot)) {
    throw new SessionError(
      `Project root does not exist: ${projectRoot}`,
      "REPO_SNAPSHOT_INVALID",
      { projectRoot },
    );
  }

  const resolvedRoot = resolve(projectRoot);
  const snapshotId = uuidv4();
  const generatedAt = new Date().toISOString();
  const descriptor =
    rootDescriptor ?? `project root at ${resolvedRoot}`;

  const includedFiles: FileSnapshot[] = [];

  // Process each file
  for (const filePath of fileList) {
    // Resolve and normalize path
    const resolvedPath = resolve(resolvedRoot, filePath);
    const normalizedPath = normalizePath(resolvedRoot, resolvedPath);

    // Validate path safety
    validatePath(normalizedPath);

    // Ensure file is within project root
    if (!resolvedPath.startsWith(resolvedRoot + sep) && resolvedPath !== resolvedRoot) {
      throw new SessionError(
        `File path escapes project root: ${normalizedPath}`,
        "REPO_SNAPSHOT_INVALID",
        { filePath, normalizedPath, projectRoot },
      );
    }

    // Check if file exists
    if (!existsSync(resolvedPath)) {
      throw new SessionError(
        `File does not exist: ${resolvedPath}`,
        "REPO_SNAPSHOT_INVALID",
        { filePath, normalizedPath },
      );
    }

    // Read file content and compute hash
    try {
      const content = readFileSync(resolvedPath, "utf8");
      const contentHash = sha256Hex(content);

      includedFiles.push({
        path: normalizedPath,
        contentHash,
      });
    } catch (error) {
      throw new SessionError(
        `Failed to read file: ${resolvedPath}`,
        "REPO_SNAPSHOT_INVALID",
        { filePath: normalizedPath, error: String(error) },
      );
    }
  }

  // Sort files by path for determinism
  includedFiles.sort((a, b) => a.path.localeCompare(b.path));

  // Build snapshot
  const snapshot: Omit<RepoSnapshot, "snapshotHash"> = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    snapshotId,
    generatedAt,
    rootDescriptor: descriptor,
    includedFiles,
  };

  // Compute hash
  const snapshotHash = computeSnapshotHash(snapshot as RepoSnapshot);

  return {
    ...snapshot,
    snapshotHash,
  };
}

/**
 * Find file snapshot by path.
 */
export function findFileSnapshot(
  snapshot: RepoSnapshot,
  filePath: string,
): FileSnapshot | undefined {
  return snapshot.includedFiles.find((f) => f.path === filePath);
}

/**
 * Get file content hash from snapshot.
 */
export function getFileContentHash(
  snapshot: RepoSnapshot,
  filePath: string,
): string | undefined {
  const fileSnapshot = findFileSnapshot(snapshot, filePath);
  return fileSnapshot?.contentHash;
}
