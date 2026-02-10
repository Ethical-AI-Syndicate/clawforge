# Reference Wedges

## What a Wedge Is

A wedge is a proof workflow. It is not a product feature, not a demo,
and not a tutorial.

A wedge exercises the kernel end-to-end — creating a run, recording
intent, attaching artifacts, closing the run, and exporting a verifiable
evidence bundle. It exists solely to prove that the kernel does what it
claims, using real inputs and producing real evidence.

The kernel is a library. It exposes contracts, an append-only event
store, a content-addressable artifact store, and evidence export. A
wedge is the simplest possible orchestration that connects these pieces
into a complete workflow and produces output you can verify independently.

## Why Wedges Exist

Claims about integrity, determinism, and auditability are easy to make
and hard to verify. Wedges exist so that you do not have to trust the
documentation. Instead:

1. Run a wedge.
2. Open the evidence bundle.
3. Verify it yourself using standard tools (`unzip`, `sha256sum`, `jq`).

If the evidence bundle is intact — hash chain valid, artifact hashes
match, event sequence consistent — the kernel's guarantees hold. If
it is not, the kernel has a defect.

Wedges also demonstrate **invariance**: the kernel uses the same API
calls, the same event types, and the same hash chain regardless of what
domain the workflow belongs to. Two wedges with completely different
purposes should produce structurally identical evidence bundles.

## The Two Reference Wedges

| | Ship a Change | Incident Postmortem |
|---|---|---|
| **Question answered** | What changed, who authorized it, and what artifacts resulted? | What happened, what evidence was considered, and how were conclusions reached? |
| **Domain** | Planned work (code deploy, policy update, config change) | Unplanned failure (outage, defect, operational incident) |
| **Intent** | A description of what *will* happen | A description of what *did* happen |
| **Artifacts** | Build outputs, config files, approval records | Timelines, RCA documents, log excerpts |
| **Kernel calls** | createRun, appendEvent (RunStarted, ContractRecorded, ArtifactRecorded, RunCompleted), putArtifact, exportEvidenceBundle | Identical |
| **Event count** | Varies by artifact count | Varies by artifact count |
| **Evidence structure** | run.json, events.jsonl, artifacts/, integrity/, schemas/ | Identical |
| **Location** | [src/wedges/ship-change/](../src/wedges/ship-change/) | [src/wedges/incident-postmortem/](../src/wedges/incident-postmortem/) |

## What These Two Wedges Prove Together

### Planned vs. unplanned

Ship a Change records intent *before* execution. Incident Postmortem
records intent *after* the fact. The kernel does not distinguish between
these. It records what it is given, in the order it is given.

### Success vs. failure

Ship a Change records a successful outcome (change shipped). Incident
Postmortem records a failure and its investigation. The kernel's
semantics — hash chain, artifact integrity, event ordering — are
identical regardless of whether the workflow represents success or
failure.

### Forward execution vs. retrospective analysis

Ship a Change moves forward: intent, action, artifact, completion.
Incident Postmortem moves backward: something broke, here is what we
found, here is our analysis. The evidence bundle structure is the same
in both cases because the kernel records *events and evidence*, not
*outcomes and judgments*.

### Identical kernel semantics

Both wedges call the same kernel functions in the same order:

1. `EventStore.createRun()`
2. `EventStore.appendEvent()` — RunStarted
3. `EventStore.appendEvent()` — ContractRecorded
4. `ArtifactStore.putArtifact()` + `EventStore.appendEvent()` — ArtifactRecorded (repeated)
5. `EventStore.appendEvent()` — RunCompleted
6. `exportEvidenceBundle()`

No special event types. No domain-specific schemas. No conditional
logic in the kernel. The orchestration scripts differ only in banner
text and completion summary.

This is the point: **the process does not change when the domain changes.**

## How to Verify a Wedge's Output

Each wedge README contains detailed, step-by-step verification
instructions. The short version:

1. Extract the evidence zip.
2. Walk the hash chain in `events.jsonl` — confirm each event's
   `prevHash` matches the prior event's `hash`.
3. For each artifact in `artifacts/manifest.json`, recompute the
   SHA-256 of the corresponding file and confirm it matches.
4. Read the ContractRecorded event to see what was claimed.
5. Read the artifacts to evaluate whether the evidence supports the claim.

Steps 1-3 are mechanical and can be automated. Steps 4-5 require human
judgment. The kernel provides the former so that you can focus on the
latter.

## Related Documentation

- [Contract Schemas](contracts.md) — IntentContract, StepContract, WorkerTaskContract
- [Audit Event Model](audit.md) — event envelope, hash chain, event types
- [Architecture](architecture.md) — module boundaries, data flow
- [CLI Reference](cli.md) — commands and flags for manual verification
