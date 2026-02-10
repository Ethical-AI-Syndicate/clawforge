/**
 * Content-addressable artifact store backed by the local filesystem.
 *
 * Layout:  <root>/sha256/<first2chars>/<full_hash>
 *
 * Invariants:
 *   - Artifact paths are derived solely from SHA-256 hex — no user strings in paths.
 *   - Once written, an artifact is never overwritten or deleted.
 *   - Writes are atomic (write to temp file, then rename).
 *   - The caller-provided hash is never trusted; bytes are always re-hashed.
 *   - All resolved paths are checked to be descendants of the artifact root.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  statSync,
  lstatSync,
} from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { sha256Bytes } from "../audit/hashing.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default maximum artifact size in bytes (100 MB). */
const DEFAULT_MAX_ARTIFACT_BYTES = 104_857_600;

/** Hex character pattern — used to validate hashes before path construction. */
const HEX_64_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class ArtifactStoreError extends Error {
  public readonly code: ArtifactStoreErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: ArtifactStoreErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ArtifactStoreError";
    this.code = code;
    this.details = details ?? {};
  }
}

export type ArtifactStoreErrorCode =
  | "ARTIFACT_TOO_LARGE"
  | "PATH_TRAVERSAL"
  | "ARTIFACT_NOT_FOUND"
  | "HASH_MISMATCH"
  | "INVALID_HASH";

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** Metadata returned after a successful put. */
export interface ArtifactRecord {
  artifactId: string;  // SHA-256 hex of content
  sha256: string;       // same as artifactId (explicit per docs)
  size: number;         // byte length
  mime: string;         // MIME type
  label: string;        // human-readable label
  path: string;         // absolute filesystem path
}

/** Entry in the artifact manifest (for evidence export). */
export interface ManifestEntry {
  artifactId: string;
  sha256: string;
  size: number;
  mime: string;
  label: string;
  included: boolean;    // false if artifact exceeds export size threshold
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class ArtifactStore {
  private readonly root: string;
  private readonly maxBytes: number;

  /**
   * @param rootDir   Absolute path to the artifact storage directory.
   * @param maxBytes  Maximum artifact size in bytes (default 100 MB).
   */
  constructor(rootDir: string, maxBytes: number = DEFAULT_MAX_ARTIFACT_BYTES) {
    this.root = resolve(rootDir);
    this.maxBytes = maxBytes;
    mkdirSync(this.root, { recursive: true });
  }

  // -----------------------------------------------------------------------
  // Write
  // -----------------------------------------------------------------------

  /**
   * Store artifact bytes.  Returns an ArtifactRecord with the content hash,
   * size, and filesystem path.
   *
   * If the artifact already exists (same hash), this is a no-op and the
   * existing record is returned.  If a file exists at the path with
   * different content, an error is thrown (should never happen with SHA-256).
   *
   * @param content  Raw bytes.
   * @param mime     MIME type (e.g. "application/json").
   * @param label    Human-readable label (max 500 chars, truncated if longer).
   */
  putArtifact(
    content: Buffer,
    mime: string,
    label: string,
  ): ArtifactRecord {
    // 1. Size check
    if (content.length > this.maxBytes) {
      throw new ArtifactStoreError(
        `Artifact exceeds max size: ${content.length} > ${this.maxBytes}`,
        "ARTIFACT_TOO_LARGE",
        { size: content.length, maxBytes: this.maxBytes },
      );
    }
    if (content.length === 0) {
      throw new ArtifactStoreError(
        "Artifact must not be empty",
        "ARTIFACT_TOO_LARGE",
        { size: 0 },
      );
    }

    // 2. Compute hash from raw bytes (never trust caller-provided hash)
    const hash = sha256Bytes(content);

    // 3. Build safe path
    const artifactPath = this.hashToPath(hash);

    // 4. Idempotent write — skip if already exists with correct content
    if (existsSync(artifactPath)) {
      this.verifyNotSymlink(artifactPath);
      const existing = readFileSync(artifactPath);
      if (sha256Bytes(existing) !== hash) {
        // Should be astronomically unlikely with SHA-256
        throw new ArtifactStoreError(
          `Hash collision or corruption at path: ${artifactPath}`,
          "HASH_MISMATCH",
          { hash, existingSize: existing.length, newSize: content.length },
        );
      }
      // Already stored — return record
      return {
        artifactId: hash,
        sha256: hash,
        size: content.length,
        mime,
        label: label.slice(0, 500),
        path: artifactPath,
      };
    }

    // 5. Atomic write: temp file → rename
    const dir = this.hashToDir(hash);
    mkdirSync(dir, { recursive: true });

    const tmpPath = join(dir, `.tmp-${randomBytes(8).toString("hex")}`);
    this.assertInsideRoot(tmpPath);

    writeFileSync(tmpPath, content, { mode: 0o444 }); // read-only
    renameSync(tmpPath, artifactPath);

    return {
      artifactId: hash,
      sha256: hash,
      size: content.length,
      mime,
      label: label.slice(0, 500),
      path: artifactPath,
    };
  }

  // -----------------------------------------------------------------------
  // Read
  // -----------------------------------------------------------------------

  /**
   * Read artifact bytes by hash.
   * Returns the buffer, or throws if not found.
   */
  getArtifact(hash: string): Buffer {
    this.validateHash(hash);
    const artifactPath = this.hashToPath(hash);

    if (!existsSync(artifactPath)) {
      throw new ArtifactStoreError(
        `Artifact not found: ${hash}`,
        "ARTIFACT_NOT_FOUND",
        { hash },
      );
    }

    this.verifyNotSymlink(artifactPath);
    return readFileSync(artifactPath);
  }

  /**
   * Check whether an artifact exists by hash.
   */
  hasArtifact(hash: string): boolean {
    this.validateHash(hash);
    const artifactPath = this.hashToPath(hash);
    return existsSync(artifactPath);
  }

  // -----------------------------------------------------------------------
  // Verification
  // -----------------------------------------------------------------------

  /**
   * Verify an artifact's integrity by recomputing its hash.
   * Returns true if the file exists and its SHA-256 matches, false otherwise.
   */
  verifyArtifact(hash: string): boolean {
    this.validateHash(hash);
    const artifactPath = this.hashToPath(hash);
    if (!existsSync(artifactPath)) return false;
    this.verifyNotSymlink(artifactPath);
    const content = readFileSync(artifactPath);
    return sha256Bytes(content) === hash;
  }

  // -----------------------------------------------------------------------
  // Manifest generation
  // -----------------------------------------------------------------------

  /**
   * Build a manifest from a list of ArtifactRecords.
   *
   * @param records      Artifact records (from putArtifact results).
   * @param maxIncludeBytes  Artifacts larger than this are marked `included: false`.
   */
  buildManifest(
    records: ReadonlyArray<ArtifactRecord>,
    maxIncludeBytes: number = 50 * 1024 * 1024,
  ): ManifestEntry[] {
    return records.map((r) => ({
      artifactId: r.artifactId,
      sha256: r.sha256,
      size: r.size,
      mime: r.mime,
      label: r.label,
      included: r.size <= maxIncludeBytes,
    }));
  }

  // -----------------------------------------------------------------------
  // Path helpers (private)
  // -----------------------------------------------------------------------

  /** Validate that a hash string is exactly 64 hex characters. */
  private validateHash(hash: string): void {
    if (!HEX_64_RE.test(hash)) {
      throw new ArtifactStoreError(
        `Invalid artifact hash (expected 64 hex chars): ${hash}`,
        "INVALID_HASH",
        { hash },
      );
    }
  }

  /** Map a validated hash to its parent directory: <root>/sha256/<first2>/ */
  private hashToDir(hash: string): string {
    const prefix = hash.slice(0, 2);
    const dir = resolve(join(this.root, "sha256", prefix));
    this.assertInsideRoot(dir);
    return dir;
  }

  /** Map a validated hash to its file path: <root>/sha256/<first2>/<hash> */
  private hashToPath(hash: string): string {
    this.validateHash(hash);
    const prefix = hash.slice(0, 2);
    const filePath = resolve(join(this.root, "sha256", prefix, hash));
    this.assertInsideRoot(filePath);
    return filePath;
  }

  /** Throw if resolvedPath is not a descendant of this.root. */
  private assertInsideRoot(resolvedPath: string): void {
    const normalized = resolve(resolvedPath);
    if (
      !normalized.startsWith(this.root + sep) &&
      normalized !== this.root
    ) {
      throw new ArtifactStoreError(
        `Path traversal detected: ${resolvedPath} is outside artifact root`,
        "PATH_TRAVERSAL",
        { resolvedPath, root: this.root },
      );
    }
  }

  /** Throw if the path is a symlink (defense against symlink attacks). */
  private verifyNotSymlink(filePath: string): void {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink()) {
      throw new ArtifactStoreError(
        `Symlink detected at artifact path: ${filePath}`,
        "PATH_TRAVERSAL",
        { filePath },
      );
    }
  }
}
