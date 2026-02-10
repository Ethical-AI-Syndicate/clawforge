/**
 * Contract schema migration registry.
 *
 * Migrations are pure functions that transform a contract document from one
 * schema version to another.  The registry is keyed by
 * (contractType, fromVersion, toVersion).
 *
 * See docs/contracts.md §Migration Rules for the governance policy.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContractType =
  | "IntentContract"
  | "StepContract"
  | "WorkerTaskContract";

export type MigrateFn = (
  doc: Record<string, unknown>,
) => Record<string, unknown>;

// ---------------------------------------------------------------------------
// Registry internals
// ---------------------------------------------------------------------------

function migrationKey(
  contractType: ContractType,
  fromVersion: string,
  toVersion: string,
): string {
  return `${contractType}:${fromVersion}:${toVersion}`;
}

const registry = new Map<string, MigrateFn>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a migration function for the given contract type and version range.
 */
export function registerMigration(
  contractType: ContractType,
  fromVersion: string,
  toVersion: string,
  fn: MigrateFn,
): void {
  const key = migrationKey(contractType, fromVersion, toVersion);
  if (registry.has(key)) {
    throw new Error(`Migration already registered: ${key}`);
  }
  registry.set(key, fn);
}

/**
 * Look up a migration function.  Returns undefined if none is registered.
 */
export function getMigration(
  contractType: ContractType,
  fromVersion: string,
  toVersion: string,
): MigrateFn | undefined {
  return registry.get(migrationKey(contractType, fromVersion, toVersion));
}

/**
 * Apply a registered migration to a contract document.
 * Throws if no migration is registered for the given triple.
 */
export function migrate(
  contractType: ContractType,
  fromVersion: string,
  toVersion: string,
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const fn = getMigration(contractType, fromVersion, toVersion);
  if (!fn) {
    throw new Error(
      `No migration registered for ${contractType} from ${fromVersion} to ${toVersion}`,
    );
  }
  return fn(doc);
}

// ---------------------------------------------------------------------------
// Built-in migrations
// ---------------------------------------------------------------------------

/**
 * IntentContract 1.0.0 → 1.1.0
 *
 * Adds an optional `priority` field.  If the field is already present
 * (forward-compat passthrough), its value is preserved; otherwise it
 * defaults to "normal".
 */
registerMigration("IntentContract", "1.0.0", "1.1.0", (doc) => ({
  ...doc,
  schemaVersion: "1.1.0",
  priority: (doc.priority as string | undefined) ?? "normal",
}));
