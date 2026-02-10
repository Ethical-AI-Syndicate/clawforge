# ClawForge Audit Event Model

## Overview

Every state transition in ClawForge is recorded as an immutable **audit event**. Events are append-only, hash-chained per run, and form the authoritative record of what happened and why. For contract definitions referenced in events, see [Contract Schemas](contracts.md). For security considerations, see [Threat Model](threat-model.md).

## Run Identity

Each workflow execution is identified by a set of coordinated IDs:

| Field           | Description                                          |
| --------------- | ---------------------------------------------------- |
| `runId`         | UUID v4. Primary key for the run. Generated once at run creation. |
| `actorId`       | Identifies the human or system that initiated the run. Carried in every event's `actor` block. |
| `hostId`        | Identifies the machine or environment where the run executes. Recorded in `RunStarted` metadata. Optional in the envelope for other events. |
| `correlationId` | Optional. Links this run to an external request, ticket, or parent run. Recorded in `RunStarted` metadata. |

## Event Envelope

Every event shares a common envelope:

```
AuditEvent {
  eventId:       string            // UUID v4; globally unique
  runId:         string            // UUID v4; groups events for a single workflow run
  seq:           number            // integer >= 1; monotonically increasing per run
  ts:            string            // ISO 8601 UTC timestamp (e.g. "2026-02-09T12:00:00.000Z")
  type:          string            // event type discriminator (see taxonomy below)
  schemaVersion: string            // e.g. "1.0.0"
  actor: {
    actorId:     string            // who/what caused this event; 1..200 chars
    actorType:   "human" | "system" | "worker"
  }
  payload:       object            // typed per event type (see payload schemas below)
  prevHash:      string | null     // SHA-256 hex of previous event's hash (null for seq=1)
  hash:          string            // SHA-256 hex of this event (see computation below)
}
```

All fields are required. `prevHash` is the only nullable field.

## Event Identity & Ordering

- `eventId` is a UUID v4, globally unique across all runs.
- `runId` groups all events belonging to a single workflow execution.
- `seq` starts at 1 for the first event in a run and increments by exactly 1. No gaps. No reuse.
- `ts` is wall-clock time at event creation (ISO 8601, `Z` suffix, millisecond precision). Used for display and debugging; **`seq` is authoritative** for ordering.
- Within a run, events are totally ordered by `seq`.

## Hash Chain (Integrity)

Events form a hash chain within each run.

### Hash Computation

For a given event:

1. Create a copy of the event object.
2. Remove the `hash` and `prevHash` fields from the copy.
3. Serialize the copy to **canonical JSON** (see `docs/contracts.md` for canonical JSON rules).
4. Compute: `hash = SHA-256(canonical_json_bytes).hex()`.

The resulting hex string (64 lowercase characters) is stored as the event's `hash`.

### Chain Linking

- For `seq = 1`: set `prevHash = null`.
- For `seq = N` where `N > 1`: set `prevHash` to the `hash` of the event at `seq = N - 1` in the same run.

### Verification Algorithm

To verify the integrity of a run:

```
function verifyRunChain(events: AuditEvent[]): VerificationResult {
  // Precondition: events sorted by seq ascending
  failures = []
  for i in 0..events.length-1:
    event = events[i]

    // 1. Recompute hash
    stripped = copy(event) without { hash, prevHash }
    expectedHash = SHA256(canonicalJson(stripped))
    if event.hash != expectedHash:
      failures.push({ seq: event.seq, reason: "hash_mismatch" })

    // 2. Verify chain link
    if i == 0:
      if event.prevHash != null:
        failures.push({ seq: event.seq, reason: "first_event_prevHash_not_null" })
    else:
      if event.prevHash != events[i-1].hash:
        failures.push({ seq: event.seq, reason: "prevHash_mismatch" })

    // 3. Verify seq continuity
    expectedSeq = i + 1
    if event.seq != expectedSeq:
      failures.push({ seq: event.seq, reason: "seq_gap", expected: expectedSeq })

  return { valid: failures.length == 0, eventCount: events.length, failures }
}
```

Tamper detection is deterministic: modifying any field of any event causes a hash mismatch that propagates through the chain.

## Event Type Taxonomy

### Run Lifecycle

| Type            | Description                          |
| --------------- | ------------------------------------ |
| `RunStarted`    | A new workflow run begins            |
| `RunCompleted`  | Run finished successfully            |
| `RunFailed`     | Run terminated with an error         |

### Contract Recording

| Type               | Description                          |
| ------------------ | ------------------------------------ |
| `ContractRecorded` | A contract was validated and recorded |

### Step Lifecycle

| Type            | Description                          |
| --------------- | ------------------------------------ |
| `StepStarted`  | Step execution begins                |
| `StepCompleted`| Step finished successfully           |
| `StepFailed`   | Step terminated with an error        |

### Artifacts

| Type               | Description                          |
| ------------------ | ------------------------------------ |
| `ArtifactRecorded` | An artifact was stored and linked    |

### Approvals

| Type                | Description                          |
| ------------------- | ------------------------------------ |
| `ApprovalRequested` | Execution paused for human approval  |
| `ApprovalGranted`   | Approval granted; execution resumes  |
| `ApprovalDenied`    | Approval denied; step will not run   |

## Payload Schemas (per event type)

### RunStarted

```
{
  intentId?:      string                    // UUID; optional reference to the initiating intent
  metadata?:      Record<string, string>    // max 20 keys; each key max 200 chars; each value max 500 chars
                                            // Recommended keys: hostId, correlationId, environment
}
```

### RunCompleted

```
{
  summary?:       string                    // max 2000 chars; human-readable summary
}
```

### RunFailed

```
{
  error:          string                    // required; max 2000 chars; error description
  code?:          string                    // max 100 chars; machine-readable error code
}
```

### ContractRecorded

```
{
  contractType:   "IntentContract" | "StepContract" | "WorkerTaskContract"
  contract:       object                    // the full validated contract object
}
```

### StepStarted

```
{
  stepId:         string                    // UUID
  stepIndex:      number                    // integer >= 0
  name:           string                    // max 300 chars
}
```

### StepCompleted

```
{
  stepId:         string                    // UUID
  result?:        unknown                   // max 102400 bytes (100 KB) when serialized
}
```

### StepFailed

```
{
  stepId:         string                    // UUID
  error:          string                    // max 2000 chars
  code?:          string                    // max 100 chars
}
```

### ArtifactRecorded

```
{
  artifactId:     string                    // SHA-256 hex (64 chars); content hash
  sha256:         string                    // same as artifactId (explicit for clarity)
  size:           number                    // integer; bytes
  mime:           string                    // MIME type; max 200 chars
  label:          string                    // human-readable label; max 500 chars
}
```

### ApprovalRequested

```
{
  stepId:         string                    // UUID
  reason:         string                    // max 1000 chars; why approval is needed
}
```

### ApprovalGranted

```
{
  stepId:         string                    // UUID
  approver:       string                    // max 200 chars; who approved
}
```

### ApprovalDenied

```
{
  stepId:         string                    // UUID
  approver:       string                    // max 200 chars; who denied
  reason?:        string                    // max 1000 chars; why denied
}
```

## SQLite Storage Schema

### Tables

```sql
CREATE TABLE runs (
  run_id      TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,           -- ISO 8601 UTC
  metadata    TEXT NOT NULL DEFAULT '{}' -- JSON object
);

CREATE TABLE events (
  run_id         TEXT    NOT NULL REFERENCES runs(run_id),
  seq            INTEGER NOT NULL,
  event_id       TEXT    NOT NULL UNIQUE,
  ts             TEXT    NOT NULL,      -- ISO 8601 UTC
  type           TEXT    NOT NULL,
  schema_version TEXT    NOT NULL,
  actor_json     TEXT    NOT NULL,      -- JSON: { actorId, actorType }
  payload_json   TEXT    NOT NULL,      -- JSON: typed payload
  prev_hash      TEXT,                  -- NULL for first event in run
  hash           TEXT    NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE INDEX idx_events_run_id ON events(run_id);
CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_event_id ON events(event_id);
```

### Constraints Enforced in Application Code

1. **Sequence continuity:** `seq` for a new event must equal `max(seq) + 1` for that run (or 1 if no events exist).
2. **Chain integrity:** `prevHash` must match the `hash` of the event at `seq - 1` (or be `null` for `seq = 1`).
3. **Append-only:** No `UPDATE` or `DELETE` statements are issued against the `events` table. The store API does not expose mutation methods.
4. **Run existence:** The `run_id` must reference an existing row in `runs`.
5. **Event uniqueness:** `event_id` is unique globally (enforced by the `UNIQUE` constraint).

## Evidence Bundle

An evidence export produces a zip file with this structure:

```
evidence/
  run.json                    # { runId, createdAt, metadata }
  events.jsonl                # one canonical-JSON event per line, ordered by seq
  schemas/
    contracts-v1.0.0.json     # JSON representation of contract schemas at export time
    audit-v1.0.0.json         # JSON representation of event schemas at export time
  artifacts/
    manifest.json             # { artifacts: [{ artifactId, sha256, size, mime, label, eventSeq }] }
    <sha256_hex>/content      # actual artifact bytes (included if size <= 50 MB)
  integrity/
    chain.json                # { runId, eventCount, verified: bool, failures: [], hashes: [] }
```

**Export rules:**
- The hash chain is verified during export. If verification fails, the export aborts with an error.
- Artifacts larger than 50 MB are referenced in the manifest but not included in the zip (the manifest entry includes `included: false`).
- All JSON files in the bundle use canonical JSON serialization.
- The `events.jsonl` file preserves `hash` and `prevHash` fields for independent verification.

## Timestamps

- Format: `YYYY-MM-DDTHH:mm:ss.sssZ` (ISO 8601, UTC, millisecond precision).
- `ts` is wall-clock time. It may not be monotonic (clock adjustments happen).
- `seq` is the authoritative, monotonic ordering mechanism.
- The `createdAt` field on contracts uses the same format.

## Security Notes

- Events MUST NOT store secrets (API keys, tokens, passwords).
- Freeform fields are length-limited and treated as untrusted input.
- The `redactSensitive()` helper is available for pre-export scrubbing (see [Contract Schemas](contracts.md#redaction)).
- See [Threat Model](threat-model.md) for full threat analysis.
