# Wedge: Incident Postmortem

## The Question This Evidence Answers

> What happened, what evidence was considered, and how were conclusions reached?

An incident postmortem is a retrospective record. Unlike a planned change,
it begins *after* something went wrong. The evidence must demonstrate that
conclusions were reached from artifacts — not from memory or narrative.

This wedge produces a self-contained, hash-chained evidence bundle that
records the incident intent, every investigation artifact, and the order
in which evidence entered the record. A verifier can independently confirm
the integrity of this bundle without trusting the authors, the tooling,
or the prose that accompanies it.

---

## What the Evidence Bundle Contains

After running this wedge, the exported zip has this structure:

```
evidence/
  run.json                        Run metadata (runId, creation time)
  events.jsonl                    Hash-chained event ledger (6 events)
  schemas/
    contracts-v1.0.0.json         Contract schema used for validation
    audit-v1.0.0.json             Audit event schema
  artifacts/
    manifest.json                 Artifact list: label, sha256, size, mime
    <sha256-hash-1>               Artifact content (timeline)
    <sha256-hash-2>               Artifact content (RCA)
    <sha256-hash-3>               Artifact content (log excerpt)
  integrity/
    chain.json                    Precomputed hash chain for verification
```

### What each file proves

| File | Proves | Does NOT prove |
|------|--------|----------------|
| `events.jsonl` | The exact sequence and content of every recorded event; cryptographic chain proves no event was inserted, removed, or reordered after recording | That the events are *true* — only that they were recorded in this order |
| `manifest.json` | Which artifacts were attached, with their SHA-256 hashes and sizes | That the artifacts are *complete* — only that these specific files were submitted |
| `<sha256-hash>` artifacts | Byte-for-byte integrity of each artifact (recompute hash to verify) | That the artifact content is accurate — only that it has not been modified since submission |
| `chain.json` | End-to-end hash chain validity for fast verification | Nothing beyond what `events.jsonl` already proves (it is a convenience) |
| `run.json` | When the postmortem run was opened | Nothing about when the incident actually occurred (that is in the intent contract) |

---

## How to Verify the Evidence (Without Running Anything)

You need only the evidence zip and standard tools (`unzip`, `sha256sum`,
`jq` or any JSON parser).

### Step 1: Extract and inspect structure

```sh
unzip postmortem-evidence.zip -d verify/
ls verify/evidence/
```

Confirm: `run.json`, `events.jsonl`, `artifacts/`, `integrity/`, `schemas/`.

### Step 2: Read the event timeline

```sh
cat verify/evidence/events.jsonl | jq -c '{seq, type, actor: .actor.actorId}'
```

Expected sequence:

| seq | type | meaning |
|-----|------|---------|
| 1 | RunStarted | Postmortem opened |
| 2 | ContractRecorded | Incident description entered |
| 3 | ArtifactRecorded | First evidence artifact attached |
| 4 | ArtifactRecorded | Second evidence artifact attached |
| 5 | ArtifactRecorded | Third evidence artifact attached |
| 6 | RunCompleted | Postmortem closed |

### Step 3: Verify the hash chain

Each event contains `prevHash` and `hash`. Verify the chain:

```sh
cat verify/evidence/events.jsonl | node -e "
  const lines = require('fs').readFileSync('/dev/stdin','utf8').trim().split('\n');
  let prev = '0000000000000000000000000000000000000000000000000000000000000000';
  let ok = true;
  for (const line of lines) {
    const e = JSON.parse(line);
    if (e.prevHash !== prev) {
      console.error('BREAK at seq ' + e.seq + ': expected prevHash ' + prev + ', got ' + e.prevHash);
      ok = false;
    }
    prev = e.hash;
  }
  console.log(ok ? 'Hash chain: VALID' : 'Hash chain: BROKEN');
  process.exit(ok ? 0 : 1);
"
```

### Step 4: Verify artifact integrity

For each artifact in the manifest, confirm the file content matches its hash:

```sh
jq -r '.artifacts[] | "\(.sha256) \(.label)"' verify/evidence/artifacts/manifest.json | \
while read hash label; do
  actual=$(sha256sum "verify/evidence/artifacts/$hash" | cut -d' ' -f1)
  if [ "$hash" = "$actual" ]; then
    echo "OK   $label ($hash)"
  else
    echo "FAIL $label (expected $hash, got $actual)"
  fi
done
```

### Step 5: Inspect the incident contract

The ContractRecorded event (seq 2) contains the full incident description:

```sh
sed -n '2p' verify/evidence/events.jsonl | jq '.payload.contract'
```

This shows what the postmortem claims happened, when, what was impacted,
and who filed it. You can compare this against external sources (tickets,
monitoring, communications) to assess whether the record is accurate.

### Step 6: Cross-reference timeline against event order

The event timestamps in `events.jsonl` record *when evidence entered the
ledger*. The timeline artifact records *when incident events occurred in
the real world*. These are separate claims:

- Event timestamps prove the order of the postmortem *process*.
- Timeline content claims the order of the *incident*.

A thorough review checks both and notes discrepancies.

---

## Why This Wedge Exists

### This is not incident response tooling.

Incident response tools help you *during* an incident: paging, coordination,
status updates, runbooks. This wedge runs *after* the incident is resolved.
It does not page anyone, manage severity, or track response time.

### This is not an RCA template engine.

Many teams use templates or forms for postmortems. This wedge does not
generate, validate, or enforce any particular postmortem format. You bring
your own artifacts — in whatever format your team uses.

### The problem: postmortems decay.

A postmortem in a wiki page or Google Doc has no integrity guarantee.
Anyone with edit access can change it after the fact. There is no
cryptographic proof that the timeline, the RCA, or the log excerpts are
the same artifacts that were reviewed when conclusions were reached.

This matters when:
- An auditor asks, months later, what evidence supported a remediation decision.
- A team disputes whether a contributing factor was known at review time.
- A regulator requires proof that a specific investigation was conducted.

### What this wedge does that a wiki does not:

1. **Hash-chained event ordering.** The ledger proves the exact sequence in
   which evidence entered the record. You cannot silently insert, remove,
   or reorder artifacts after the fact.
2. **Content-addressed artifacts.** Each artifact's SHA-256 hash is recorded
   at attach time. You can independently verify that the artifact in the
   bundle is byte-identical to what was originally submitted.
3. **Separation of claims from evidence.** The intent contract makes a
   *claim* about what happened. The artifacts are the *evidence*. A
   reviewer can evaluate whether the evidence supports the claim.

### The kernel treats incidents and deployments identically.

This wedge uses the exact same kernel API calls, in the exact same order,
as the [Ship a Change](../ship-change/) wedge. The only differences are:
- The intent contract describes an incident instead of a planned change.
- The artifacts are investigation materials instead of build outputs.
- The completion summary says "postmortem closed" instead of "change shipped."

The process does not change when the domain changes. The kernel does not
know or care whether it is recording a deployment, an incident, a policy
update, or a compliance review. It records intent, evidence, and order.

---

## The Example Incident

The included example is a **database connection pool exhaustion** incident
(INC-2049). It was chosen because:

- It involves multiple investigation artifacts of different types
  (timeline, RCA document, raw database log excerpt).
- The root cause is a code defect with clear contributing factors.
- The timeline spans detection, investigation, mitigation, and resolution.
- It demonstrates that the kernel handles failure evidence identically to
  success evidence.

### Example artifacts

| File | Type | Purpose |
|------|------|---------|
| `incident-intent.json` | IntentContract | What happened, when, scope, impact |
| `timeline.md` | Markdown | Minute-by-minute incident timeline |
| `rca.md` | Markdown | Root cause analysis with contributing factors and remediation actions |
| `pg-connections.log` | Log excerpt | Raw `pg_stat_activity` snapshot showing leaked connections |

---

## Running the Wedge

### Prerequisites

- ClawForge built (`pnpm build`)
- ClawForge data directories initialized (`pnpm clawctl init`)

### Execute

```sh
node dist/wedges/incident-postmortem/run.js \
  --intent  src/wedges/incident-postmortem/examples/incident-intent.json \
  --artifact src/wedges/incident-postmortem/examples/timeline.md \
  --artifact src/wedges/incident-postmortem/examples/rca.md \
  --artifact src/wedges/incident-postmortem/examples/pg-connections.log \
  --out postmortem-evidence.zip \
  --actor sre-patel \
  --host ops-workstation \
  --correlation INC-2049
```

### Expected output

```
Incident Postmortem — ClawForge Wedge
======================================
Incident: INC-2049: Database connection pool exhaustion causing cascading API failures
Lead:     sre-patel
Host:     ops-workstation
Evidence: 3 artifact(s)

[1/5] Postmortem run created: <run-id>
[2/5] Incident record filed: b7e3f1a2-9d4c-4e8b-a6f0-1c2d3e4f5a6b
[3/5] Evidence 1/3: timeline.md (2128 bytes, 75b0cf35361b…)
[3/5] Evidence 2/3: rca.md (2566 bytes, 04b40e685ee2…)
[3/5] Evidence 3/3: pg-connections.log (1985 bytes, aee4a91b06b2…)
[4/5] Postmortem closed
[5/5] Evidence bundle exported: postmortem-evidence.zip

Summary
-------
  Run ID:      <run-id>
  Events:      6
  Artifacts:   3
  Chain:       VALID
  Evidence:    postmortem-evidence.zip

Verify independently: pnpm clawctl verify-run --run <run-id>
```

### Verify

After running, verify the bundle using the steps in
[How to Verify the Evidence](#how-to-verify-the-evidence-without-running-anything)
above — or use the kernel CLI:

```sh
pnpm clawctl verify-run --run <run-id>
```

---

## Interface

```
node dist/wedges/incident-postmortem/run.js \
  --intent  <incident-intent.json>       Required. IntentContract JSON.
  --artifact <file> [--artifact <file>]  Required. One or more evidence files.
  --out <evidence.zip>                   Required. Output evidence bundle path.
  --actor <id>                           Optional. Default: "operator".
  --host <id>                            Optional. Default: system hostname.
  --correlation <id>                     Optional. Links to external incident ID.
```

All flags mirror the [Ship a Change](../ship-change/) wedge. The scripts
are structurally identical because the kernel is domain-agnostic.
