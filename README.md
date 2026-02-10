# ClawForge

A provider-agnostic, installable execution platform that turns conversational
intent into governed, deterministic workflows invoking disposable agent workers.

ClawForge's foundation layer provides typed contracts, an append-only audit
trail, content-addressable artifact storage, and verifiable evidence export.

## Start Here: Proofs

ClawForge ships two reference wedges that prove the kernel's guarantees
using real inputs and verifiable evidence bundles:

- **[Ship a Change](src/wedges/ship-change/)** — records a planned change
  with intent, artifacts, and a hash-chained audit trail.
- **[Incident Postmortem](src/wedges/incident-postmortem/)** — records an
  unplanned failure investigation using the identical kernel semantics.

Both produce self-contained evidence bundles. See
[docs/wedges.md](docs/wedges.md) for what they prove and how they differ.

Inspect the evidence bundles to verify the claims.

## Problem Statement

Agent-based systems produce opaque, non-reproducible results. There is no
standard way to answer: *what happened, why, in what order, and can we prove
it?*

ClawForge solves this by making every workflow action a schema-validated,
hash-chained audit event. Contracts define what *should* happen. The event
store records what *did* happen. Evidence bundles let anyone verify it
independently.

## Non-Goals

- **Not a framework.** ClawForge does not manage agent lifecycles, prompt
  routing, or model selection. It governs the workflow that orchestrates them.
- **Not a UI.** The CLI is the primary interface. Higher-level UIs can be
  built on the library modules.
- **Not a distributed system.** The foundation layer is local-first: one
  SQLite database, one filesystem. Replication, clustering, and remote APIs
  are future concerns.
- **Not encryption.** Data is stored unencrypted. Confidentiality at rest is
  the operator's responsibility (see [Threat Model](docs/threat-model.md)).

## Installation

**Prerequisites:** Node.js 20+ and pnpm.

```bash
git clone <repo-url> clawforge
cd clawforge
pnpm install
pnpm build
```

Verify the installation:

```bash
pnpm clawctl --help
```

## 10-Minute Walkthrough

### 1. Initialize

Create the data directory (`~/.clawforge/`) with the SQLite database and
artifact store:

```bash
pnpm clawctl init
```

### 2. Create a Run

Every workflow execution is a *run*. Creating a run generates a UUID and
emits a `RunStarted` audit event:

```bash
pnpm clawctl new-run --json
```

Output:

```json
{"createdAt":"2026-02-09T12:00:00.000Z","eventId":"...","runId":"..."}
```

Save the `runId` for subsequent commands (or pass `--run <uuid>` to specify
your own).

### 3. Validate an IntentContract

Write a contract file:

```bash
cat > /tmp/intent.json << 'EOF'
{
  "schemaVersion": "1.0.0",
  "intentId": "550e8400-e29b-41d4-a716-446655440001",
  "title": "Summarize repository",
  "description": "Analyze and summarize the code repository structure",
  "actor": { "actorId": "user-1", "actorType": "human" },
  "constraints": { "maxSteps": 10, "timeoutMs": 300000, "providers": ["openai"] },
  "inputParams": { "repoUrl": "https://github.com/example/repo" },
  "tags": ["summarization"],
  "createdAt": "2026-02-09T00:00:00.000Z"
}
EOF
```

Validate it:

```bash
pnpm clawctl validate-contract /tmp/intent.json
# → Valid IntentContract
```

### 4. Record an Event

Record the validated contract as an audit event:

```bash
cat > /tmp/contract-event.json << 'EOF'
{
  "eventId": "660e8400-e29b-41d4-a716-446655440002",
  "type": "ContractRecorded",
  "schemaVersion": "1.0.0",
  "actor": { "actorId": "user-1", "actorType": "human" },
  "payload": {
    "contractType": "IntentContract",
    "contractId": "550e8400-e29b-41d4-a716-446655440001"
  }
}
EOF

pnpm clawctl append-event --run <runId> --event /tmp/contract-event.json
# → Event appended: seq=2 hash=a1b2c3...
```

The store computes `seq`, `prevHash`, and `hash` automatically. The caller
cannot supply these fields.

### 5. Attach an Artifact

Store a file in the content-addressable artifact store and link it to the run:

```bash
echo '{"summary":"42 modules found"}' > /tmp/summary.json

pnpm clawctl put-artifact --run <runId> --file /tmp/summary.json \
  --mime application/json --label "Repo summary"
# → Artifact stored: <sha256>
# →   Event: seq=3 id=<eventId>
```

### 6. Verify Integrity

Check that the hash chain is intact:

```bash
pnpm clawctl verify-run --run <runId>
# → Run <runId>: VALID (3 events)
```

### 7. Export Evidence

Package the complete audit trail as a portable zip:

```bash
pnpm clawctl export-evidence --run <runId> --out evidence.zip
```

The zip contains:

```
evidence/
  run.json                          # run metadata
  events.jsonl                      # ordered events (one per line)
  schemas/contracts-v1.0.0.json     # contract schema snapshot
  schemas/audit-v1.0.0.json         # event schema snapshot
  artifacts/manifest.json           # artifact index
  artifacts/<sha256>                # artifact bytes (if below size threshold)
  integrity/chain.json              # hash chain verification result
```

## Determinism Guarantees

ClawForge guarantees **semantic determinism**, not byte-identical output:

- **Canonical JSON** serialization (sorted keys, no `undefined`, UTC dates)
  ensures that identical logical content always produces identical bytes and
  therefore identical SHA-256 hashes.
- **Event hashes** are deterministic: the same event content always yields
  the same hash, regardless of when or where it is computed.
- **Hash chains** are deterministic: given the same sequence of events, the
  chain is identical.
- **Evidence bundles** contain deterministic content (canonical JSON, stable
  event ordering by `seq`, stable manifest ordering by `artifactId`).
  However, the **zip container itself is not byte-identical** across exports
  because zip metadata includes timestamps and compression may vary. The
  *contents* of corresponding entries are byte-identical.

## Trust Model

The event store is the **single source of truth**. Everything else is
untrusted:

| Component       | Trust Level | Rationale                                           |
|-----------------|-------------|-----------------------------------------------------|
| Event store     | Authority   | Append-only, hash-chained, integrity-verified       |
| Artifact store  | Verified    | Content-addressable; hashes checked against events  |
| CLI             | Untrusted   | Thin wrapper; all inputs validated by library layer  |
| Agent workers   | Untrusted   | Ephemeral, stateless; produce artifacts, not events  |
| Contracts       | Validated   | Schema-checked at creation; recorded as audit events |
| Evidence bundle | Derived     | Exported from the authority; includes verification   |

Workers never read or write the event store directly. They receive a
`WorkerTaskContract` and produce output artifacts. The workflow runtime
records all state transitions.

Hash chains provide **tamper detection**, not tamper prevention. An attacker
with direct SQLite write access could recalculate the chain. For stronger
guarantees, publish periodic hash snapshots to an external append-only store.
See [Threat Model](docs/threat-model.md) for full analysis.

## Project Structure

```
src/
  contracts/    Schema validation, migration, redaction
  audit/        Event model, canonical JSON, hashing, SQLite store
  storage/      Content-addressable artifact store
  evidence/     Evidence bundle export (zip)
  cli/          CLI entry point and commands
docs/
  contracts.md    Contract schema specification
  audit.md        Audit event model specification
  architecture.md Module boundaries and design decisions
  threat-model.md Security analysis and mitigations
  cli.md          CLI reference and usage guide
tests/
  contracts.test.ts       Schema validation tests (68 tests)
  canonical.test.ts       Canonical JSON tests (15 tests)
  hashing.test.ts         Hashing and chain verification tests (24 tests)
  store.test.ts           SQLite event store tests (25 tests)
  artifact-store.test.ts  Artifact store tests (25 tests)
  evidence-export.test.ts Evidence bundle export tests (15 tests)
  cli.test.ts             CLI smoke tests (28 tests)
```

## Commands

| Command                | Description                              |
|------------------------|------------------------------------------|
| `clawctl init`         | Initialize data directory and database   |
| `clawctl config show`  | Show resolved configuration              |
| `clawctl validate-contract <file>` | Validate a contract JSON file |
| `clawctl new-run`      | Create a run and emit RunStarted event   |
| `clawctl append-event` | Append an event from a JSON file         |
| `clawctl list-events`  | List events for a run                    |
| `clawctl verify-run`   | Verify hash chain integrity              |
| `clawctl put-artifact` | Store artifact and record audit event    |
| `clawctl export-evidence` | Export evidence bundle as zip         |

See [docs/cli.md](docs/cli.md) for full reference.

## Configuration

| Setting         | Default                   | Environment Variable      |
|-----------------|---------------------------|---------------------------|
| SQLite database | `~/.clawforge/db.sqlite`  | `CLAWFORGE_DB_PATH`       |
| Artifact root   | `~/.clawforge/artifacts/` | `CLAWFORGE_ARTIFACT_ROOT` |

## Development

```bash
pnpm test          # run all tests
pnpm build         # compile TypeScript
pnpm clawctl       # run CLI (after build)
```

## Documentation

- [Contract Schemas](docs/contracts.md) — IntentContract, StepContract, WorkerTaskContract
- [Audit Event Model](docs/audit.md) — event envelope, hash chain, SQLite schema, evidence bundle
- [Architecture](docs/architecture.md) — module boundaries, data flow, dependencies
- [Threat Model](docs/threat-model.md) — assets, mitigations, residual risks
- [CLI Reference](docs/cli.md) — commands, flags, exit codes, error codes
- [Reference Wedges](docs/wedges.md) — proof workflows and what they demonstrate
- [Stability Contract](docs/stability.md) — versioning policy and compatibility guarantees
- [Changelog](CHANGELOG.md) — release history

## License

Proprietary. All rights reserved.
