/**
 * Session-layer error types.
 *
 * Fixed codes, no inheritance games, no cleverness.
 */

export type SessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "DOD_MISSING"
  | "LOCK_MISSING"
  | "LOCK_NOT_APPROVED"
  | "GATE_FAILED"
  | "SCHEMA_INVALID"
  | "ID_MISMATCH"
  | "MODE_VIOLATION";

export class SessionError extends Error {
  public readonly code: SessionErrorCode;
  public readonly details: Record<string, unknown>;

  constructor(
    message: string,
    code: SessionErrorCode,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SessionError";
    this.code = code;
    this.details = details ?? {};
  }
}
