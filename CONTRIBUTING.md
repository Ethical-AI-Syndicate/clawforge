# Contributing to ClawForge

Thank you for your interest in contributing to ClawForge.

This repository is intentionally structured around a stable kernel and
example-driven evolution. Contributions are most helpful when they preserve
kernel guarantees and improve clarity through documentation and reproducible
examples.

## Project philosophy

ClawForge maintains a clear boundary between:

- **Kernel behavior**: typed contracts, audit/event integrity, artifact
  handling, and evidence export that consumers depend on.
- **Examples and wedges**: practical workflows that demonstrate how the kernel
  can be used in different domains.

In practice, this means:

- The kernel is expected to remain stable within a release line.
- Examples are the preferred mechanism for proving behavior, explaining usage,
  and proposing workflow patterns.
- Documentation should make guarantees, assumptions, and limits explicit.

## How to propose documentation changes

Documentation improvements are welcome for README content, docs pages,
references, and templates.

When proposing a documentation change:

1. Identify the audience (new user, integrator, operator, contributor).
2. Describe the specific gap or ambiguity.
3. Provide concrete text changes whenever possible.
4. Include any affected file paths and cross-references.
5. If behavior is described, link to an existing example or command sequence
   that demonstrates it.

Useful documentation updates include clarifying terminology, tightening
contracts language, improving walkthrough accuracy, and fixing stale command
examples.

## How to propose new example workflows

New example workflows (including wedges) are encouraged when they:

- Demonstrate kernel capabilities without changing kernel semantics.
- Show an end-to-end path from intent to verifiable evidence.
- Are reproducible from repository instructions.
- Keep domain-specific logic in the example layer, not in kernel modules.

A strong workflow proposal usually includes:

1. Problem statement and intended audience.
2. Input artifacts and expected outputs/evidence.
3. Step-by-step execution instructions.
4. Validation checks (what confirms success).
5. Notes on how the example preserves existing kernel guarantees.

## How to propose governance documentation

Governance documentation proposals are useful for clarifying repository process,
release expectations, and decision records.

When proposing governance docs:

- Define the document scope (for example: release process, compatibility policy,
  stewardship, or review flow).
- Describe the operational impact on contributors and maintainers.
- Use descriptive language and concrete procedures.
- Link to related contracts and stability docs where relevant.

Governance documentation should improve predictability and transparency without
introducing ambiguity about technical guarantees.

## Intentionally out of scope for this contribution path

The following change types are intentionally out of scope for this
documentation-and-hygiene contribution path:

- Kernel logic changes or behavioral modifications.
- Contract schema changes.
- Audit hash or evidence format changes.
- Storage schema or CLI semantic changes.
- Runtime feature work unrelated to documentation/templates.

If your proposal requires one of the items above, open a focused technical
change proposal instead of a documentation-only contribution.

## Pull requests

For any pull request, include:

- A short summary of the change.
- The motivation/problem being addressed.
- Any files or docs that should be reviewed first.
- Confirmation of what was intentionally not changed.

Thank you for helping keep ClawForge clear, stable, and verifiable.
