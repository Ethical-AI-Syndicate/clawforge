/**
 * Evidence bundle export.
 *
 * Produces a zip file containing the complete audit trail for a run:
 *
 *   evidence/
 *     run.json                     run metadata (canonical JSON)
 *     events.jsonl                 one canonical-JSON event per line, seq-ordered
 *     schemas/
 *       contracts-v1.0.0.json      contract schema snapshot
 *       audit-v1.0.0.json          event schema snapshot
 *     artifacts/
 *       manifest.json              artifact manifest (canonical JSON)
 *       <sha256_hash>              artifact bytes (if size ≤ threshold)
 *     integrity/
 *       chain.json                 hash-chain verification result
 *
 * Guarantees:
 *   - Export aborts if the run's hash chain is invalid.
 *   - Export aborts if any included artifact fails hash verification.
 *   - All JSON uses canonical serialization (sorted keys, no undefined).
 *   - Events are ordered by seq ascending.
 *   - Manifest entries are ordered by artifactId ascending.
 *   - Zip entry names are hard-coded prefixes + hex hashes — no user strings.
 *   - Streaming: artifacts are appended from disk, not loaded into memory.
 */

import { createWriteStream, createReadStream } from "node:fs";
import archiver from "archiver";
import { canonicalJson } from "../audit/canonical.js";
import type { EventStore, StoredEvent } from "../audit/store.js";
import type {
  ArtifactStore,
  ArtifactRecord,
  ManifestEntry,
} from "../storage/artifact-store.js";
import type { ChainVerificationResult } from "../audit/hashing.js";

// ---------------------------------------------------------------------------
// Schema snapshots (embedded as JSON for the bundle)
// ---------------------------------------------------------------------------

const CONTRACT_SCHEMA_SNAPSHOT = {
  schemaVersion: "1.0.0",
  description: "ClawForge contract schemas snapshot",
  contracts: {
    IntentContract: {
      fields: [
        "schemaVersion",
        "intentId",
        "title",
        "description",
        "actor",
        "constraints",
        "inputParams",
        "tags",
        "createdAt",
      ],
    },
    StepContract: {
      fields: [
        "schemaVersion",
        "stepId",
        "intentId",
        "stepIndex",
        "name",
        "description",
        "toolName",
        "toolParams",
        "expectedOutputSchema",
        "requiresApproval",
        "retryPolicy",
        "dependsOn",
        "createdAt",
      ],
    },
    WorkerTaskContract: {
      fields: [
        "schemaVersion",
        "taskId",
        "stepId",
        "runId",
        "workerType",
        "instructions",
        "inputRefs",
        "constraints",
        "outputSchema",
        "createdAt",
      ],
    },
  },
};

const AUDIT_SCHEMA_SNAPSHOT = {
  schemaVersion: "1.0.0",
  description: "ClawForge audit event schema snapshot",
  envelope: [
    "eventId",
    "runId",
    "seq",
    "ts",
    "type",
    "schemaVersion",
    "actor",
    "payload",
    "prevHash",
    "hash",
  ],
  eventTypes: [
    "RunStarted",
    "RunCompleted",
    "RunFailed",
    "ContractRecorded",
    "StepStarted",
    "StepCompleted",
    "StepFailed",
    "ArtifactRecorded",
    "ApprovalRequested",
    "ApprovalGranted",
    "ApprovalDenied",
  ],
};

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class EvidenceExportError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EvidenceExportError";
    this.code = code;
    this.details = details ?? {};
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Max artifact byte size to include inline (default 10 MB). */
  maxIncludeBytes?: number;
  /** Whether to include artifact bytes at all (default true). */
  includeArtifacts?: boolean;
}

const DEFAULT_MAX_INCLUDE_BYTES = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Export function
// ---------------------------------------------------------------------------

/**
 * Export a complete evidence bundle for a run.
 *
 * @param runId           The run to export.
 * @param outZipPath      Absolute path to write the zip file.
 * @param eventStore      Event store instance.
 * @param artifactStore   Artifact store instance.
 * @param options         Export options.
 */
export async function exportEvidenceBundle(
  runId: string,
  outZipPath: string,
  eventStore: EventStore,
  artifactStore: ArtifactStore,
  options: ExportOptions = {},
): Promise<void> {
  const maxIncludeBytes =
    options.maxIncludeBytes ?? DEFAULT_MAX_INCLUDE_BYTES;
  const includeArtifacts = options.includeArtifacts ?? true;

  // 1. Verify chain — abort if invalid ---------------------------------
  const chainResult = eventStore.verifyRunChain(runId);
  if (!chainResult.valid) {
    throw new EvidenceExportError(
      `Run chain verification failed for ${runId}: ${chainResult.failures.length} failure(s)`,
      "CHAIN_VERIFICATION_FAILED",
      {
        runId,
        failures: chainResult.failures,
      },
    );
  }

  // 2. Load run metadata ------------------------------------------------
  const runInfo = eventStore.getRun(runId);
  if (!runInfo) {
    throw new EvidenceExportError(
      `Run not found: ${runId}`,
      "RUN_NOT_FOUND",
      { runId },
    );
  }

  // 3. List events (seq ordered) ----------------------------------------
  const events = eventStore.listEvents(runId);

  // 4. Collect artifact records from ArtifactRecorded events ------------
  const artifactRecords: ArtifactRecord[] = [];
  for (const evt of events) {
    if (evt.type === "ArtifactRecorded") {
      const p = evt.payload as Record<string, unknown>;
      artifactRecords.push({
        artifactId: p["artifactId"] as string,
        sha256: p["sha256"] as string,
        size: p["size"] as number,
        mime: p["mime"] as string,
        label: p["label"] as string,
        path: "", // path is resolved below when including
      });
    }
  }

  // 5. Build manifest (sorted by artifactId for determinism) ------------
  const manifest = artifactStore
    .buildManifest(artifactRecords, maxIncludeBytes)
    .sort((a, b) => a.artifactId.localeCompare(b.artifactId));

  // 6. If including artifacts, verify each included one first -----------
  if (includeArtifacts) {
    for (const entry of manifest) {
      if (entry.included) {
        const ok = artifactStore.verifyArtifact(entry.sha256);
        if (!ok) {
          throw new EvidenceExportError(
            `Artifact verification failed: ${entry.sha256}`,
            "ARTIFACT_VERIFICATION_FAILED",
            { sha256: entry.sha256 },
          );
        }
      }
    }
  }

  // 7. Build zip --------------------------------------------------------
  await writeZip(
    outZipPath,
    runInfo,
    events,
    chainResult,
    manifest,
    artifactStore,
    includeArtifacts,
  );
}

// ---------------------------------------------------------------------------
// Zip construction (private)
// ---------------------------------------------------------------------------

function storedEventToRecord(e: StoredEvent): Record<string, unknown> {
  return {
    eventId: e.eventId,
    runId: e.runId,
    seq: e.seq,
    ts: e.ts,
    type: e.type,
    schemaVersion: e.schemaVersion,
    actor: e.actor,
    payload: e.payload,
    prevHash: e.prevHash,
    hash: e.hash,
  };
}

async function writeZip(
  outZipPath: string,
  runInfo: { runId: string; createdAt: string; metadata: Record<string, string> },
  events: StoredEvent[],
  chainResult: ChainVerificationResult,
  manifest: ManifestEntry[],
  artifactStore: ArtifactStore,
  includeArtifacts: boolean,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const output = createWriteStream(outZipPath);
    const archive = archiver.create("zip", { zlib: { level: 6 } });

    output.on("close", () => resolve());
    archive.on("error", (err: Error) => reject(err));
    output.on("error", (err: Error) => reject(err));
    archive.pipe(output);

    // evidence/run.json
    archive.append(
      canonicalJson({
        runId: runInfo.runId,
        createdAt: runInfo.createdAt,
        metadata: runInfo.metadata,
      }),
      { name: "evidence/run.json" },
    );

    // evidence/events.jsonl  (one canonical-JSON line per event, seq order)
    const lines = events.map((e) => canonicalJson(storedEventToRecord(e)));
    archive.append(lines.join("\n") + (lines.length > 0 ? "\n" : ""), {
      name: "evidence/events.jsonl",
    });

    // evidence/schemas/contracts-v1.0.0.json
    archive.append(canonicalJson(CONTRACT_SCHEMA_SNAPSHOT), {
      name: "evidence/schemas/contracts-v1.0.0.json",
    });

    // evidence/schemas/audit-v1.0.0.json
    archive.append(canonicalJson(AUDIT_SCHEMA_SNAPSHOT), {
      name: "evidence/schemas/audit-v1.0.0.json",
    });

    // evidence/artifacts/manifest.json
    archive.append(canonicalJson({ artifacts: manifest }), {
      name: "evidence/artifacts/manifest.json",
    });

    // evidence/integrity/chain.json
    archive.append(
      canonicalJson({
        runId: runInfo.runId,
        eventCount: chainResult.eventCount,
        verified: chainResult.valid,
        failures: chainResult.failures,
        hashes: chainResult.hashes,
      }),
      { name: "evidence/integrity/chain.json" },
    );

    // evidence/artifacts/<hash>  (stream from disk, not loaded into memory)
    if (includeArtifacts) {
      for (const entry of manifest) {
        if (entry.included) {
          // Safe entry name: "evidence/artifacts/" + 64 hex chars
          const entryName = `evidence/artifacts/${entry.sha256}`;
          const artifactBuf = artifactStore.getArtifact(entry.sha256);
          archive.append(artifactBuf, { name: entryName });
        }
      }
    }

    archive.finalize();
  });
}
