/**
 * Symbol Boundary Extraction — deterministic path and symbol extraction from patches.
 *
 * Phase K: Extracts referenced file paths and symbols from patch text using
 * deterministic regex-based parsing. No AST required.
 */

// ---------------------------------------------------------------------------
// Extract referenced file paths from patch
// ---------------------------------------------------------------------------

/**
 * Extract referenced file paths from unified diff patch text.
 *
 * Deterministic regex-based extraction:
 * - Detects lines starting with "+++ b/" and "--- a/" to identify touched files
 * - Extracts import/require patterns (import ... from "...", require("..."), dynamic import("..."))
 * - Normalizes relative paths (strict, fails on "../" traversal)
 * - Returns repo-relative paths only
 *
 * @param patchText - Unified diff patch text
 * @returns Array of repo-relative file paths referenced in the patch
 */
export function extractReferencedFilePathsFromPatch(
  patchText: string,
): string[] {
  const paths = new Set<string>();

  // Extract files from unified diff headers (+++ b/ and --- a/)
  const diffHeaderRe = /^(?:---\s+a\/(.+)|\+\+\+\s+b\/(.+))$/gm;
  let match: RegExpExecArray | null;
  while ((match = diffHeaderRe.exec(patchText)) !== null) {
    const path = match[1] || match[2];
    if (path && path !== "/dev/null") {
      // Normalize path (remove leading/trailing whitespace)
      const normalized = path.trim();
      if (normalized && !normalized.includes("..")) {
        paths.add(normalized);
      }
    }
  }

  // Extract import/require patterns
  // Pattern 1: import ... from "..."
  const importFromRe = /import\s+(?:[^"']*from\s+)?["']([^"']+)["']/g;
  while ((match = importFromRe.exec(patchText)) !== null) {
    const specifier = match[1];
    if (specifier) {
      const normalized = normalizeModuleSpecifier(specifier);
      if (normalized) {
        paths.add(normalized);
      }
    }
  }

  // Pattern 2: require("...")
  const requireRe = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = requireRe.exec(patchText)) !== null) {
    const specifier = match[1];
    if (specifier) {
      const normalized = normalizeModuleSpecifier(specifier);
      if (normalized) {
        paths.add(normalized);
      }
    }
  }

  // Pattern 3: dynamic import("...")
  const dynamicImportRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = dynamicImportRe.exec(patchText)) !== null) {
    const specifier = match[1];
    if (specifier) {
      const normalized = normalizeModuleSpecifier(specifier);
      if (normalized) {
        paths.add(normalized);
      }
    }
  }

  return Array.from(paths);
}

/**
 * Normalize module specifier to repo-relative path.
 *
 * Rules:
 * - Relative paths ("./", "../") are normalized
 * - "../" traversal is rejected (returns null)
 * - Absolute paths are rejected (returns null)
 * - External modules (no "./" or "../") are returned as-is (will be checked against allowedExternalModules)
 * - Backslashes are converted to forward slashes
 *
 * @param specifier - Module specifier from import/require
 * @returns Normalized repo-relative path, or null if invalid
 */
function normalizeModuleSpecifier(specifier: string): string | null {
  // Remove leading/trailing whitespace
  const trimmed = specifier.trim();

  // Reject if contains ".." (path traversal)
  if (trimmed.includes("..")) {
    return null;
  }

  // Reject if absolute path
  if (trimmed.startsWith("/")) {
    return null;
  }

  // Convert backslashes to forward slashes
  const normalized = trimmed.replace(/\\/g, "/");

  // Remove leading "./" if present
  if (normalized.startsWith("./")) {
    return normalized.slice(2);
  }

  // If it's a relative path without "./", add it
  // But if it starts with a letter and looks like an external module, return as-is
  if (/^[a-zA-Z@]/.test(normalized)) {
    // Likely an external module (e.g., "lodash", "@types/node")
    return normalized;
  }

  // Otherwise, it's a relative path
  return normalized;
}

// ---------------------------------------------------------------------------
// Extract symbol mentions from patch (optional, shallow)
// ---------------------------------------------------------------------------

/**
 * Extract symbol mentions from patch text (shallow, best-effort).
 *
 * Extracts tokens that look like identifiers (PascalCase, camelCase).
 * This is a shallow extraction; the hard boundary is the file allowlist.
 *
 * @param patchText - Unified diff patch text
 * @returns Array of symbol names mentioned in the patch
 */
export function extractSymbolMentions(patchText: string): string[] {
  const symbols = new Set<string>();

  // Extract identifiers that look like symbols (PascalCase or camelCase)
  // Pattern: word boundary, then capital letter or lowercase letter followed by capital
  const symbolRe = /\b([A-Z][a-zA-Z0-9]*|[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\b/g;
  let match: RegExpExecArray | null;
  while ((match = symbolRe.exec(patchText)) !== null) {
    const symbol = match[1];
    // Filter out common keywords and short tokens
    if (
      symbol.length >= 3 &&
      !["the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "may", "new", "now", "old", "see", "two", "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use"].includes(
        symbol.toLowerCase(),
      )
    ) {
      symbols.add(symbol);
    }
  }

  return Array.from(symbols);
}
