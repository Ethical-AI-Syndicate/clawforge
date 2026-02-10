#!/usr/bin/env node
/**
 * clawctl — ClawForge CLI entry point.
 *
 * Usage:
 *   clawctl <command> [options]
 *
 * Commands:
 *   init                          Initialize data directory
 *   config show [--json]          Show resolved configuration
 *   validate-contract <file>      Validate a contract JSON file
 *   new-run [options]             Create a new run + RunStarted event
 *   append-event --run --event    Append an event from a JSON file
 *   list-events --run             List events for a run
 *   verify-run --run              Verify hash chain integrity
 *   put-artifact --run --file     Store an artifact and record event
 *   export-evidence --run --out   Export evidence bundle zip
 */

import { resolveConfig } from "./config.js";
import {
  cmdInit,
  cmdConfigShow,
  cmdValidateContract,
  cmdNewRun,
  cmdAppendEvent,
  cmdListEvents,
  cmdVerifyRun,
  cmdPutArtifact,
  cmdExportEvidence,
} from "./commands.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  positional: string[];
  flags: Map<string, string>;
  boolFlags: Set<string>;
} {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  const boolFlags = new Set<string>();

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(name, next);
        i += 2;
      } else {
        // Boolean flag (no value)
        boolFlags.add(name);
        flags.set(name, "true");
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }

  return { positional, flags, boolFlags };
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

const USAGE = `clawctl — ClawForge CLI

Usage:
  clawctl init
  clawctl config show [--json]
  clawctl validate-contract <file> [--json]
  clawctl new-run [--run <id>] [--actor <id>] [--host <h>] [--correlation <id>] [--meta <json>] [--json]
  clawctl append-event --run <id> --event <file> [--json]
  clawctl list-events --run <id> [--json]
  clawctl verify-run --run <id> [--json]
  clawctl put-artifact --run <id> --file <path> [--mime <type>] [--label <text>] [--json]
  clawctl export-evidence --run <id> --out <zipPath> [--max-include-bytes <n>] [--no-artifacts]

Environment:
  CLAWFORGE_DB_PATH        Override SQLite database path
  CLAWFORGE_ARTIFACT_ROOT  Override artifact storage root
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const raw = process.argv.slice(2);
  if (raw.length === 0) {
    process.stderr.write(USAGE);
    return 1;
  }

  const { positional, flags, boolFlags } = parseArgs(raw);
  const json = boolFlags.has("json");
  const config = resolveConfig();

  // Handle help flags before command dispatch
  if (boolFlags.has("help") || boolFlags.has("h") || positional[0] === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  const command = positional[0];

  switch (command) {
    case "init":
      return cmdInit(config);

    case "config":
      if (positional[1] === "show") {
        return cmdConfigShow(config, json);
      }
      process.stderr.write("Unknown config subcommand. Use: config show\n");
      return 1;

    case "validate-contract": {
      const file = positional[1];
      if (!file) {
        process.stderr.write("Usage: clawctl validate-contract <file>\n");
        return 1;
      }
      return cmdValidateContract(file, json);
    }

    case "new-run":
      return cmdNewRun(flags, config, json);

    case "append-event":
      return cmdAppendEvent(flags, config, json);

    case "list-events":
      return cmdListEvents(flags, config, json);

    case "verify-run":
      return cmdVerifyRun(flags, config, json);

    case "put-artifact":
      return cmdPutArtifact(flags, config, json);

    case "export-evidence":
      return cmdExportEvidence(flags, config);

    default:
      process.stderr.write(`Unknown command: ${command}\n\n${USAGE}`);
      return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    process.stderr.write(`Fatal: ${(e as Error).message}\n`);
    process.exit(2);
  },
);
