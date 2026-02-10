# ClawForge Architecture

## Module Boundaries

```
src/
  contracts/              # Contract schemas, validation, redaction, migration
    schemas.ts            # Zod schemas for IntentContract, StepContract, WorkerTaskContract
    validation.ts         # Redaction helpers, schema version checks, freeform text guards
    migration.ts          # Schema version migration registry and v1.0.0->v1.1.0 logic
    index.ts              # Public API re-exports

  audit/                  # Event model, hashing, SQLite store
    canonical.ts          # Canonical JSON serialization (deterministic key ordering)
    hashing.ts            # SHA-256 hashing, event hash computation, chain verification
    store.ts              # SQLite-backed append-only event store (runs + events tables)
    index.ts              # Public API re-exports

  storage/                # Artifact storage (content-addressable filesystem)
    artifact-store.ts     # put/get artifacts by SHA-256, path traversal protection, manifest
    index.ts              # Public API re-exports

  evidence/               # Evidence bundle export
    export.ts             # Zip generation: run.json, events.jsonl, schemas, artifacts, chain.json
    index.ts              # Public API re-exports

  cli/                    # CLI entry point and commands
    index.ts              # Command parser, argument handling, dispatch
    config.ts             # Configuration resolution (defaults + env var overrides)
    commands.ts           # Command implementations (thin wrappers around library modules)
```

## Data Flow

```
User Intent
    |
    v
IntentContract (validated, recorded as ContractRecorded event)
    |
    v
StepContract[] (validated, each recorded as ContractRecorded event)
    |
    v
WorkerTaskContract[] (per step; dispatched to ephemeral workers)
    |
    v
AuditEvent stream (append-only, hash-chained, SQLite-persisted)
    |
    v
Evidence Bundle (zip export for offline verification)
```

## Key Principles

1. **State is owned by the workflow runtime.** Workers are ephemeral and stateless. They receive a WorkerTaskContract and produce output. They never read or write the event store.

2. **Append-only audit trail.** Events are never modified or deleted. The SQLite store exposes no mutation or deletion API. Hash chaining makes tampering detectable.

3. **Provider-agnostic.** No contract, event schema, or runtime component references a specific LLM vendor, model name, or API endpoint. Provider tags in constraints are opaque strings.

4. **Schema-validated everything.** Every contract and event is validated against its Zod schema before storage. Invalid data is rejected with structured error messages including the field path and constraint that failed.

5. **Content-addressable artifacts.** Artifacts are stored at `<root>/sha256/<first2chars>/<full_hash>`. Same content always resolves to the same path. No overwrite; if the file exists, the put is a no-op.

6. **Deterministic serialization.** Canonical JSON (sorted keys, no undefined, UTC dates) ensures identical content produces identical hashes regardless of insertion order or platform.

7. **Forward compatibility by default.** Validators use Zod `.passthrough()` to allow unknown fields. Schema version checks reject unsupported major versions only.

## Dependency Table

| Package          | Role                               | Selection rationale                |
| ---------------- | ---------------------------------- | ---------------------------------- |
| zod              | Runtime schema validation + types  | TypeScript-native, composable, supports passthrough and discriminated unions |
| better-sqlite3   | Local event + run persistence      | Synchronous API, fast, zero-config, single-file DB |
| uuid             | UUID v4 generation                 | RFC 4122 compliant, well-tested    |
| archiver         | Zip file creation for evidence     | Streaming, handles large files, mature |
| node:crypto      | SHA-256 hashing                    | Built-in, no external dependency   |
| node:fs          | Artifact + DB file storage         | Built-in                           |
| node:path        | Path resolution + traversal guard  | Built-in                           |

Type-only dependencies (`@types/better-sqlite3`, `@types/archiver`) are added as needed during implementation.

## Error Handling

- **Validation errors:** Include the field path, expected constraint, and received value. Surfaced as structured objects, not just strings.
- **Store errors:** Include run ID, expected vs. actual sequence number, and hash mismatch details. Typed error classes (`StoreIntegrityError`, `ArtifactStoreError`, `EvidenceExportError`) carry machine-readable error codes.
- **CLI errors:** Exit code 0 on success, 1 on user/validation error, 2 on fatal/unexpected error. Errors are printed to stderr. The `--json` flag emits structured canonical JSON to stdout. See [docs/cli.md](cli.md) for the full error taxonomy.

## Testing Strategy

- **Unit tests:** Contract schema validation (valid + each invalid case), canonical JSON (key ordering, nested objects, edge types), hashing (deterministic output, known-answer tests).
- **Integration tests:** Event store lifecycle (create run -> append events -> list -> verify chain), artifact store (put -> get -> dedup), evidence export (zip contents, chain verification inside zip).
- **Tamper tests:** Modify a stored event field, verify that `verifyRunChain` fails at the expected seq.
- **All tests** use temporary directories (`mkdtemp`) and per-test SQLite databases. No shared mutable state between tests.

## Related Documentation

- [Contract Schemas](contracts.md) — field definitions, validation rules, redaction, versioning
- [Audit Event Model](audit.md) — event envelope, hash chain, SQLite schema, evidence bundle format
- [Threat Model](threat-model.md) — assets, mitigations, residual risks, production recommendations
- [CLI Reference](cli.md) — commands, flags, exit codes, error taxonomy
