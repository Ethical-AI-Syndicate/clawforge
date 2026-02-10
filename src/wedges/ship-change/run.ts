#!/usr/bin/env node
/**
 * Wedge: Ship a Change
 *
 * Orchestrates a complete "ship a change" workflow using the ClawForge kernel.
 * No business logic — only sequencing of kernel API calls.
 *
 * Usage:
 *   node dist/wedges/ship-change/run.js \
 *     --intent <intent-contract.json> \
 *     --artifact <file> [--artifact <file> ...] \
 *     --out <evidence.zip> \
 *     [--actor <id>] [--host <id>] [--correlation <id>]
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, extname } from "node:path";
import { hostname } from "node:os";
import { v4 as uuidv4 } from "uuid";

import { EventStore } from "../../audit/store.js";
import { ArtifactStore } from "../../storage/artifact-store.js";
import { exportEvidenceBundle } from "../../evidence/export.js";
import { IntentContractSchema } from "../../contracts/schemas.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface Args {
  intentPath: string;
  artifactPaths: string[];
  outPath: string;
  actorId: string;
  hostId: string;
  correlationId?: string;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  let intentPath = "";
  const artifactPaths: string[] = [];
  let outPath = "";
  let actorId = "operator";
  let hostId = hostname();
  let correlationId: string | undefined;

  let i = 0;
  while (i < args.length) {
    const flag = args[i]!;
    const val = args[i + 1];
    switch (flag) {
      case "--intent":
        intentPath = val ?? "";
        i += 2;
        break;
      case "--artifact":
        if (val) artifactPaths.push(val);
        i += 2;
        break;
      case "--out":
        outPath = val ?? "";
        i += 2;
        break;
      case "--actor":
        actorId = val ?? actorId;
        i += 2;
        break;
      case "--host":
        hostId = val ?? hostId;
        i += 2;
        break;
      case "--correlation":
        correlationId = val;
        i += 2;
        break;
      default:
        fatal(`Unknown flag: ${flag}`);
    }
  }

  if (!intentPath) fatal("--intent <path> is required");
  if (artifactPaths.length === 0) fatal("At least one --artifact <path> is required");
  if (!outPath) fatal("--out <path> is required");

  return { intentPath, artifactPaths, outPath, actorId, hostId, correlationId };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function log(msg: string): void {
  process.stdout.write(msg + "\n");
}

const MIME_MAP: Record<string, string> = {
  ".json": "application/json",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".html": "text/html",
  ".js": "application/javascript",
  ".ts": "text/x-typescript",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".xml": "application/xml",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
  ".sh": "text/x-shellscript",
  ".log": "text/plain",
};

function guessMime(path: string): string {
  return MIME_MAP[extname(path).toLowerCase()] ?? "application/octet-stream";
}

// ---------------------------------------------------------------------------
// Config (same env vars as clawctl)
// ---------------------------------------------------------------------------

function resolveDbPath(): string {
  return resolve(
    process.env["CLAWFORGE_DB_PATH"] ??
      `${process.env["HOME"]}/.clawforge/db.sqlite`,
  );
}

function resolveArtifactRoot(): string {
  return resolve(
    process.env["CLAWFORGE_ARTIFACT_ROOT"] ??
      `${process.env["HOME"]}/.clawforge/artifacts`,
  );
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  // --- 0. Validate inputs ---------------------------------------------------

  const intentAbsPath = resolve(args.intentPath);
  if (!existsSync(intentAbsPath)) fatal(`Intent file not found: ${intentAbsPath}`);

  for (const p of args.artifactPaths) {
    const abs = resolve(p);
    if (!existsSync(abs)) fatal(`Artifact file not found: ${abs}`);
  }

  // Parse and validate the IntentContract
  const intentRaw = JSON.parse(readFileSync(intentAbsPath, "utf8")) as Record<string, unknown>;
  const intentResult = IntentContractSchema.safeParse(intentRaw);
  if (!intentResult.success) {
    fatal(`Invalid IntentContract:\n${(intentResult as { error: { message: string } }).error.message}`);
  }
  const intent = intentResult.data;

  log("Ship a Change — ClawForge Wedge");
  log("================================");
  log(`Intent:  ${intent.title}`);
  log(`Actor:   ${args.actorId}`);
  log(`Host:    ${args.hostId}`);
  log(`Files:   ${args.artifactPaths.length} artifact(s)`);
  log("");

  // --- 1. Open kernel stores -------------------------------------------------

  const dbPath = resolveDbPath();
  const artifactRoot = resolveArtifactRoot();
  const eventStore = new EventStore(dbPath);
  const artifactStore = new ArtifactStore(artifactRoot);

  try {
    const runId = uuidv4();
    const actor = { actorId: args.actorId, actorType: "human" as const };

    // --- 2. Create run + RunStarted ------------------------------------------

    const meta: Record<string, string> = { hostId: args.hostId };
    if (args.correlationId) meta["correlationId"] = args.correlationId;

    eventStore.createRun(runId, meta);

    eventStore.appendEvent(runId, {
      eventId: uuidv4(),
      type: "RunStarted",
      schemaVersion: "1.0.0",
      actor,
      payload: { metadata: meta },
    });
    log(`[1/5] Run created: ${runId}`);

    // --- 3. ContractRecorded -------------------------------------------------

    eventStore.appendEvent(runId, {
      eventId: uuidv4(),
      type: "ContractRecorded",
      schemaVersion: "1.0.0",
      actor,
      payload: {
        contractType: "IntentContract",
        contract: intent,
      },
    });
    log(`[2/5] IntentContract recorded: ${intent.intentId}`);

    // --- 4. Attach artifacts -------------------------------------------------

    let artifactCount = 0;
    for (const filePath of args.artifactPaths) {
      const absPath = resolve(filePath);
      const content = readFileSync(absPath);
      const mime = guessMime(absPath);
      const label = basename(absPath);

      const record = artifactStore.putArtifact(content, mime, label);

      eventStore.appendEvent(runId, {
        eventId: uuidv4(),
        type: "ArtifactRecorded",
        schemaVersion: "1.0.0",
        actor: { actorId: args.actorId, actorType: "system" },
        payload: {
          artifactId: record.artifactId,
          sha256: record.sha256,
          size: record.size,
          mime: record.mime,
          label: record.label,
        },
      });
      artifactCount++;
      log(`[3/5] Artifact ${artifactCount}/${args.artifactPaths.length}: ${label} (${record.size} bytes, ${record.sha256.slice(0, 12)}…)`);
    }

    // --- 5. RunCompleted (change shipped) ------------------------------------

    eventStore.appendEvent(runId, {
      eventId: uuidv4(),
      type: "RunCompleted",
      schemaVersion: "1.0.0",
      actor,
      payload: {
        summary: `Change shipped: ${intent.title}. ${artifactCount} artifact(s) attached.`,
      },
    });
    log(`[4/5] Run completed (change shipped)`);

    // --- 6. Export evidence bundle -------------------------------------------

    const outAbsPath = resolve(args.outPath);
    await exportEvidenceBundle(runId, outAbsPath, eventStore, artifactStore);

    // --- 7. Summary ----------------------------------------------------------

    const events = eventStore.listEvents(runId);
    const verification = eventStore.verifyRunChain(runId);

    log(`[5/5] Evidence bundle exported: ${args.outPath}`);
    log("");
    log("Summary");
    log("-------");
    log(`  Run ID:      ${runId}`);
    log(`  Events:      ${events.length}`);
    log(`  Artifacts:   ${artifactCount}`);
    log(`  Chain:       ${verification.valid ? "VALID" : "INVALID"}`);
    log(`  Evidence:    ${args.outPath}`);
    log("");
    log(`Verify independently: pnpm clawctl verify-run --run ${runId}`);

  } finally {
    eventStore.close();
  }
}

main().catch((e: unknown) => {
  process.stderr.write(`Fatal: ${(e as Error).message}\n`);
  process.exit(2);
});
