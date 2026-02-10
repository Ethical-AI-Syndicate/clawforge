# ClawForge CLI — `clawctl`

Command-line interface for the ClawForge audit & governance platform.

`clawctl` is a thin wrapper around the ClawForge library modules. It contains
no business logic — every command delegates to the same functions available to
programmatic consumers.

## Quick Start

```bash
# Build the project
pnpm build

# Initialize data directory (~/.clawforge/)
pnpm clawctl init

# Create a run (generates UUID, emits RunStarted event)
pnpm clawctl new-run --json
# → {"createdAt":"2026-02-09T...","eventId":"...","runId":"abc123..."}

# Validate a contract file
pnpm clawctl validate-contract intent.json

# Attach an artifact
pnpm clawctl put-artifact --run <runId> --file report.pdf --mime application/pdf --label "Final report"

# Append a custom event
pnpm clawctl append-event --run <runId> --event step-completed.json

# Verify hash chain integrity
pnpm clawctl verify-run --run <runId>

# Export evidence bundle
pnpm clawctl export-evidence --run <runId> --out evidence.zip
```

## Configuration

| Setting          | Default                    | Environment Variable       |
|------------------|----------------------------|----------------------------|
| SQLite database  | `~/.clawforge/db.sqlite`   | `CLAWFORGE_DB_PATH`        |
| Artifact root    | `~/.clawforge/artifacts/`  | `CLAWFORGE_ARTIFACT_ROOT`  |

View resolved configuration:

```bash
pnpm clawctl config show
pnpm clawctl config show --json
```

## Commands

### `init`

Creates the data directory, artifact root, and SQLite database (with schema).

```bash
pnpm clawctl init
```

### `config show`

Prints the resolved configuration paths.

```bash
pnpm clawctl config show          # human-readable
pnpm clawctl config show --json   # canonical JSON
```

### `validate-contract <file>`

Reads a JSON file and validates it against the appropriate contract schema.
Detects the contract type automatically:

- **IntentContract** — identified by `intentId` field
- **StepContract** — identified by `stepId` + `toolName` fields
- **WorkerTaskContract** — identified by `taskId` + `workerType` fields

```bash
pnpm clawctl validate-contract intent.json
pnpm clawctl validate-contract intent.json --json
```

Exit code `0` = valid, `1` = invalid (errors printed to stderr or JSON to stdout).

### `new-run`

Creates a new run row and emits a `RunStarted` audit event.

```bash
pnpm clawctl new-run
pnpm clawctl new-run --run <uuid>              # explicit run ID
pnpm clawctl new-run --actor operator-1         # actor ID (default: "cli")
pnpm clawctl new-run --host prod-server-02      # host ID (default: hostname)
pnpm clawctl new-run --correlation req-456      # optional correlation ID
pnpm clawctl new-run --meta '{"env":"staging"}'  # arbitrary metadata JSON
pnpm clawctl new-run --json                     # structured output
```

| Flag            | Required | Default          | Description                     |
|-----------------|----------|------------------|---------------------------------|
| `--run`         | No       | generated UUID   | Run ID                          |
| `--actor`       | No       | `"cli"`          | Actor ID for RunStarted event   |
| `--host`        | No       | `os.hostname()`  | Host ID stored in metadata      |
| `--correlation` | No       | —                | Correlation ID in metadata      |
| `--meta`        | No       | `{}`             | Additional metadata (JSON)      |
| `--json`        | No       | —                | Output as canonical JSON        |

### `append-event --run <id> --event <file>`

Appends an event to a run from a JSON file. The store computes `seq`,
`prevHash`, and `hash` — the caller must **not** supply these fields.

Required fields in the event JSON file:

```json
{
  "eventId": "uuid-v4",
  "type": "StepCompleted",
  "schemaVersion": "1.0.0",
  "actor": { "actorId": "agent-1", "actorType": "worker" },
  "payload": { "stepId": "step-1", "status": "success" }
}
```

```bash
pnpm clawctl append-event --run <runId> --event event.json
pnpm clawctl append-event --run <runId> --event event.json --json
```

### `list-events --run <id>`

Lists all events for a run, ordered by sequence number.

```bash
pnpm clawctl list-events --run <runId>
pnpm clawctl list-events --run <runId> --json
```

### `verify-run --run <id>`

Verifies the hash chain integrity for a run. Exit code `0` = valid, `1` = invalid.

```bash
pnpm clawctl verify-run --run <runId>
pnpm clawctl verify-run --run <runId> --json
```

### `put-artifact --run <id> --file <path>`

Stores a file in the content-addressable artifact store and records an
`ArtifactRecorded` audit event.

```bash
pnpm clawctl put-artifact --run <runId> --file report.pdf
pnpm clawctl put-artifact --run <runId> --file data.json --mime application/json --label "API response"
pnpm clawctl put-artifact --run <runId> --file data.json --json
```

| Flag      | Required | Default                  | Description          |
|-----------|----------|--------------------------|----------------------|
| `--run`   | Yes      | —                        | Run ID               |
| `--file`  | Yes      | —                        | Path to artifact     |
| `--mime`  | No       | guessed from extension   | MIME type            |
| `--label` | No       | file path                | Human-readable label |
| `--json`  | No       | —                        | Structured output    |

### `export-evidence --run <id> --out <zipPath>`

Exports a complete evidence bundle as a zip file. Pre-verifies hash chain
integrity and included artifact hashes before writing.

```bash
pnpm clawctl export-evidence --run <runId> --out evidence.zip
pnpm clawctl export-evidence --run <runId> --out evidence.zip --max-include-bytes 5242880
pnpm clawctl export-evidence --run <runId> --out evidence.zip --no-artifacts
```

| Flag                   | Required | Default    | Description                          |
|------------------------|----------|------------|--------------------------------------|
| `--run`                | Yes      | —          | Run ID                               |
| `--out`                | Yes      | —          | Output zip file path                 |
| `--max-include-bytes`  | No       | 10 MB      | Max artifact size to include inline  |
| `--no-artifacts`       | No       | —          | Skip including artifact bytes        |

## End-to-End Example

```bash
# 1. Initialize
pnpm clawctl init

# 2. Create a run
RUN_ID=$(pnpm clawctl new-run --json | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).runId")
echo "Run: $RUN_ID"

# 3. Validate and record an intent contract
cat > /tmp/intent.json << 'EOF'
{
  "schemaVersion": "1.0.0",
  "intentId": "550e8400-e29b-41d4-a716-446655440001",
  "title": "Summarize repository",
  "description": "Analyze and summarize the code repository structure",
  "actor": { "actorId": "user-1", "actorType": "human" },
  "constraints": { "maxSteps": 10, "timeoutMs": 300000, "providers": ["openai", "anthropic"] },
  "inputParams": { "repoUrl": "https://github.com/example/repo" },
  "tags": ["summarization", "code-analysis"],
  "createdAt": "2026-02-09T00:00:00.000Z"
}
EOF
pnpm clawctl validate-contract /tmp/intent.json

# 4. Record the contract as an event
cat > /tmp/contract-event.json << EOF
{
  "eventId": "$(uuidgen | tr '[:upper:]' '[:lower:]')",
  "type": "ContractRecorded",
  "schemaVersion": "1.0.0",
  "actor": { "actorId": "user-1", "actorType": "human" },
  "payload": { "contractType": "IntentContract", "contractId": "550e8400-e29b-41d4-a716-446655440001" }
}
EOF
pnpm clawctl append-event --run "$RUN_ID" --event /tmp/contract-event.json

# 5. Attach an artifact
echo '{"summary": "This repo contains 42 modules."}' > /tmp/summary.json
pnpm clawctl put-artifact --run "$RUN_ID" --file /tmp/summary.json --mime application/json --label "Repo summary"

# 6. Verify chain integrity
pnpm clawctl verify-run --run "$RUN_ID"

# 7. Export evidence bundle
pnpm clawctl export-evidence --run "$RUN_ID" --out /tmp/evidence.zip
unzip -l /tmp/evidence.zip
```

## Exit Codes

| Code | Meaning                                        |
|------|------------------------------------------------|
| 0    | Success                                        |
| 1    | User error (bad input, validation failure, integrity failure) |
| 2    | Fatal / unexpected error (unhandled exception) |

## Error Taxonomy

All errors are written to stderr with the prefix `error: `. When `--json` is
available and used, structured errors are written to stdout instead.

### CLI-Level Errors (exit code 1)

| Error Message Pattern                       | Command(s)               | Cause                                      |
|---------------------------------------------|--------------------------|---------------------------------------------|
| `Unknown command: <name>`                   | (any)                    | Unrecognized command name                   |
| `missing required flag: --<name>`           | append-event, list-events, verify-run, put-artifact, export-evidence | Required flag not provided |
| `Invalid run ID (must be UUID): <value>`    | new-run, append-event, put-artifact | `--run` value is not a valid UUID |
| `File not found: <path>`                    | validate-contract, put-artifact | Input file does not exist |
| `--meta must be valid JSON object`          | new-run                  | `--meta` value is not parseable JSON        |
| `--max-include-bytes must be a non-negative integer` | export-evidence | Invalid byte limit value |
| `Contract file must contain a JSON object`  | validate-contract        | File contents are not a JSON object         |
| `Cannot detect contract type...`            | validate-contract        | File missing discriminator fields           |
| `Invalid <ContractType>:`                   | validate-contract        | Schema validation failed (details follow)   |
| `Event draft must contain: eventId, type, schemaVersion, actor, payload` | append-event | Missing required fields in event JSON |
| `Failed to read event file: <detail>`       | append-event             | File unreadable or invalid JSON             |

### Library-Level Errors (exit code 1)

These originate from the library modules and are surfaced by the CLI.

#### EventStore — `StoreIntegrityError`

| Code                          | Cause                                                |
|-------------------------------|------------------------------------------------------|
| `RUN_NOT_FOUND`               | `--run` references a run ID not in the database      |
| `RUN_ALREADY_EXISTS`          | Attempted to create a run with a duplicate ID        |
| `FIRST_EVENT_NOT_RUN_STARTED` | First event in a run must have type `RunStarted`     |
| `EVENT_ID_CONFLICT`           | Attempted to append an event with a duplicate eventId|

#### ArtifactStore — `ArtifactStoreError`

| Code                | Cause                                                      |
|---------------------|------------------------------------------------------------|
| `ARTIFACT_TOO_LARGE`| Artifact exceeds the maximum size limit (default: 100 MB)  |
| `PATH_TRAVERSAL`    | Resolved artifact path escapes the artifact root directory |
| `ARTIFACT_NOT_FOUND`| Requested artifact hash not found on disk                  |
| `HASH_MISMATCH`     | Artifact bytes on disk do not match the expected hash      |
| `INVALID_HASH`      | Provided hash is not a valid 64-character hex string       |

#### EvidenceExport — `EvidenceExportError`

| Code                          | Cause                                              |
|-------------------------------|----------------------------------------------------|
| `CHAIN_VERIFICATION_FAILED`   | Run's hash chain is invalid; export aborted        |
| `RUN_NOT_FOUND`               | Run ID not found in the database                   |
| `ARTIFACT_VERIFICATION_FAILED`| Included artifact's on-disk hash does not match     |

### Fatal Errors (exit code 2)

Exit code 2 indicates an unexpected error that was not caught by normal error
handling (e.g., permission denied on the database file, out of disk space).
The error message is printed to stderr with prefix `Fatal: `.

## Design Principles

- **No business logic in CLI.** Every command calls library functions directly.
- **No interactive prompts.** Fail fast with clear messages and non-zero exit codes.
- **No new dependencies.** Uses only Node built-ins and the existing project dependencies.
- **Human-readable by default.** Add `--json` for machine-parseable canonical JSON output.
- **Strict input validation.** UUIDs are validated, files are checked for existence, JSON is parsed safely.

## Related Documentation

- [Contract Schemas](contracts.md) — field definitions and validation rules
- [Audit Event Model](audit.md) — event envelope, hash chain, SQLite schema
- [Architecture](architecture.md) — module boundaries and data flow
- [Threat Model](threat-model.md) — security analysis and mitigations
