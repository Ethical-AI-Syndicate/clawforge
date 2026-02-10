/**
 * Canonical JSON serialization.
 *
 * Guarantees (per docs/contracts.md §Canonical JSON):
 *   1. Keys sorted lexicographically at every nesting level.
 *   2. No `undefined` values (omitted, never serialized as null).
 *   3. Dates serialized as ISO 8601 UTC strings.
 *   4. null preserved as null.
 *   5. Arrays preserve element order.
 *   6. Output is deterministic: identical logical input → byte-identical output.
 *
 * Pure function — no side effects.
 */

export function canonicalJson(value: unknown): string {
  return JSON.stringify(toSortedValue(value));
}

/**
 * Recursively prepare `value` for JSON.stringify by sorting object keys
 * and converting Dates to ISO strings.
 */
function toSortedValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    // undefined will be dropped by JSON.stringify; null is preserved.
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(toSortedValue);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      const v = obj[key];
      if (v !== undefined) {
        sorted[key] = toSortedValue(v);
      }
    }
    return sorted;
  }

  // string | number | boolean — pass through as-is.
  return value;
}
