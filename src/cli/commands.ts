/**
 * CLI command implementations.
 *
 * Every function:
 *   - accepts parsed arguments
 *   - calls library functions (no business logic here)
 *   - writes to stdout / stderr
 *   - returns an exit code (0 = success, 1 = error)
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { v4 as uuidv4 } from "uuid";
import { hostname } from "node:os";
import { EventStore, type EventDraft } from "../audit/store.js";
import { ArtifactStore } from "../storage/artifact-store.js";
import { exportEvidenceBundle } from "../evidence/export.js";
import { canonicalJson } from "../audit/canonical.js";
import {
  IntentContractSchema,
  StepContractSchema,
  WorkerTaskContractSchema,
} from "../contracts/schemas.js";
import { type ClawforgeConfig, ensureDataDirs } from "./config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function err(msg: string): void {
  process.stderr.write(`error: ${msg}\n`);
}

function out(msg: string): void {
  process.stdout.write(msg + "\n");
}

function requireFlag(
  flags: Map<string, string>,
  name: string,
): string | undefined {
  const v = flags.get(name);
  if (!v) {
    err(`missing required flag: --${name}`);
    return undefined;
  }
  return v;
}

function readJsonFile(path: string): unknown {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new Error(`File not found: ${abs}`);
  }
  const raw = readFileSync(abs, "utf8");
  return JSON.parse(raw) as unknown;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

export function cmdInit(config: ClawforgeConfig): number {
  ensureDataDirs(config);
  // Opening the store creates the DB + tables if not present
  const store = new EventStore(config.dbPath);
  store.close();
  out(`Initialized ClawForge at ${config.baseDir}`);
  out(`  DB:        ${config.dbPath}`);
  out(`  Artifacts: ${config.artifactRoot}`);
  return 0;
}

// ---------------------------------------------------------------------------
// config show
// ---------------------------------------------------------------------------

export function cmdConfigShow(
  config: ClawforgeConfig,
  json: boolean,
): number {
  if (json) {
    out(canonicalJson(config));
  } else {
    out(`baseDir:      ${config.baseDir}`);
    out(`dbPath:       ${config.dbPath}`);
    out(`artifactRoot: ${config.artifactRoot}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// validate-contract
// ---------------------------------------------------------------------------

export function cmdValidateContract(filePath: string, json: boolean): number {
  let data: unknown;
  try {
    data = readJsonFile(filePath);
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  }

  if (typeof data !== "object" || data === null) {
    err("Contract file must contain a JSON object");
    return 1;
  }

  const obj = data as Record<string, unknown>;

  // Detect contract type
  let typeName: string;
  let result: { success: boolean; error?: { message: string } };

  if ("intentId" in obj) {
    typeName = "IntentContract";
    result = IntentContractSchema.safeParse(obj) as typeof result;
  } else if ("stepId" in obj && "toolName" in obj) {
    typeName = "StepContract";
    result = StepContractSchema.safeParse(obj) as typeof result;
  } else if ("taskId" in obj && "workerType" in obj) {
    typeName = "WorkerTaskContract";
    result = WorkerTaskContractSchema.safeParse(obj) as typeof result;
  } else {
    err(
      "Cannot detect contract type. Expected one of: IntentContract (intentId), StepContract (stepId+toolName), WorkerTaskContract (taskId+workerType)",
    );
    return 1;
  }

  if (result.success) {
    if (json) {
      out(canonicalJson({ valid: true, contractType: typeName }));
    } else {
      out(`Valid ${typeName}`);
    }
    return 0;
  } else {
    if (json) {
      out(
        canonicalJson({
          valid: false,
          contractType: typeName,
          errors: result.error!.message,
        }),
      );
    } else {
      err(`Invalid ${typeName}:`);
      err(result.error!.message);
    }
    return 1;
  }
}

// ---------------------------------------------------------------------------
// new-run
// ---------------------------------------------------------------------------

export function cmdNewRun(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const runId = flags.get("run") ?? uuidv4();
  const actorId = flags.get("actor") ?? "cli";
  const hostId = flags.get("host") ?? hostname();
  const correlationId = flags.get("correlation") ?? undefined;

  // Parse --meta as JSON string
  let meta: Record<string, string> = {};
  const metaRaw = flags.get("meta");
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw) as Record<string, string>;
    } catch {
      err("--meta must be valid JSON object");
      return 1;
    }
  }

  if (!isUuid(runId)) {
    err(`Invalid run ID (must be UUID): ${runId}`);
    return 1;
  }

  ensureDataDirs(config);
  const store = new EventStore(config.dbPath);
  try {
    // Merge hostId and correlationId into metadata
    const runMeta: Record<string, string> = { ...meta };
    runMeta["hostId"] = hostId;
    if (correlationId) runMeta["correlationId"] = correlationId;

    const runInfo = store.createRun(runId, runMeta);

    // Emit RunStarted event
    const eventId = uuidv4();
    const payload: Record<string, unknown> = { metadata: runMeta };
    const storedEvent = store.appendEvent(runId, {
      eventId,
      type: "RunStarted",
      schemaVersion: "1.0.0",
      actor: { actorId, actorType: "human" },
      payload,
    });

    if (json) {
      out(canonicalJson({ runId, eventId: storedEvent.eventId, createdAt: runInfo.createdAt }));
    } else {
      out(`Run created: ${runId}`);
      out(`  RunStarted event: ${storedEvent.eventId}`);
      out(`  Created at:       ${runInfo.createdAt}`);
    }
    return 0;
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// append-event
// ---------------------------------------------------------------------------

export function cmdAppendEvent(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const runId = requireFlag(flags, "run");
  const eventPath = requireFlag(flags, "event");
  if (!runId || !eventPath) return 1;

  if (!isUuid(runId)) {
    err(`Invalid run ID (must be UUID): ${runId}`);
    return 1;
  }

  let draft: EventDraft;
  try {
    const raw = readJsonFile(eventPath) as Record<string, unknown>;
    // Caller must provide: eventId, type, schemaVersion, actor, payload
    // Caller must NOT provide: seq, prevHash, hash, runId (store computes these)
    if (!raw["eventId"] || !raw["type"] || !raw["schemaVersion"] || !raw["actor"] || !raw["payload"]) {
      err(
        "Event draft must contain: eventId, type, schemaVersion, actor, payload",
      );
      return 1;
    }
    draft = {
      eventId: raw["eventId"] as string,
      type: raw["type"] as string,
      schemaVersion: raw["schemaVersion"] as string,
      actor: raw["actor"] as EventDraft["actor"],
      payload: raw["payload"] as Record<string, unknown>,
      ts: raw["ts"] as string | undefined,
    };
  } catch (e: unknown) {
    err(`Failed to read event file: ${(e as Error).message}`);
    return 1;
  }

  const store = new EventStore(config.dbPath);
  try {
    const stored = store.appendEvent(runId, draft);
    if (json) {
      out(
        canonicalJson({
          eventId: stored.eventId,
          runId: stored.runId,
          seq: stored.seq,
          hash: stored.hash,
        }),
      );
    } else {
      out(`Event appended: seq=${stored.seq} hash=${stored.hash}`);
    }
    return 0;
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// list-events
// ---------------------------------------------------------------------------

export function cmdListEvents(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const runId = requireFlag(flags, "run");
  if (!runId) return 1;

  const store = new EventStore(config.dbPath);
  try {
    const events = store.listEvents(runId);
    if (events.length === 0) {
      if (!json) out(`No events found for run ${runId}`);
      else out("[]");
      return 0;
    }

    if (json) {
      out(canonicalJson(events));
    } else {
      for (const e of events) {
        out(
          `  seq=${String(e.seq).padStart(3)} type=${e.type.padEnd(20)} eventId=${e.eventId} hash=${e.hash.slice(0, 12)}…`,
        );
      }
      out(`${events.length} event(s)`);
    }
    return 0;
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// verify-run
// ---------------------------------------------------------------------------

export function cmdVerifyRun(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const runId = requireFlag(flags, "run");
  if (!runId) return 1;

  const store = new EventStore(config.dbPath);
  try {
    const result = store.verifyRunChain(runId);
    if (json) {
      out(canonicalJson(result));
    } else {
      if (result.valid) {
        out(`Run ${runId}: VALID (${result.eventCount} events)`);
      } else {
        err(`Run ${runId}: INVALID`);
        for (const f of result.failures) {
          err(
            `  seq=${f.seq} reason=${f.reason} expected=${f.expected} actual=${f.actual}`,
          );
        }
      }
    }
    return result.valid ? 0 : 1;
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// put-artifact
// ---------------------------------------------------------------------------

export function cmdPutArtifact(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const runId = requireFlag(flags, "run");
  const filePath = requireFlag(flags, "file");
  if (!runId || !filePath) return 1;

  if (!isUuid(runId)) {
    err(`Invalid run ID (must be UUID): ${runId}`);
    return 1;
  }

  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    err(`File not found: ${absPath}`);
    return 1;
  }

  const mime = flags.get("mime") ?? guessMime(absPath);
  const label = flags.get("label") ?? filePath;

  const content = readFileSync(absPath);
  const artStore = new ArtifactStore(config.artifactRoot);
  const eventStoreInst = new EventStore(config.dbPath);

  try {
    const record = artStore.putArtifact(content, mime, label);

    // Record ArtifactRecorded event
    const eventId = uuidv4();
    const stored = eventStoreInst.appendEvent(runId, {
      eventId,
      type: "ArtifactRecorded",
      schemaVersion: "1.0.0",
      actor: { actorId: "cli", actorType: "system" },
      payload: {
        artifactId: record.artifactId,
        sha256: record.sha256,
        size: record.size,
        mime: record.mime,
        label: record.label,
      },
    });

    if (json) {
      out(
        canonicalJson({
          artifactId: record.artifactId,
          sha256: record.sha256,
          size: record.size,
          eventId: stored.eventId,
          seq: stored.seq,
        }),
      );
    } else {
      out(`Artifact stored: ${record.artifactId}`);
      out(`  Size:  ${record.size} bytes`);
      out(`  Event: seq=${stored.seq} id=${stored.eventId}`);
    }
    return 0;
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  } finally {
    eventStoreInst.close();
  }
}

function guessMime(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".json": "application/json",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "text/x-typescript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".xml": "application/xml",
    ".csv": "text/csv",
    ".zip": "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// export-evidence
// ---------------------------------------------------------------------------

export async function cmdExportEvidence(
  flags: Map<string, string>,
  config: ClawforgeConfig,
): Promise<number> {
  const runId = requireFlag(flags, "run");
  const outPath = requireFlag(flags, "out");
  if (!runId || !outPath) return 1;

  const maxIncludeBytes = flags.has("max-include-bytes")
    ? parseInt(flags.get("max-include-bytes")!, 10)
    : undefined;
  const includeArtifacts = flags.has("no-artifacts") ? false : true;

  if (maxIncludeBytes !== undefined && (isNaN(maxIncludeBytes) || maxIncludeBytes < 0)) {
    err("--max-include-bytes must be a non-negative integer");
    return 1;
  }

  const eventStoreInst = new EventStore(config.dbPath);
  const artStore = new ArtifactStore(config.artifactRoot);

  try {
    await exportEvidenceBundle(runId, resolve(outPath), eventStoreInst, artStore, {
      maxIncludeBytes,
      includeArtifacts,
    });
    out(`Evidence bundle exported: ${outPath}`);
    return 0;
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  } finally {
    eventStoreInst.close();
  }
}

// ---------------------------------------------------------------------------
// governance validate
// ---------------------------------------------------------------------------

import { validateSession, listPacks, loadPack } from "../governance/pack-validator.js";
import { join } from "node:path";

export async function cmdGovernanceValidate(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): Promise<number> {
  const sessionId = requireFlag(flags, "session");
  const packName = flags.get("pack");
  
  if (!sessionId) {
    err("missing required flag: --session");
    return 1;
  }
  
  const sessionPath = join(config.sessionDir, sessionId);
  
  try {
    let results;
    
    if (packName) {
      // Validate against specific pack
      const packPath = resolve("governance/packs", `${packName}.yml`);
      const { validateSessionAgainstPack } = await import("../governance/pack-validator.js");
      results = [await validateSessionAgainstPack(sessionPath, packPath)];
    } else {
      // Validate against all packs
      results = await validateSession(sessionPath);
    }
    
    if (json) {
      out(JSON.stringify(results, null, 2));
    } else {
      // Human-readable output
      for (const result of results) {
        out(`\n=== ${result.packId} (v${result.packVersion}) ====`);
        out(`Session: ${result.sessionId}`);
        out(`Status: ${result.passed ? "✅ PASSED" : "❌ FAILED"}`);
        out(`Summary: ${result.summary.passed}/${result.summary.total} expectations passed`);
        
        for (const r of result.results) {
          const icon = r.passed ? "✓" : "✗";
          const label = r.importance === "expected" ? "[EXPECTED]" : "[RECOMMENDED]";
          out(`  ${icon} ${label} ${r.id}`);
          if (r.reason && !r.passed) {
            out(`      → ${r.reason}`);
          }
        }
      }
    }
    
    return results.every(r => r.passed) ? 0 : 1;
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  }
}
