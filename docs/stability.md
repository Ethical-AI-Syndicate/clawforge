# ClawForge Stability Contract

This document defines the versioning and stability guarantees for ClawForge
releases. It is a binding contract between the project and its consumers.

## Kernel Definition

The **kernel** is the set of modules whose behavior is governed by this
stability contract:

- Contract schemas (`IntentContract`, `StepContract`, `WorkerTaskContract`)
- Audit event model (envelope, hash chain, SQLite storage schema)
- Artifact store (content-addressable layout, hash verification)
- Evidence bundle export (zip structure, canonical JSON, chain verification)
- CLI commands (`clawctl` behavior, flags, exit codes, error codes)

## Version Policy

ClawForge follows [Semantic Versioning 2.0.0](https://semver.org/).

### 0.1.x — Patch Releases

Patch releases within the 0.1.x line guarantee:

- **NO schema changes.** Contract schemas, audit event envelope, SQLite table
  definitions, and evidence bundle structure are frozen.
- **NO CLI behavior changes.** Command names, flag names, exit codes, and
  output formats are frozen.
- **NO runtime behavior changes.** Hash computation, chain verification,
  canonical JSON serialization, and artifact storage layout are frozen.

Patch releases may include:

- Bug fixes (only if a test proves a real defect)
- Documentation updates
- Test additions
- CI/CD improvements
- Packaging fixes

### 0.2.0 — Minor Release

A minor release may introduce:

- **Additive, forward-compatible changes only.** New optional fields on
  existing schemas. New event types. New CLI commands or flags.
- **No removal or modification of existing fields, commands, or behaviors.**
- **Explicit migration documentation** for any schema additions, published
  before the release.

Consumers of 0.1.x data must be able to read 0.2.0 data by ignoring unknown
fields (forward compatibility is already built in via Zod `.passthrough()`).

### 1.0.0+ — Major Releases

A major version bump is required for:

- Removal of existing schema fields
- Changes to field types or validation rules
- Changes to hash computation or chain verification logic
- Changes to SQLite storage schema (column changes, not index additions)
- Removal or renaming of CLI commands or flags
- Changes to exit code semantics

Major releases must include:

- Migration tooling (automated where possible)
- Migration documentation with step-by-step instructions
- A transition period where both old and new formats are supported

## What This Means for Consumers

- **If you depend on 0.1.x:** Your data, scripts, and integrations will
  continue to work through all 0.1.x releases without changes.
- **If you upgrade to 0.2.x:** You may need to handle new optional fields
  but will not need to change existing code.
- **If you upgrade to 1.x:** Consult the migration guide. Automated tooling
  will be provided.

## Enforcement

- CI runs a tarball install and full walkthrough on every commit.
- CI runs integrity failure detection on every commit.
- Schema and CLI behavior changes are gated by these tests.

## Related Documentation

- [Contract Schemas](contracts.md) — field definitions and validation rules
- [Audit Event Model](audit.md) — event envelope and storage schema
- [CLI Reference](cli.md) — commands, flags, exit codes
- [Threat Model](threat-model.md) — security analysis
