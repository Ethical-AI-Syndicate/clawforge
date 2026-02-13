# ClawForge GitHub Actions Example

This workflow demonstrates how to record CI/CD runs to ClawForge for audit trails.

## Overview

```
GitHub Actions Run
       ↓
ClawForge Session (created automatically)
       ↓
Events recorded: workflow_started → artifact_recorded → workflow_completed
       ↓
Evidence bundle exported to artifact
```

## Files

```
.
├── .github/
│   └── workflows/
│       └── clawforge-audit.yml    # Main workflow
├── clawforge/
│   ├── config.yaml                # ClawForge config (optional)
│   └── .gitkeep                   # Ensure dir exists
├── examples/
│   └── github-actions/
│       ├── README.md              # This file
│       └── workflow-dispatch.yml  # Example with manual trigger
```

## Usage

### Option 1: Use the Reusable Workflow

Create `.github/workflows/your-workflow.yml`:

```yaml
name: Build and Deploy

on:
  push:
    branches: [main]

jobs:
  build:
    uses: ./.github/workflows/clawforge-audit.yml
    with:
      run-id: ${{ github.run_id }}-${{ github.run_number }}
      actor: ${{ github.actor }}
      repository: ${{ github.repository }}
```

### Option 2: Copy the Workflow Directly

See `workflow-dispatch.yml` for a complete example.

## What Gets Recorded

| Event | Description |
|-------|-------------|
| RunStarted | Workflow execution begins |
| WorkflowMetadata | GitHub context (SHA, branch, actor) |
| ArtifactRecorded | Build artifacts (optional) |
| RunCompleted | Workflow completes with status |

## Output

After the workflow runs:
1. A ClawForge session exists for the run
2. All events are hash-chained
3. An evidence bundle is uploaded as a workflow artifact

## Security Considerations

- **Store credentials securely**: Use GitHub Secrets for any sensitive values
- **Artifact size**: Use `--max-include-bytes` to limit evidence bundle size
- **Retention**: GitHub artifacts auto-delete after 90 days; download and store externally for long-term retention

## Prerequisites

1. Install ClawForge in your runner:
   ```bash
   npm install -g clawforge
   ```

2. Or use the Docker container with ClawForge pre-installed

## Example Output

```
=== change-shipping (v1.0.0) ====
Session: gh-run-1234567890
Status: ✅ PASSED
Summary: 9/9 expectations passed
  ✓ [EXPECTED] intent-recorded-before-artifacts
  ✓ [EXPECTED] intent-includes-title-and-description
  ✓ [EXPECTED] intent-identifies-actor
  ✓ [EXPECTED] at-least-one-artifact-present
  ✓ [EXPECTED] artifact-hashes-match-manifest
  ✓ [RECOMMENDED] correlation-id-present
  ✓ [EXPECTED] run-explicitly-closed
  ✓ [EXPECTED] run-completed-after-all-artifacts
  ✓ [RECOMMENDED] evidence-bundle-produced
```
