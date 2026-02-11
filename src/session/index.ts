/**
 * Session module — public API.
 */

export {
  SESSION_SCHEMA_VERSION,
  DoDItemSchema,
  DefinitionOfDoneSchema,
  DecisionLockSchema,
  GateCheckSchema,
  ExecutionGateResultSchema,
  type DoDItem,
  type DefinitionOfDone,
  type DecisionLock,
  type GateCheck,
  type ExecutionGateResult,
} from "./schemas.js";

export { evaluateExecutionGate } from "./gate.js";

export { SessionError, type SessionErrorCode } from "./errors.js";

export {
  writeSessionJson,
  readSessionJson,
  writeDoDJson,
  readDoDJson,
  writeDecisionLockJson,
  readDecisionLockJson,
  writeGateResultJson,
  readGateResultJson,
  type SessionRecord,
} from "./persistence.js";

export { SessionManager, type SessionStatus } from "./session.js";
