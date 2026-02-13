# ClawForge for Claude Code / Cursor

Record Claude Code or Cursor sessions to ClawForge for audit trails.

## Overview

```
Claude Code / Cursor Session
         ↓
MCP Tool Calls (logged)
         ↓
ClawForge Session
         ↓
Events: session_start → tool_calls → session_end
         ↓
Evidence bundle = complete AI session audit
```

## Why Audit AI Sessions?

- **Compliance**: Prove what AI did in your codebase
- **Reproducibility**: Replay exact AI actions
- **Security**: Detect AI behavior anomalies
- **Audit**: Regulatory requirements for AI-assisted work

## Quick Start

### Option 1: Claude Code MCP Server (Recommended)

Create an MCP server that wraps Claude Code tool calls:

```typescript
// claude-mcp-server.ts
import { ClawForge } from "clawforge";

const cf = new ClawForge();

// Intercept Claude Code tool calls
export const tools = {
  async callTool(name: string, args: any) {
    const sessionId = process.env.CLAWFORGE_SESSION_ID;
    
    if (sessionId) {
      await cf.event.append(sessionId, {
        eventType: "ToolCall",
        payload: {
          tool: name,
          arguments: args,
          timestamp: new Date().toISOString(),
        },
      });
    }
    
    // Call the actual tool
    return originalToolCall(name, args);
  },
  
  async sessionStart(sessionId: string, context: any) {
    await cf.session.create(sessionId, {
      actor: "claude-code",
      metadata: context,
    });
    
    await cf.event.append(sessionId, {
      eventType: "SessionStarted",
      payload: {
        model: context.model,
        systemPrompt: context.systemPrompt?.substring(0, 1000), // truncated
      },
    });
  },
  
  async sessionEnd(sessionId: string, summary: any) {
    await cf.event.append(sessionId, {
      eventType: "SessionEnded",
      payload: {
        tokenCount: summary.totalTokens,
        duration: summary.duration,
        toolCount: summary.toolCalls,
      },
    });
    
    // Export evidence
    await cf.session.exportEvidence(sessionId);
  },
};
```

### Option 2: Cursor Hook (Pre-Build)

Add to your Cursor settings:

```json
{
  "cursor.clawforge.sessionTracking": true,
  "cursor.clawforge.exportPath": "./evidence"
}
```

### Option 3: Simple Shell Wrapper

```bash
#!/bin/bash
# Wrap your AI session

SESSION_ID="claude-$(date +%Y%m%d-%H%M%S)"

# Start session
clawctl new-run --run "$SESSION_ID" \
  --actor "claude-code" \
  --correlation "session-$SESSION_ID" \
  --json

export CLAWFORGE_SESSION_ID="$SESSION_ID"

# Run your Claude session
claude "$@"
EXIT_CODE=$?

# End session
cat > /tmp/session-end.json << EOF
{
  "eventType": "SessionEnded",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "payload": {
    "exit_code": $EXIT_CODE,
    "duration": "$(($SECONDS))s"
  }
}
EOF

clawctl append-event --run "$SESSION_ID" --event /tmp/session-end.json --json
clawctl export-evidence --run "$SESSION_ID" --out "evidence-$SESSION_ID.zip"

echo "Session audited: $SESSION_ID"
```

## What Gets Recorded

| Event | Contents |
|-------|----------|
| SessionStarted | Model, system prompt (truncated), timestamp |
| ToolCall | Tool name, arguments, result |
| ToolResult | Output, errors |
| SessionEnded | Token count, duration, exit code |

## Example Evidence Bundle

```
evidence-claude-20260213-143022.zip
├── events.json
│   ├── SessionStarted
│   ├── ToolCall: ReadFile
│   ├── ToolCall: WriteFile
│   ├── ToolCall: Bash
│   └── SessionEnded
├── artifacts/
│   ├── sha256:abc123... (modified files)
│   └── sha256:def456... (new files)
├── chain-proof.json
└── metadata.json
```

## Governance Validation

```bash
clawctl governance validate --session $SESSION_ID --pack change-shipping
```

Expected expectations that apply:
- `intent-recorded-before-artifacts` (files before session end)
- `at-least-one-artifact-present` (AI modifies files)
- `run-explicitly-closed` (SessionEnded event)

## Compliance Use Cases

### SOC 2

> "We maintain audit trails of all AI-assisted code changes."

Use: Export evidence bundles → store in compliance archive

### ISO 27001

> "AI tool access is logged and verifiable."

Use: Chain verification → prove no tampering

### GDPR

> "Automated decisions are logged."

Use: Tool call records → explain AI actions

## Security Considerations

1. **Sensitive data**: AI prompts may contain secrets
   - Use `redactSensitive()` before logging
   - Set `CLAWFORGE_REDACT_PATTERNS` env var

2. **Token limits**: Full tool arguments can be large
   - Truncate or exclude large payloads
   - Set `CLAWFORGE_MAX_PAYLOAD_SIZE`

3. **Storage**: AI sessions generate many events
   - Archive old sessions to cold storage
   - Use evidence bundle export for long-term retention

## Example: Cursor Integration

Add to `.cursor/rules/clawforge.md`:

```markdown
# ClawForge Audit Trail

All file modifications are recorded to ClawForge for audit purposes.

1. Session ID is auto-generated for each Cursor session
2. File reads and writes are logged as events
3. Evidence bundle is exported on session close
4. Evidence stored in ./evidence/ directory

To disable: Set DISABLE_CLAWFORGE=1 in environment
```

## Verification

```bash
# Verify session integrity
clawctl verify-run --session $SESSION_ID --json

# Export for compliance
clawctl export-evidence --session $SESSION_ID --out audit.zip
```
