# Wedge: Ship a Change

## The Question This Evidence Answers

Someone hands you a zip file and claims a change was shipped — a deploy, a
policy update, a config rotation. You want to know:

- What was the stated intent?
- Who initiated it?
- What artifacts resulted?
- Were the artifacts actually produced by this process, or attached after
  the fact?
- Has anyone tampered with the record since it was created?

The evidence bundle answers all five questions without requiring access to the
original system, the original operator, or any trust in the person handing you
the file.

---

## What Is in the Evidence Bundle

Every evidence zip has the same structure regardless of what kind of change
was shipped:

```
evidence/
  run.json                        Run metadata: who, where, when, why
  events.jsonl                    Ordered event log (one JSON object per line)
  schemas/
    contracts-v1.0.0.json         Contract schema at time of export
    audit-v1.0.0.json             Event schema at time of export
  artifacts/
    manifest.json                 Index of all artifacts with SHA-256 hashes
    <sha256_hex>                  Raw artifact bytes (named by content hash)
  integrity/
    chain.json                    Hash chain verification result
```

**`run.json`** tells you the run ID, creation time, and metadata (host,
correlation ID, actor). This is the "envelope" — it says who claimed to do
what.

**`events.jsonl`** is the ordered ledger. Each line is a canonical-JSON event
with a `seq` number, a `type`, an `actor`, a `payload`, and a `hash`. The
events form a chain: each event's `prevHash` references the prior event's
`hash`. Modifying any event breaks the chain from that point forward.

**`artifacts/manifest.json`** lists every artifact by SHA-256 hash, size, and
MIME type. The `included` field tells you whether the raw bytes are in the zip
(large artifacts may be referenced but not included).

**`integrity/chain.json`** is the result of verifying the hash chain at
export time. If `valid` is `true` and the `hashes` array has the expected
count, the ledger was intact when the bundle was created.

---

## How to Verify the Evidence (Without Running Anything)

You received `evidence.zip`. You do not trust the person who gave it to you.
Here is what you check.

### Step 1: Inspect the structure

```bash
unzip -l evidence.zip
```

Confirm all expected files are present. If any are missing, the bundle is
incomplete.

### Step 2: Read the event timeline

```bash
unzip -p evidence.zip evidence/events.jsonl | \
  node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
    for (const l of lines) {
      const e = JSON.parse(l);
      console.log(
        'seq=' + e.seq,
        'type=' + e.type.padEnd(20),
        'actor=' + e.actor.actorId,
        'hash=' + e.hash.slice(0, 16) + '…'
      );
    }
  "
```

You should see an ordered sequence. For a "Ship a Change" run:

```
seq=1 type=RunStarted           actor=engineer-1   hash=8dc34d1ab85b1234…
seq=2 type=ContractRecorded     actor=engineer-1   hash=24ae061361c91234…
seq=3 type=ArtifactRecorded     actor=engineer-1   hash=af804d49b8341234…
seq=4 type=ArtifactRecorded     actor=engineer-1   hash=4123a565eea61234…
seq=5 type=RunCompleted         actor=engineer-1   hash=966cbe9799f41234…
```

The first event is always `RunStarted`. The last is always `RunCompleted`.
Everything in between is the record of what happened.

### Step 3: Verify the hash chain

```bash
unzip -p evidence.zip evidence/integrity/chain.json | python3 -m json.tool
```

Check:
- `"valid": true` (or the equivalent field) — the chain was intact at export
- `eventCount` matches the number of lines in `events.jsonl`
- The `hashes` array has one entry per event

If you have the original database, you can also verify live:

```bash
pnpm clawctl verify-run --run <runId>
```

### Step 4: Verify artifact integrity

Every artifact in the zip is named by its SHA-256 hash. The name *is* the
integrity check. To confirm:

```bash
# Pick any artifact hash from the manifest
unzip -p evidence.zip evidence/artifacts/manifest.json | python3 -m json.tool

# Extract the artifact and recompute its hash
HASH="<sha256_from_manifest>"
ACTUAL=$(unzip -p evidence.zip "evidence/artifacts/$HASH" | sha256sum | cut -d' ' -f1)
echo "Expected: $HASH"
echo "Actual:   $ACTUAL"
```

If they match, the artifact bytes are exactly what was stored. If they don't,
the artifact was modified after recording.

### Step 5: Read the intent

The `ContractRecorded` event at seq=2 contains the full validated
IntentContract in its payload. Extract it:

```bash
unzip -p evidence.zip evidence/events.jsonl | \
  node -e "
    const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
    for (const l of lines) {
      const e = JSON.parse(l);
      if (e.type === 'ContractRecorded') {
        console.log(JSON.stringify(e.payload, null, 2));
      }
    }
  "
```

This tells you what the operator *said* they were doing, validated against the
schema at recording time. Compare it against the artifacts. If the intent
says "update runbook" but the artifact is a binary executable, you have a
discrepancy worth investigating.

---

## Why This Wedge Exists

This is not CI. CI answers "did the build pass?" Ship a Change answers "what
happened, who did it, and can we prove it?"

This is not a workflow engine. There is no conditional branching, no retry
logic, no orchestration graph. The script makes five sequential kernel calls.
If any call fails, the process stops and the error surfaces unchanged.

Success or failure of the change is not the primary output. The primary
output is the evidence bundle. A change can fail and still produce a valid
evidence trail. A change can succeed and produce no evidence at all (if you
skip this process). The evidence is the point, not the outcome.

Git history records what code changed. Tickets record what was requested.
Logs record what the system did. None of these answer the question: "given
this specific intent, these specific artifacts, and this specific actor, can
we reconstruct a tamper-evident chain of exactly what happened and in what
order?" Git commits can be rewritten. Tickets can be edited. Logs can be
rotated or truncated. The evidence bundle is a self-contained, hash-chained
snapshot that can be verified offline by anyone, including people who have
no access to your Git repo, your ticket system, or your log aggregator.

The wedge exists because the gap between "we shipped it" and "we can prove
we shipped it, and prove the proof hasn't been altered" is the gap that
auditors, incident reviewers, and compliance teams actually care about.

---

## Two Scenarios, One Process

The "Ship a Change" wedge is domain-agnostic. The same script, the same
kernel calls, the same evidence structure. Only the inputs differ.

### Scenario A: Code Deploy

A frontend engineer ships a new container image to production.

**Intent:** Deploy frontend v2.4.1 with updated search UI.

**Artifacts:**
- `deploy.yaml` — Kubernetes deployment manifest
- `build.log` — CI build output confirming tests passed and image pushed

**Command:**

```bash
node dist/wedges/ship-change/run.js \
  --intent examples/intent-contract.json \
  --artifact deploy.yaml \
  --artifact build.log \
  --out deploy-evidence.zip \
  --actor engineer-1 \
  --host ci-server-03 \
  --correlation TICKET-4217
```

**Evidence bundle answers:**
- *What changed?* → ContractRecorded event contains the full IntentContract.
- *What was deployed?* → `deploy.yaml` artifact, hash-verified.
- *Did tests pass?* → `build.log` artifact, hash-verified.
- *Who did it?* → `engineer-1`, recorded in every event's `actor` field.
- *Has the record been tampered with?* → Hash chain is intact (or not).

### Scenario B: Operational Runbook Update

An SRE team lead updates the incident response runbook to add a P1
escalation path for after-hours incidents.

**Intent:** Add on-call escalation path for P1 incidents outside business
hours (OPS-891).

**Artifacts:**
- `runbook.md` — The updated runbook (v2.3)
- `approval.txt` — Team approval record (3 reviewers)

**Command:**

```bash
node dist/wedges/ship-change/run.js \
  --intent src/wedges/ship-change/examples/scenario-b-intent.json \
  --artifact src/wedges/ship-change/examples/scenario-b-runbook.md \
  --artifact src/wedges/ship-change/examples/scenario-b-approval.txt \
  --out runbook-evidence.zip \
  --actor ops-lead-chen \
  --host ops-workstation \
  --correlation OPS-891
```

**Evidence bundle answers:**
- *What changed?* → The runbook. ContractRecorded payload says exactly what
  and why.
- *What is the new content?* → `runbook.md` artifact, hash-verified.
- *Who approved it?* → `approval.txt` artifact lists reviewers. The actor
  field on every event identifies the person who executed the process.
- *When?* → Timestamps on every event, ordered by `seq`.
- *Has the record been tampered with?* → Hash chain is intact (or not).

### What Is the Same

Both scenarios produce the same evidence structure:

| seq | type              | present in A | present in B |
|-----|-------------------|:------------:|:------------:|
| 1   | RunStarted        | yes          | yes          |
| 2   | ContractRecorded  | yes          | yes          |
| 3+  | ArtifactRecorded  | yes (x2)     | yes (x2)     |
| N   | RunCompleted      | yes          | yes          |

Both bundles contain the same zip layout. Both can be verified with the same
commands. The process does not change when the domain changes.

---

## Running the Wedge

### Prerequisites

```bash
pnpm build           # compile TypeScript (if not already done)
pnpm clawctl init    # create data directory (if first time)
```

### Command

```bash
node dist/wedges/ship-change/run.js \
  --intent <intent-contract.json> \
  --artifact <file> [--artifact <file> ...] \
  --out <evidence.zip> \
  [--actor <id>] \
  [--host <id>] \
  [--correlation <id>]
```

### Flags

| Flag            | Required | Default          | Description                         |
|-----------------|----------|------------------|-------------------------------------|
| `--intent`      | Yes      | —                | Path to an IntentContract JSON file |
| `--artifact`    | Yes      | —                | Path to an artifact file (repeatable) |
| `--out`         | Yes      | —                | Output path for the evidence zip    |
| `--actor`       | No       | `"operator"`     | Actor ID for event attribution      |
| `--host`        | No       | `os.hostname()`  | Host ID stored in run metadata      |
| `--correlation` | No       | —                | Correlation ID (e.g., ticket number)|

### Environment

Uses the same env vars as `clawctl`:

| Variable                  | Default                   |
|---------------------------|---------------------------|
| `CLAWFORGE_DB_PATH`       | `~/.clawforge/db.sqlite`  |
| `CLAWFORGE_ARTIFACT_ROOT` | `~/.clawforge/artifacts/` |

### Sample Output

```
Ship a Change — ClawForge Wedge
================================
Intent:  Update incident response runbook to include on-call escalation path
Actor:   ops-lead-chen
Host:    ops-workstation
Files:   2 artifact(s)

[1/5] Run created: a3f19c02-7d8e-4b1a-9c5f-2e8d4a6b0c3e
[2/5] IntentContract recorded: a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d
[3/5] Artifact 1/2: scenario-b-runbook.md (602 bytes, 9c3a1f2b7e04…)
[3/5] Artifact 2/2: scenario-b-approval.txt (312 bytes, 4d8e2a6c1b05…)
[4/5] Run completed (change shipped)
[5/5] Evidence bundle exported: runbook-evidence.zip

Summary
-------
  Run ID:      a3f19c02-7d8e-4b1a-9c5f-2e8d4a6b0c3e
  Events:      5
  Artifacts:   2
  Chain:       VALID
  Evidence:    runbook-evidence.zip

Verify independently: pnpm clawctl verify-run --run a3f19c02-7d8e-4b1a-9c5f-2e8d4a6b0c3e
```

---

## Design Notes

- **Zero kernel modifications.** This wedge imports kernel modules and calls
  their public APIs. No kernel files were touched.
- **No new schemas.** Only existing event types are used: `RunStarted`,
  `ContractRecorded`, `ArtifactRecorded`, `RunCompleted`.
- **No new CLI commands.** The wedge is a standalone script.
- **All errors surface kernel error codes unchanged.** If the IntentContract
  is invalid, you get the same Zod validation errors. If the DB is missing,
  you get `StoreIntegrityError`. Nothing is caught and repackaged.
