# Session Manager Decomposition Plan

> Status: IN PROGRESS
> Original: session.ts (1897 lines)

## Overview

The SessionManager class is too large (1897 lines). This document outlines the decomposition plan.

## Current Public Methods

### Session Lifecycle
- `createSession(opts)` - Create new session
- `getSessionStatus(sessionId)` - Get current status

### Definition of Done (DoD)
- `recordDoD(sessionId, dod)` - Record DoD artifact

### Decision Lock
- `recordDecisionLock(sessionId, lock)` - Record decision lock
- `approveDecisionLock(sessionId, approver, method)` - Approve lock

### Execution Gate
- `evaluateGate(sessionId)` - Evaluate if execution is allowed
- `deriveCompletionStatus(sessionId)` - Check if session is complete

### Runner Evidence
- `recordRunnerEvidence(sessionId, evidence)` - Record runner evidence

### Policies
- `validateSessionPolicies(sessionId, policies)` - Validate session policies

### Prompt Capsule
- `recordPromptCapsule(sessionId, capsule)` - Record prompt
- `lintPromptCapsule(capsule, dod, lock, plan)` - Validate prompt

### Model Response
- `recordModelResponse(sessionId, response)` - Record model response
- `lintModelResponse(response, capsule, dod, lock, plan)` - Validate response

### Symbol Index
- `buildAndRecordSymbolIndex(sessionId, index)` - Build symbol index

### Patch Validation
- `validatePatchAgainstSymbolIndex(sessionId, patch)` - Validate patch

### Repo Snapshot
- `recordRepoSnapshot(sessionId, snapshot)` - Record repo snapshot

### Approval
- `verifySessionApprovals(sessionId)` - Verify approvals
- `emitStepPackets(sessionId)` - Generate step packets
- `validateStepPackets(sessionId)` - Validate packets

### Sealed Change Package
- `validateSessionSeal(sessionId)` - Validate SCP

## Proposed Decomposition

### New File Structure

```
src/session/
├── index.ts              # Re-exports (backward compatible)
├── session.ts            # Main class (reduced)
├── types.ts              # Types only
├── lifecycle.ts          # createSession, getSessionStatus
├── dod.ts                # recordDoD, validateDoD
├── decision-lock.ts      # recordDecisionLock, approveDecisionLock
├── gate.ts               # evaluateGate, deriveCompletionStatus (may already exist)
├── evidence.ts           # recordRunnerEvidence
├── policies.ts           # validateSessionPolicies
├── prompt.ts             # recordPromptCapsule, lintPromptCapsule
├── response.ts           # recordModelResponse, lintModelResponse
├── symbols.ts            # buildAndRecordSymbolIndex, validatePatch
├── snapshot.ts           # recordRepoSnapshot
├── approval.ts           # verifySessionApprovals, emitStepPackets, validateStepPackets
├── seal.ts               # validateSessionSeal
└── errors.ts             # SessionError (may already exist)
```

## Migration Strategy

1. Create new module files with types and functions
2. Import and re-export from new modules in session.ts
3. Gradually move implementation to new modules
4. Update imports across codebase
5. Finally, remove re-exports from session.ts

## Backward Compatibility

Maintain `src/session/index.ts` that re-exports everything:
```typescript
export { SessionManager } from "./session.js";
export type { SessionStatus } from "./session.js";
// ... all other exports
```

This ensures zero breaking changes for consumers.

## Dependencies Between Modules

```
lifecycle.ts
  └── types.ts

dod.ts
  ├── types.ts
  └── lifecycle.ts

decision-lock.ts
  ├── types.ts
  ├── lifecycle.ts
  └── dod.ts

gate.ts
  ├── types.ts
  └── decision-lock.ts

evidence.ts
  ├── types.ts
  └── lifecycle.ts

policies.ts
  ├── types.ts
  └── evidence.ts

prompt.ts
  ├── types.ts
  ├── dod.ts
  └── decision-lock.ts

response.ts
  ├── types.ts
  └── prompt.ts

symbols.ts
  └── types.ts

snapshot.ts
  └── types.ts

approval.ts
  ├── types.ts
  ├── decision-lock.ts
  └── symbols.ts

seal.ts
  ├── types.ts
  └── approval.ts
```

## Priority

| Module | Lines | Priority |
|--------|-------|----------|
| types.ts | ~50 | 1 (extract first) |
| errors.ts | ~20 | 1 |
| lifecycle.ts | ~100 | 2 |
| dod.ts | ~80 | 3 |
| decision-lock.ts | ~100 | 4 |
| gate.ts | ~50 | 5 |
| evidence.ts | ~150 | 6 |
| policies.ts | ~100 | 7 |
| prompt.ts | ~100 | 8 |
| response.ts | ~100 | 9 |
| symbols.ts | ~100 | 10 |
| snapshot.ts | ~100 | 11 |
| approval.ts | ~200 | 12 |
| seal.ts | ~100 | 13 |

## Progress

- [ ] Extract types.ts
- [ ] Extract errors.ts (if separate)
- [ ] Extract lifecycle.ts
- [ ] Extract dod.ts
- [ ] Extract decision-lock.ts
- [ ] Extract gate.ts (verify it exists separately)
- [ ] Extract evidence.ts
- [ ] Extract policies.ts
- [ ] Extract prompt.ts
- [ ] Extract response.ts
- [ ] Extract symbols.ts
- [ ] Extract snapshot.ts
- [ ] Extract approval.ts
- [ ] Extract seal.ts
- [ ] Create index.ts with re-exports
- [ ] Remove duplicate code from session.ts
- [ ] Update all imports
