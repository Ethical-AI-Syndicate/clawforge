# Reference Examples

This directory contains reference artifacts produced by a clean-room install
of ClawForge v0.1.0. They demonstrate the full walkthrough from the root
README.

## Files

| File                       | Description                                           |
|----------------------------|-------------------------------------------------------|
| `reference.sqlite`         | SQLite database with one run containing 3 events      |
| `reference-evidence.zip`   | Evidence bundle exported from that run                 |
| `intent-contract.json`     | Example IntentContract used during the walkthrough     |
| `contract-event.json`      | Example ContractRecorded event draft                   |

## How These Were Produced

```bash
# 1. Packed the project
npm pack   # → clawforge-0.1.0.tgz

# 2. Clean-room install
mkdir /tmp/cleanroom && cd /tmp/cleanroom
npm init -y && npm install /path/to/clawforge-0.1.0.tgz

# 3. Walkthrough (with env overrides pointing to a temp data dir)
export CLAWFORGE_DB_PATH=/tmp/cleanroom/data/db.sqlite
export CLAWFORGE_ARTIFACT_ROOT=/tmp/cleanroom/data/artifacts

npx clawctl init
npx clawctl new-run --actor operator-1 --host cleanroom-host --json
npx clawctl validate-contract intent-contract.json
npx clawctl append-event --run <runId> --event contract-event.json
npx clawctl put-artifact --run <runId> --file summary.json --mime application/json --label "Repo summary"
npx clawctl verify-run --run <runId>
npx clawctl export-evidence --run <runId> --out evidence.zip
```

## Run Contents

The reference run (`reference.sqlite`) contains these events:

| seq | type              | description                           |
|-----|-------------------|---------------------------------------|
| 1   | RunStarted        | Run created with operator-1 actor     |
| 2   | ContractRecorded  | IntentContract recorded               |
| 3   | ArtifactRecorded  | JSON summary artifact (31 bytes)      |

## Evidence Bundle Contents

The evidence zip (`reference-evidence.zip`) contains:

```
evidence/
  run.json                    Run metadata (runId, createdAt, hostId)
  events.jsonl                3 events, canonical JSON, seq-ordered
  schemas/
    contracts-v1.0.0.json     Contract schema snapshot
    audit-v1.0.0.json         Audit event schema snapshot
  artifacts/
    manifest.json             1 artifact entry (included: true)
    <sha256>                  Artifact bytes (31 bytes)
  integrity/
    chain.json                Hash chain verification: valid, 3 events
```

## Inspecting the SQLite Database

```bash
sqlite3 reference.sqlite "SELECT run_id, created_at FROM runs;"
sqlite3 reference.sqlite "SELECT seq, type, event_id FROM events ORDER BY seq;"
```

## Inspecting the Evidence Bundle

```bash
unzip -l reference-evidence.zip
unzip -p reference-evidence.zip evidence/events.jsonl | head
unzip -p reference-evidence.zip evidence/integrity/chain.json | python3 -m json.tool
```
