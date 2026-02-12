#!/usr/bin/env node
/**
 * clforge-verify — Independent Sealed Change Package Verifier
 *
 * Phase Q: Standalone CLI tool for verifying Sealed Change Packages
 * without session management dependencies.
 *
 * Usage:
 *   clforge-verify <session-dir>
 *
 * Exit codes:
 *   0 = PASS (all checks passed)
 *   3 = FAIL (any check failed)
 */

import { resolve } from "node:path";
import { verifySealedChangePackage } from "./verify.js";
import { canonicalJson } from "../audit/canonical.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  sessionDir: string | null;
  help: boolean;
} {
  let sessionDir: string | null = null;
  let help = false;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (!arg.startsWith("-")) {
      if (sessionDir === null) {
        sessionDir = arg;
      }
    }
  }

  return { sessionDir, help };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv);

  if (args.help || args.sessionDir === null) {
    console.error("Usage: clforge-verify <session-dir>");
    console.error("");
    console.error("Verifies a Sealed Change Package in the specified session directory.");
    console.error("");
    console.error("Exit codes:");
    console.error("  0 = PASS (all checks passed)");
    console.error("  3 = FAIL (any check failed)");
    process.exit(1);
  }

  const sessionDir = resolve(args.sessionDir);

  try {
    const report = verifySealedChangePackage(sessionDir);

    // Output canonical JSON report
    const output = canonicalJson(report);
    console.log(output);

    // Exit with appropriate code
    process.exit(report.passed ? 0 : 3);
  } catch (error) {
    // Unexpected error (not a validation failure)
    console.error(`Error: ${String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if executed directly (check if this file is being run as main module)
if (process.argv[1] && import.meta.url.includes(process.argv[1].replace(/\\/g, "/"))) {
  main();
}

export { main };
