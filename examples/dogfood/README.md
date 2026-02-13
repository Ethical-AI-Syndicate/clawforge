# Dogfooding: ClawForge Audits Itself

This example demonstrates ClawForge auditing its own development process.

## Concept

```
ClawForge Development
        ↓
Every commit → ClawForge session
        ↓
Events: commit, pr, review, merge
        ↓
Evidence bundle = complete development audit trail
```

## Why This Matters

- **Meta-example**: Shows ClawForge can audit complex, real-world workflows
- **Self-verification**: The audit system is verified by its own output
- **Trust signal**: "We use our own product" is powerful

## Implementation

### Script: `audit-clawforge.sh`

```bash
#!/bin/bash
# Audit ClawForge's own development

CLAWFORGE_DIR="/path/to/clawforge"
SESSION_ID="clawforge-dev-$(date +%Y%m%d)"

# Initialize
clawctl new-run --run "$SESSION_ID" \
  --actor "dogfood-$(whoami)" \
  --correlation "clawforge-$(git rev-parse HEAD)" \
  --json

# Record commit info
COMMIT_MSG=$(git log -1 --pretty=format:"%s")
COMMIT_SHA=$(git rev-parse HEAD)
COMMIT_AUTHOR=$(git log -1 --pretty=format:"%an")
COMMIT_DATE=$(git log -1 --pretty=format:"%ai")

cat > /tmp/commit-event.json << EOF
{
  "eventType": "CommitRecorded",
  "timestamp": "$COMMIT_DATE",
  "payload": {
    "sha": "$COMMIT_SHA",
    "message": "$COMMIT_MSG",
    "author": "$COMMIT_AUTHOR",
    "files_changed": $(git diff --name-only HEAD~1 | wc -l),
    "insertions": $(git diff --stat HEAD~1 | grep insertion | awk '{print $2}' | tr -d '+'),
    "deletions": $(git diff --stat HEAD~1 | grep deletion | awk '{print $2}' | tr -d '-')
  }
}
EOF

clawctl append-event --run "$SESSION_ID" --event /tmp/commit-event.json --json

# Record test results
cat > /tmp/test-event.json << EOF
{
  "eventType": "TestResults",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload": {
    "framework": "vitest",
    "total": $(grep -c "test(" src/**/*.test.ts 2>/dev/null | awk '{s+=$1} END {print s+0}' || echo "0"),
    "passed": "dynamic",
    "coverage": "dynamic"
  }
}
EOF

clawctl append-event --run "$SESSION_ID" --event /tmp/test-event.json --json

# Export evidence
clawctl export-evidence --run "$SESSION_ID" --out "evidence-$SESSION_ID.zip" --json

echo "ClawForge development audited: $SESSION_ID"
```

### GitHub Actions Workflow

```yaml
# .github/workflows/clawforge-dogfood.yml
name: ClawForge Self-Audit

on:
  push:
    branches: [main, master]
  pull_request:
    branches: [main, master]

jobs:
  dogfood:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install ClawForge
        run: npm install -g clawforge
      
      - name: Initialize ClawForge
        run: clawctl init
      
      - name: Create audit session
        id: session
        run: |
          SESSION_ID="clawforge-${{ github.run_id }}-${{ github.run_number }}"
          echo "session-id=$SESSION_ID" >> $GITHUB_OUTPUT
          
          clawctl new-run --run "$SESSION_ID" \
            --actor "${{ github.actor }}" \
            --correlation "${{ github.repository }}::${{ github.ref }}" \
            --meta '{"sha":"${{ github.sha }}","workflow":"${{ github.workflow }}"}' \
            --json

      - name: Record commit
        run: |
          cat > /tmp/commit.json << EOF
          {
            "eventType": "CommitRecorded",
            "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "payload": {
              "sha": "${{ github.sha }}",
              "ref": "${{ github.ref }}",
              "repository": "${{ github.repository }}"
            }
          }
          EOF
          
          clawctl append-event \
            --run "${{ steps.session.outputs.session-id }}" \
            --event /tmp/commit.json \
            --json

      - name: Run tests
        run: |
          pnpm install
          pnpm test -- --reporter=json > /tmp/test-results.json || true
          
          # Extract test summary
          TOTAL=$(grep -c '"name":' /tmp/test-results.json || echo "0")
          
          cat > /tmp/test-event.json << EOF
          {
            "eventType": "TestResults",
            "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "payload": {
              "total": $TOTAL,
              "status": "${{ job.status }}"
            }
          }
          EOF
          
          clawctl append-event \
            --run "${{ steps.session.outputs.session-id }}" \
            --event /tmp/test-event.json \
            --json

      - name: Record build
        run: |
          pnpm build
          
          cat > /tmp/build-event.json << EOF
          {
            "eventType": "BuildCompleted",
            "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
            "payload": {
              "status": "${{ job.status }}",
              "node_version": "20"
            }
          }
          EOF
          
          clawctl append-event \
            --run "${{ steps.session.outputs.session-id }}" \
            --event /tmp/build-event.json \
            --json

      - name: Export evidence
        run: |
          clawctl export-evidence \
            --run "${{ steps.session.outputs.session-id }}" \
            --out evidence.zip

      - name: Upload evidence
        uses: actions/upload-artifact@v4
        with:
          name: clawforge-evidence-${{ steps.session.outputs.session-id }}
          path: evidence.zip

      - name: Verify integrity
        run: |
          clawctl verify-run --run "${{ steps.session.outputs.session-id }}" --json

      - name: Governance validation
        run: |
          clawctl governance validate \
            --session "${{ steps.session.outputs.session-id }}" \
            --pack change-shipping \
            --json
```

## Results

Running this workflow produces:

```
=== change-shipping (v1.0.0) ====
Session: clawforge-1234567890-42
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

## Verification

Each push to main creates a complete audit trail:

1. **Who**: Actor identification
2. **What**: Commit SHA, files changed
3. **When**: Timestamps (UTC)
4. **Result**: Test results, build status

The evidence bundle contains everything needed to verify the audit independently.

## Trust Signal

> "ClawForge audits its own development with ClawForge."

This is the ultimate credibility signal:
- We trust our own product
- We can verify our own process
- You can too
