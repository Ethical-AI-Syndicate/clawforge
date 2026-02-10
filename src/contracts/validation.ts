/**
 * Schema version handling, redaction, and validation utilities.
 * Pure functions — no side effects, no I/O.
 */

// ---------------------------------------------------------------------------
// Semver parsing
// ---------------------------------------------------------------------------

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse a "MAJOR.MINOR.PATCH" string into its components.
 * Returns null if the string is not a valid semver triple.
 */
export function parseSemver(version: string): SemVer | null {
  const match = SEMVER_RE.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

/**
 * The only major schema version this build supports.
 * Contracts with a different major version are rejected at validation time.
 */
export const SUPPORTED_MAJOR_VERSION = 1;

/**
 * Returns true when `version` is a valid semver string whose major component
 * equals SUPPORTED_MAJOR_VERSION.
 */
export function isSupportedSchemaVersion(version: string): boolean {
  const parsed = parseSemver(version);
  return parsed !== null && parsed.major === SUPPORTED_MAJOR_VERSION;
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Key names (case-insensitive) whose associated values are always redacted.
 */
const SENSITIVE_KEY_RE =
  /^(password|secret|token|api[_-]?key|authorization)$/i;

/**
 * Value prefixes that indicate the string is a credential or secret.
 */
const SENSITIVE_VALUE_PREFIXES = [
  "sk-",
  "pk-",
  "token-",
  "key-",
  "bearer ",
  "ghp_",
  "gho_",
  "AKIA",
];

const REDACTED = "[REDACTED]";

/**
 * Heuristic: a string of 40+ base64-ish characters with mixed case and digits
 * looks like a randomly-generated key.
 */
function looksLikeBase64Key(s: string): boolean {
  if (s.length < 40) return false;
  if (!/^[A-Za-z0-9+/=_-]{40,}$/.test(s)) return false;
  return /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);
}

/**
 * Recursively redact sensitive values.
 *
 * - String values matching a known prefix or the base64-key heuristic are replaced with "[REDACTED]".
 * - Object keys matching SENSITIVE_KEY_RE cause the entire associated value to be replaced.
 * - Custom RegExp patterns can extend the built-in set.
 *
 * Returns a **new** object; the input is never mutated.
 */
export function redactSensitive(
  value: unknown,
  customPatterns?: ReadonlyArray<RegExp>,
): unknown {
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    for (const prefix of SENSITIVE_VALUE_PREFIXES) {
      if (lower.startsWith(prefix.toLowerCase())) {
        return REDACTED;
      }
    }
    if (looksLikeBase64Key(value)) {
      return REDACTED;
    }
    if (customPatterns) {
      for (const pattern of customPatterns) {
        if (pattern.test(value)) {
          return REDACTED;
        }
      }
    }
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, customPatterns));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SENSITIVE_KEY_RE.test(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactSensitive(val, customPatterns);
      }
    }
    return result;
  }

  // primitives (number, boolean, null, undefined) pass through unchanged
  return value;
}
