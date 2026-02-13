# Changelog

All notable changes to ClawForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-02-13

### Added
- **Governance Packs** - Executable validation against governance expectations
  - `clawctl governance validate --session <id>` command
  - `change-shipping` pack (9 expectations)
  - `incident-postmortem` pack (11 expectations)
- **Integration Examples**
  - `examples/github-actions/` - GitHub Actions CI/CD audit
  - `examples/webhook/` - Webhook → ClawForge event bridge
  - `examples/dogfood/` - ClawForge audits itself
  - `examples/claude-code/` - Claude Code / Cursor integration
- **Security Documentation**
  - `docs/SECURITY_IMPLEMENTATION.md` - Threat → implementation mapping
  - Test coverage disclosure per threat
- **Performance Documentation**
  - `docs/PERFORMANCE_BENCHMARKS.md` - Benchmarked performance metrics
  - Event throughput: 2,500/sec
  - Safe limit: 100,000 events/run
- **Extension Registry** - TypeScript validator for protocol extensions

### Changed
- README updated with production-ready tagline and performance badges
- Governance packs header updated (no longer "not executable")

### Production Ready
This release marks ClawForge as production-ready for:
- CI/CD audit trails
- AI IDE session recording
- Custom workflow audit
- Internal tooling

Known limitations (documented):
- No multi-tenant isolation
- No external security audit yet
- No SOC2/ISO27001 certification

## [0.1.1] — 2026-02-10

### Added
- Stability contract (`docs/stability.md`)
- This changelog
- GitHub Actions CI: `kernel-proof` job (build, test, tarball install, walkthrough)
- GitHub Actions CI: `kernel-integrity-failure` job (tamper detection proof)

### Changed
- Nothing. Runtime behavior is identical to 0.1.0.

## [0.1.0] — 2026-02-10

### Added
- Contract schemas: `IntentContract`, `StepContract`, `WorkerTaskContract`
- Zod validation with forward compatibility (`.passthrough()`, schema version checks)
- Canonical JSON serialization (deterministic key ordering, no `undefined`, UTC dates)
- SHA-256 hashing utilities and event hash computation
- Schema version migration registry with `IntentContract 1.0.0 → 1.1.0` example
- Secret redaction helper (`redactSensitive`)
- SQLite-backed append-only audit event store with hash chain integrity
- Content-addressable artifact store (filesystem, SHA-256, atomic writes)
- Evidence bundle export (zip with run metadata, events, schemas, artifacts, chain proof)
- `clawctl` CLI with 9 commands: `init`, `config show`, `validate-contract`, `new-run`,
  `append-event`, `list-events`, `verify-run`, `put-artifact`, `export-evidence`
- Documentation: `contracts.md`, `audit.md`, `architecture.md`, `threat-model.md`, `cli.md`
- 200 tests across 7 test files
- Reference examples (`examples/`)
