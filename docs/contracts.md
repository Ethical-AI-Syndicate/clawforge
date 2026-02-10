# ClawForge Contract Schemas

## Overview

ClawForge uses typed, validated **contracts** to transform conversational intent into governed deterministic workflows. Every contract is schema-validated at creation, recorded as an audit event (see [Audit Event Model](audit.md)), and versioned for forward compatibility.

Contracts are provider-agnostic. No contract references a specific LLM, vendor, or runtime. For the module layout and dependency rationale, see [Architecture](architecture.md).

## Schema Versioning

- Every contract carries a `schemaVersion` field (semver string, e.g. `"1.0.0"`).
- **Additive changes** (new optional fields) bump the minor version.
- **Breaking changes** (field removal, type change, semantic change) bump the major version.
- Consumers MUST ignore unknown fields (forward compatibility).
- Consumers MUST reject schemas with a major version they do not support.
- Patch versions are reserved for documentation-only changes that do not affect the schema shape.

### Migration Rules

| From    | To      | Strategy                                         |
| ------- | ------- | ------------------------------------------------ |
| 1.0.0   | 1.1.0   | Add new optional fields with defaults            |
| 1.x     | 2.0.0   | Full migration function required; old + new both stored in transition period |

A migration registry maps `(contractType, fromVersion, toVersion) -> migrateFn`. Migrations are pure functions: `(oldDoc) => newDoc`.

#### Concrete Example: IntentContract 1.0.0 -> 1.1.0

Version 1.1.0 adds an optional `priority` field to IntentContract:

```
// v1.1.0 addition
priority?: "low" | "normal" | "high" | "critical"   // default: "normal"
```

Migration function:

```
function migrate_IntentContract_1_0_0_to_1_1_0(doc) {
  return { ...doc, schemaVersion: "1.1.0", priority: doc.priority ?? "normal" };
}
```

Rules:
- A v1.1.0 reader receiving a v1.0.0 document applies the migration before processing.
- A v1.0.0 reader receiving a v1.1.0 document ignores the unknown `priority` field.
- No data loss in either direction.

## Canonical JSON

All contracts are serialized using **canonical JSON** before hashing or storage:

1. Keys sorted lexicographically (recursive, at every nesting level).
2. No `undefined` values (omitted entirely; never serialized as `null`).
3. No trailing commas, no comments.
4. Dates serialized as ISO 8601 strings with UTC timezone (`Z` suffix).
5. Numbers serialized per JSON spec (no `NaN`, no `Infinity`).
6. Strings are UTF-8; no BOM.
7. `null` is preserved as `null`.
8. Arrays preserve element order.
9. The output of `canonicalJson(x)` is deterministic: given the same logical input, it always produces byte-identical output.

## Contract Definitions

### 1. IntentContract

Captures the high-level user intent that initiates a workflow run.

```
IntentContract {
  schemaVersion: string            // "1.0.0"
  intentId:      string            // UUID v4
  title:         string            // 1..500 chars; human-readable summary
  description:   string            // 0..5000 chars; detailed intent; UNTRUSTED
  actor: {
    actorId:     string            // 1..200 chars; UUID or external ID
    actorType:   "human" | "system"
  }
  constraints: {
    maxSteps:    number            // integer 1..1000
    timeoutMs:   number            // integer 1..86_400_000 (24h)
    providers:   string[]          // 0..20 items; each 1..200 chars
  }
  inputParams:   Record<string, unknown>  // UNTRUSTED; max 50 keys, each key 1..200 chars
  tags:          string[]          // 0..20 items; each 1..100 chars
  createdAt:     string            // ISO 8601 UTC
}
```

**Validation rules:**
- `intentId` must be a valid UUID v4.
- `title` required, 1..500 characters.
- `description` required (may be empty string), max 5000 characters.
- `actor.actorId` required, 1..200 characters.
- `actor.actorType` must be exactly `"human"` or `"system"`.
- `constraints.maxSteps` integer, 1..1000.
- `constraints.timeoutMs` integer, 1..86400000.
- `constraints.providers` array, 0..20 items, each string 1..200 chars.
- `inputParams` max 50 keys; each key 1..200 chars. Total serialized size enforced at 102400 bytes (100 KB).
- `tags` array, 0..20 items, each string 1..100 chars.
- `createdAt` must parse as a valid ISO 8601 datetime string.

### 2. StepContract

Defines a single step within a workflow. Steps are sequenced and governed.

```
StepContract {
  schemaVersion: string            // "1.0.0"
  stepId:        string            // UUID v4
  intentId:      string            // references parent IntentContract
  stepIndex:     number            // integer 0..999; sequential within intent
  name:          string            // 1..300 chars
  description:   string            // 0..3000 chars; UNTRUSTED
  toolName:      string            // 1..200 chars; tool/capability to invoke
  toolParams:    Record<string, unknown>  // UNTRUSTED; max 50 keys
  expectedOutputSchema: object | null  // JSON Schema describing expected output; null if unspecified
  requiresApproval: boolean        // if true, runtime pauses for human approval before execution
  retryPolicy: {
    maxRetries:  number            // integer 0..10
    backoffMs:   number            // integer 100..60000
  }
  dependsOn:     string[]          // 0..50 stepId UUIDs this step depends on
  createdAt:     string            // ISO 8601 UTC
}
```

**Validation rules:**
- `stepId`, `intentId` must be valid UUID v4.
- `stepIndex` integer, 0..999.
- `name` required, 1..300 characters.
- `description` required (may be empty string), max 3000 characters.
- `toolName` required, 1..200 characters.
- `toolParams` max 50 keys. Total serialized size enforced at 102400 bytes.
- `expectedOutputSchema` must be `null` or a non-empty object.
- `requiresApproval` boolean, required.
- `retryPolicy.maxRetries` integer, 0..10.
- `retryPolicy.backoffMs` integer, 100..60000.
- `dependsOn` array of valid UUIDs, 0..50 items.
- `createdAt` must parse as a valid ISO 8601 datetime string.

### 3. WorkerTaskContract

Defines a task assigned to an ephemeral, stateless worker agent.

```
WorkerTaskContract {
  schemaVersion: string            // "1.0.0"
  taskId:        string            // UUID v4
  stepId:        string            // references parent StepContract
  runId:         string            // references parent run
  workerType:    string            // 1..200 chars; pattern [a-zA-Z0-9._-]+
  instructions:  string            // 0..10000 chars; UNTRUSTED
  inputRefs:     string[]          // 0..100 items; artifact hashes or event IDs
  constraints: {
    maxDurationMs: number          // integer 1..3_600_000 (1h)
    maxOutputBytes: number         // integer 1..104_857_600 (100 MB)
    sandboxed:     boolean
  }
  outputSchema:  object | null     // JSON Schema describing expected output; null if unspecified
  createdAt:     string            // ISO 8601 UTC
}
```

**Validation rules:**
- `taskId`, `stepId`, `runId` must be valid UUID v4.
- `workerType` required, 1..200 characters, must match pattern `^[a-zA-Z0-9._-]+$`.
- `instructions` required (may be empty string), max 10000 characters.
- `inputRefs` array, 0..100 items, each string 1..200 chars.
- `constraints.maxDurationMs` integer, 1..3600000.
- `constraints.maxOutputBytes` integer, 1..104857600.
- `constraints.sandboxed` boolean, required.
- `outputSchema` must be `null` or a non-empty object.
- `createdAt` must parse as a valid ISO 8601 datetime string.

## Freeform Text Handling

Fields marked **UNTRUSTED** (`description`, `instructions`, `inputParams`, `toolParams`) are:

1. Subject to max-length enforcement at validation time.
2. Never used for control flow decisions without explicit parsing.
3. Stored as-is but treated as opaque data in all downstream processing.
4. Subject to redaction before export if they contain sensitive patterns.

## Redaction

The `redactSensitive(value, customPatterns?)` helper recursively walks an object and replaces string values matching known secret patterns with `[REDACTED]`.

Built-in patterns detect:
- Strings prefixed with `sk-`, `pk-`, `token-`, `key-`, `bearer `, `ghp_`, `gho_`, `AKIA`.
- Strings matching common base64-encoded key shapes (40+ chars, high entropy).
- Values associated with keys named `password`, `secret`, `token`, `apiKey`, `api_key`, `authorization` (case-insensitive).

Redaction is applied:
- Before logging or display.
- Optionally before evidence export (caller-controlled).
- **Never** in the canonical audit store (the store is the source of truth).

## Forward Compatibility Contract

1. **Readers** MUST ignore unknown fields.
2. **Writers** MUST NOT omit required fields.
3. **Validators** use passthrough mode for unknown fields (Zod `.passthrough()`).
4. **Schema version** is always checked: reject if the major version is higher than supported.
5. **Round-trip safety:** reading and re-serializing a document MUST preserve unknown fields.
