# Governance Packs

## What These Are

A governance pack is a YAML file that documents the expectations a
particular workflow is designed to satisfy. Each pack lists the
artifacts typically produced, the metadata fields that carry meaning,
and the event ordering the workflow follows.

Packs are derived from the reference wedges — the example workflows
that ship with this repository. They were written by reading each
wedge's orchestration script and example inputs, then recording the
patterns that emerged: which fields are always present, which artifacts
are always attached, and in what order events appear.

The result is a plain-language description of what a well-formed run
looks like for a given workflow type.

## What These Are Not

- **Not executable.** No tool in this repository reads, parses, or
  acts on these files. They are read by humans.
- **Not schema extensions.** They do not add fields to `IntentContract`,
  introduce new event types, or modify kernel behavior in any way.
- **Not scoring systems.** They do not assign pass/fail grades to
  evidence bundles. They describe what a reviewer would look for.
- **Not commitments.** The existence of a pack does not imply that
  automated evaluation tooling will be built. It means the expectation
  has been identified and written down.

## Why They Live Outside the Kernel

The kernel records events and artifacts with cryptographic integrity.
It does not have opinions about whether a workflow is *complete* — only
that the record is *intact*.

Governance expectations sit above execution. Keeping them separate
means:

1. The kernel's integrity guarantees are not conditional on governance
   rules.
2. Governance expectations can change without a kernel release.
3. Different teams can maintain different packs for the same kernel.
4. A pack can be read alongside an existing evidence bundle, after the
   fact, without re-running anything.

## How Packs Are Derived

Each pack corresponds to one reference wedge. The expectations were
extracted by examining:

- The `IntentContract` fields populated in the wedge's example inputs.
- The artifact types and counts attached during a typical run.
- The event ordering produced by the orchestration script.
- The metadata fields passed to the `RunStarted` event.

The packs describe what the wedge *actually does* in its reference
execution, not everything the kernel *could* support.

## How a Tool Could Use Them

An external tool could:

1. Accept an evidence bundle (zip) and a pack (YAML).
2. Extract `events.jsonl` and `artifacts/manifest.json`.
3. Walk the listed expectations and check each against the evidence.
4. Report which expectations are met and which are not.

No such tool exists in this repository. The packs are structured to
make building one straightforward, but building it is not part of this
project's scope.

## Pack Structure

Each pack file contains:

- `pack` — identifier, version, and the wedge it corresponds to.
- `description` — a short explanation of the workflow type.
- `expectations` — a list of named items, each with:
  - `description` — what the expectation documents.
  - `importance` — `recommended` (informational) or `expected`
    (a well-formed run would normally include this).
  - `check` — plain-language description of what to look for in the
    evidence bundle.

## Available Packs

| Pack | Wedge | File |
|------|-------|------|
| Change Shipping | [Ship a Change](../src/wedges/ship-change/) | [packs/change-shipping.yml](packs/change-shipping.yml) |
| Incident Postmortem | [Incident Postmortem](../src/wedges/incident-postmortem/) | [packs/incident-postmortem.yml](packs/incident-postmortem.yml) |
