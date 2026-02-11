/**
 * CLI command implementations for session management.
 *
 * Every function:
 *   - accepts parsed arguments
 *   - calls SessionManager (no business logic here)
 *   - writes to stdout / stderr
 *   - returns an exit code (0 = success, 1 = error)
 *
 * CLI must not write artifacts directly.
 * CLI must not infer missing inputs.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EventStore } from "../audit/store.js";
import { canonicalJson } from "../audit/canonical.js";
import { SessionManager } from "../session/session.js";
import type { ClawforgeConfig } from "./config.js";
import { ensureDataDirs } from "./config.js";

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
  return JSON.parse(readFileSync(abs, "utf8")) as unknown;
}

function withSessionManager(
  config: ClawforgeConfig,
  fn: (mgr: SessionManager, store: EventStore) => number,
): number {
  ensureDataDirs(config);
  const store = new EventStore(config.dbPath);
  try {
    const mgr = new SessionManager(store, config.sessionDir);
    return fn(mgr, store);
  } finally {
    store.close();
  }
}

// ---------------------------------------------------------------------------
// session create
// ---------------------------------------------------------------------------

export function cmdSessionCreate(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const title = requireFlag(flags, "title");
  if (!title) return 1;
  const description = flags.get("description") ?? "";
  const actorId = flags.get("actor") ?? "cli";
  const sessionId = flags.get("session") ?? undefined;

  return withSessionManager(config, (mgr) => {
    try {
      const record = mgr.createSession({
        sessionId,
        title,
        description,
        actor: { actorId, actorType: "human" },
      });
      if (json) {
        out(canonicalJson(record));
      } else {
        out(`Session created: ${record.sessionId}`);
        out(`  Title:           ${record.title}`);
        out(`  Exploration run: ${record.explorationRunId}`);
        out(`  Created at:      ${record.createdAt}`);
      }
      return 0;
    } catch (e: unknown) {
      err((e as Error).message);
      return 1;
    }
  });
}

// ---------------------------------------------------------------------------
// session status
// ---------------------------------------------------------------------------

export function cmdSessionStatus(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sessionId = requireFlag(flags, "session");
  if (!sessionId) return 1;

  return withSessionManager(config, (mgr) => {
    try {
      const status = mgr.getSessionStatus(sessionId);
      if (json) {
        out(canonicalJson({ sessionId, status }));
      } else {
        out(`Session ${sessionId}: ${status}`);
      }
      return 0;
    } catch (e: unknown) {
      err((e as Error).message);
      return 1;
    }
  });
}

// ---------------------------------------------------------------------------
// dod record
// ---------------------------------------------------------------------------

export function cmdDoDRecord(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sessionId = requireFlag(flags, "session");
  const filePath = requireFlag(flags, "file");
  if (!sessionId || !filePath) return 1;

  let dod: unknown;
  try {
    dod = readJsonFile(filePath);
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  }

  const actorId = flags.get("actor") ?? "cli";

  return withSessionManager(config, (mgr) => {
    try {
      const event = mgr.recordDoD(
        sessionId,
        dod as import("../session/schemas.js").DefinitionOfDone,
        { actorId, actorType: "human" },
      );
      if (json) {
        out(canonicalJson({ eventId: event.eventId, seq: event.seq, hash: event.hash }));
      } else {
        out(`DoD recorded: seq=${event.seq} hash=${event.hash}`);
      }
      return 0;
    } catch (e: unknown) {
      err((e as Error).message);
      return 1;
    }
  });
}

// ---------------------------------------------------------------------------
// lock record
// ---------------------------------------------------------------------------

export function cmdLockRecord(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sessionId = requireFlag(flags, "session");
  const filePath = requireFlag(flags, "file");
  if (!sessionId || !filePath) return 1;

  let lock: unknown;
  try {
    lock = readJsonFile(filePath);
  } catch (e: unknown) {
    err((e as Error).message);
    return 1;
  }

  const actorId = flags.get("actor") ?? "cli";

  return withSessionManager(config, (mgr) => {
    try {
      const event = mgr.recordDecisionLock(
        sessionId,
        lock as import("../session/schemas.js").DecisionLock,
        { actorId, actorType: "human" },
      );
      if (json) {
        out(canonicalJson({ eventId: event.eventId, seq: event.seq, hash: event.hash }));
      } else {
        out(`Decision Lock recorded: seq=${event.seq} hash=${event.hash}`);
      }
      return 0;
    } catch (e: unknown) {
      err((e as Error).message);
      return 1;
    }
  });
}

// ---------------------------------------------------------------------------
// lock approve
// ---------------------------------------------------------------------------

export function cmdLockApprove(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sessionId = requireFlag(flags, "session");
  const approver = requireFlag(flags, "approver");
  if (!sessionId || !approver) return 1;

  const method = flags.get("method") ?? "cli-approve";

  return withSessionManager(config, (mgr) => {
    try {
      const event = mgr.approveDecisionLock(sessionId, {
        approvedBy: approver,
        approvedAt: new Date().toISOString(),
        approvalMethod: method,
      });
      if (json) {
        out(canonicalJson({ eventId: event.eventId, seq: event.seq, hash: event.hash }));
      } else {
        out(`Decision Lock approved: seq=${event.seq} hash=${event.hash}`);
        out(`  Approved by: ${approver}`);
        out(`  Method:      ${method}`);
      }
      return 0;
    } catch (e: unknown) {
      err((e as Error).message);
      return 1;
    }
  });
}

// ---------------------------------------------------------------------------
// gate check
// ---------------------------------------------------------------------------

export function cmdGateCheck(
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sessionId = requireFlag(flags, "session");
  if (!sessionId) return 1;

  return withSessionManager(config, (mgr) => {
    try {
      const result = mgr.evaluateGate(sessionId);
      if (json) {
        out(canonicalJson(result));
      } else {
        out(`Gate evaluation: ${result.passed ? "PASSED" : "FAILED"}`);
        for (const check of result.checks) {
          const mark = check.passed ? "PASS" : "FAIL";
          out(`  [${mark}] ${check.checkId}: ${check.description}`);
          if (!check.passed && check.failureReason) {
            out(`         ${check.failureReason}`);
          }
        }
      }
      return result.passed ? 0 : 1;
    } catch (e: unknown) {
      err((e as Error).message);
      return 1;
    }
  });
}

// ---------------------------------------------------------------------------
// Dispatcher (called from cli/index.ts)
// ---------------------------------------------------------------------------

export function handleSessionCommand(
  subcommands: string[],
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sub = subcommands[0];
  switch (sub) {
    case "create":
      return cmdSessionCreate(flags, config, json);
    case "status":
      return cmdSessionStatus(flags, config, json);
    default:
      err(`Unknown session subcommand: ${sub}. Use: create, status`);
      return 1;
  }
}

export function handleDoDCommand(
  subcommands: string[],
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sub = subcommands[0];
  switch (sub) {
    case "record":
      return cmdDoDRecord(flags, config, json);
    default:
      err(`Unknown dod subcommand: ${sub}. Use: record`);
      return 1;
  }
}

export function handleLockCommand(
  subcommands: string[],
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sub = subcommands[0];
  switch (sub) {
    case "record":
      return cmdLockRecord(flags, config, json);
    case "approve":
      return cmdLockApprove(flags, config, json);
    default:
      err(`Unknown lock subcommand: ${sub}. Use: record, approve`);
      return 1;
  }
}

export function handleGateCommand(
  subcommands: string[],
  flags: Map<string, string>,
  config: ClawforgeConfig,
  json: boolean,
): number {
  const sub = subcommands[0];
  switch (sub) {
    case "check":
      return cmdGateCheck(flags, config, json);
    default:
      err(`Unknown gate subcommand: ${sub}. Use: check`);
      return 1;
  }
}
