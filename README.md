# ClawForge

[![License](https://img.shields.io/badge/license-Proprietary%20All%20Rights%20Reserved-blue.svg)](LICENSE)
[![CI/CD](https://img.shields.io/badge/CI%2FCD-Passing-brightgreen.svg)]()
[![Tests](https://img.shields.io/badge/tests-200%2B%20passing-brightgreen.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)

> A provider-agnostic, installable execution platform that turns conversational intent into governed, deterministic workflows invoking disposable agent workers.

## Why ClawForge?

**The Problem**: Agent-based systems produce opaque, non-reproducible results. Organizations struggle to answer: *what happened, why, in what order, and can we prove it?*

**Our Solution**: ClawForge makes every workflow action a schema-validated, hash-chained audit event. We provide:
- **Immutable Audit Trails** - Every action cryptographically chained to the previous
- **Verifiable Evidence** - Export complete, self-contained audit bundles
- **Deterministic Workflows** - Same inputs always produce identical hash chains
- **Content-Addressable Storage** - Artifact integrity guaranteed by SHA-256 hashes

## Real-World Applications

### ✅ Use Case: Incident Response at Scale
```bash
# Record an incident investigation with immutable evidence
pnpm clawctl new-run --run incident-2024-0824
pnpm clawctl validate-contract incident-postmortem.json
pnpm clawctl append-event --run incident-2024-0824 --event event.json
pnpm clawctl export-evidence --run incident-2024-0824 --out incident-evidence.zip
```
**Result**: Complete, tamper-evident incident record that can independently verify what happened.

### ✅ Use Case: Code Change Governance
```bash
# Track a production change with full audit trail
pnpm clawctl new-run --run deploy-feature-x
pnpm clawctl put-artifact --run deploy-feature-x --file rollout-plan.pdf
pnpm clawctl put-artifact --run deploy-feature-x --file approval.json
pnpm clawctl verify-run --run deploy-feature-x
```
**Result**: Every change with documented intent, approvals, and rollback capability.

### ✅ Use Case: AI Agent Coordination
ClawForge orchestrates your AI agents without managing their lifecycles:
- Define what should happen with typed contracts
- Agents produce artifacts, not audit events
- System records all state transitions deterministically

## Key Features

### 🔒 Immutable Evidence
- **Hash Chains**: Every event cryptographically linked (`event_n.hash = hash(event_n.content + event_{n-1}.hash)`)
- **Content Addressing**: Artifacts stored by SHA-256 hash, ensuring integrity
- **Self-Contained Bundles**: Export complete evidence packages with verification tools

### 🚀 Zero-Configuration
- **Local-First**: Single SQLite database, no complex infrastructure
- **Single Binary**: `pnpm clawctl` provides all functionality
- **Provider Agnostic**: Works with any agent framework, language, or model

### 📊 Enterprise Ready
- **TypeScript**: Full type safety and IntelliSense support
- **200+ Tests**: Comprehensive test coverage with deterministic guarantees
- **Compliance Ready**: Export bundles designed for regulatory review

## Quick Start

**Prerequisites**: Node.js 20+ and pnpm

```bash
# Clone and install
git clone https://github.com/Ethical-AI-Syndicate/clawforge
cd clawforge
pnpm install
pnpm build

# Initialize your workspace (creates ~/.clawforge/)
pnpm clawctl init

# Create your first workflow run
pnpm clawctl new-run --json
# Save the runId for subsequent commands
```

### Your First Governed Workflow

```bash
# 1. Define what you want to do
cat > intent.json << 'EOF'
{
  "schemaVersion": "1.0.0",
  "intentId": "demo-001",
  "title": "System upgrade validation",
  "description": "Verify system post-upgrade",
  "actor": { "actorId": "ops-team", "actorType": "team" },
  "constraints": { "maxSteps": 5, "timeoutMs": 600000 },
  "inputParams": { "system": "production-api" }
}
EOF

# 2. Validate and record
pnpm clawctl validate-contract intent.json
pnpm clawctl append-event --run <runId> --event contract-recorded.json

# 3. Add evidence artifacts
echo '{"status":"healthy","checks":10,"passed":10}' > validation-results.json
pnpm clawctl put-artifact --run <runId> --file validation-results.json \
  --mime application/json --label "Validation Results"

# 4. Verify integrity
pnpm clawctl verify-run --run <runId>
# Output: Run <runId>: VALID (3 events)

# 5. Export for compliance
pnpm clawctl export-evidence --run <runId> --out upgrade-evidence.zip
```

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Contracts     │    │   Event Store    │    │  Artifact Store │
│                 │    │                  │    │                 │
│ • Intent        │───▶│ • Append-Only    │───▶│ • Content-Addr. │
│ • Task          │    │ • Hash-Chained   │    │ • SHA-256       │
│ • Validation    │    │ • SQLite         │    │ • Immutable     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   CLI/Tools     │    │   Evidence       │    │   Agent         │
│                 │    │   Export         │    │   Workers       │
│ • clawctl       │    │ • ZIP Bundle     │    │ • Stateless     │
│ • Validation    │    │ • Verification   │    │ • Disposable    │
│ • Verification  │    │ • Portable       │    │ • Ephemeral     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## Determinism Guarantees

ClawForge provides **semantic determinism** - identical logical content produces identical hashes:

- **Canonical JSON**: Sorted keys, no `undefined`, UTC timestamps
- **Deterministic Hashes**: Same event content → same SHA-256 hash, always
- **Verifiable Chains**: Given identical events, chains are identical
- **Portable Evidence**: Bundles contain all schemas and verification tools

## Trust Model

| Component       | Trust Level | Why it Matters                              |
|-----------------|-------------|--------------------------------------------|
| Event Store     | Authority   | Append-only, hash-chained, integrity-verified |
| Artifact Store  | Verified    | Content-addressable with hash verification  |
| CLI             | Untrusted   | Thin wrapper, library validates everything   |
| Agent Workers   | Untrusted   | Ephemeral, produce artifacts only           |
| Evidence Bundle | Derived     | Exported from trusted store, self-verify    |

## Start Here: Proofs

ClawForge ships two reference wedges that prove the kernel's guarantees
using real inputs and verifiable evidence bundles:

- **[Ship a Change](src/wedges/ship-change/)** — records a planned change
  with intent, artifacts, and a hash-chained audit trail.
- **[Incident Postmortem](src/wedges/incident-postmortem/)** — records an
  unplanned failure investigation using the identical kernel semantics.

Both produce self-contained evidence bundles. See
[docs/wedges.md](docs/wedges.md) for what they prove and how they differ.

## Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `clawctl init` | Initialize workspace | `pnpm clawctl init` |
| `clawctl new-run` | Create workflow run | `pnpm clawctl new-run --run deploy-001` |
| `clawctl validate-contract` | Validate schema | `pnpm clawctl validate-contract contract.json` |
| `clawctl append-event` | Record audit event | `pnpm clawctl append-event --run <id> --event event.json` |
| `clawctl put-artifact` | Store evidence | `pnpm clawctl put-artifact --run <id> --file data.json` |
| `clawctl verify-run` | Check integrity | `pnpm clawctl verify-run --run <id>` |
| `clawctl export-evidence` | Create bundle | `pnpm clawctl export-evidence --run <id> --out audit.zip` |

## Configuration

| Setting | Default | Environment Variable |
|---------|---------|---------------------|
| Database | `~/.clawforge/db.sqlite` | `CLAWFORGE_DB_PATH` |
| Artifacts | `~/.clawforge/artifacts/` | `CLAWFORGE_ARTIFACT_ROOT` |

## Installation

```bash
git clone https://github.com/Ethical-AI-Syndicate/clawforge
cd clawforge
pnpm install
pnpm build
```

Verify the installation:

```bash
pnpm clawctl --help
```

## Documentation

- **[Contracts Schema](docs/contracts.md)** - IntentContract, StepContract, WorkerTaskContract
- **[Audit Event Model](docs/audit.md)** - Event envelope, hash chains, evidence bundles
- **[Architecture](docs/architecture.md)** - Module boundaries and design decisions
- **[Threat Model](docs/threat-model.md)** - Security analysis and mitigations
- **[CLI Reference](docs/cli.md)** - Complete command documentation
- **[Reference Wedges](docs/wedges.md)** - Proof workflows and demonstrations
- **[Stability Contract](docs/stability.md)** - Versioning and compatibility guarantees

## Development

```bash
pnpm test          # 200+ tests with full coverage
pnpm build         # Compile TypeScript
pnpm clawctl       # Run CLI commands
```

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

## What ClawForge is NOT

- ❌ **Not an Agent Framework** - We don't manage agent lifecycles or model selection
- ❌ **Not a Distributed System** - Local-first design for simplicity and reliability
- ❌ **Not a UI Platform** - CLI-primary; UI layers can be built on top
- ❌ **Not Encryption** - Data confidentiality is your responsibility (see [Threat Model](docs/threat-model.md))

## License

Proprietary. All rights reserved.

## Support & Community

- **Issues**: [GitHub Issues](https://github.com/Ethical-AI-Syndicate/clawforge/issues)
- **Documentation**: [Full Docs](docs/)
- **Ethical AI Syndicate**: [aisyndicate.io](https://aisyndicate.io)

---

**Built by Ethical AI Syndicate** - Creating transparent, governable AI systems for the enterprise.