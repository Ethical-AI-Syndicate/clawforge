/**
 * CLI configuration: resolve paths for the DB and artifact store.
 *
 * Defaults:
 *   DB:        ~/.clawforge/db.sqlite
 *   Artifacts: ~/.clawforge/artifacts/
 *
 * Environment overrides:
 *   CLAWFORGE_DB_PATH        absolute path to SQLite file
 *   CLAWFORGE_ARTIFACT_ROOT  absolute path to artifact directory
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";

export interface ClawforgeConfig {
  dbPath: string;
  artifactRoot: string;
  baseDir: string;
}

const DEFAULT_BASE = join(homedir(), ".clawforge");

export function resolveConfig(): ClawforgeConfig {
  const baseDir = DEFAULT_BASE;
  const dbPath = resolve(
    process.env["CLAWFORGE_DB_PATH"] ?? join(baseDir, "db.sqlite"),
  );
  const artifactRoot = resolve(
    process.env["CLAWFORGE_ARTIFACT_ROOT"] ?? join(baseDir, "artifacts"),
  );
  return { dbPath, artifactRoot, baseDir };
}

/**
 * Ensure the base directory and artifact root exist.
 */
export function ensureDataDirs(config: ClawforgeConfig): void {
  mkdirSync(config.baseDir, { recursive: true });
  mkdirSync(config.artifactRoot, { recursive: true });
}
