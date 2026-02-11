/**
 * Symbol Index Builder — deterministic symbol graph construction.
 *
 * Phase L: Builds a complete symbol index from the repository using the
 * TypeScript compiler API. Captures all exports, imports, and their locations
 * for deterministic validation.
 */

import * as ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, normalize, sep } from "node:path";
import { SESSION_SCHEMA_VERSION } from "./schemas.js";
import { canonicalJson } from "../audit/canonical.js";
import { sha256Hex } from "./crypto.js";
import { SessionError } from "./errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SymbolIndex {
  schemaVersion: string;
  generatedAt: string;
  tsVersion: string;
  symbolIndexHash: string;
  files: FileSymbolInfo[];
}

export interface FileSymbolInfo {
  path: string; // POSIX, relative to repo root
  exports: ExportInfo[];
  imports: ImportInfo[];
}

export interface ExportInfo {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "default";
  isDefault: boolean;
  isTypeOnly: boolean;
  location: { line: number; col: number };
  signatureHash?: string;
}

export interface ImportInfo {
  specifier: string; // module specifier
  named: string[]; // named imports
  defaultImport?: string;
  namespaceImport?: string;
  typeOnly: boolean;
}

export interface BuildSymbolIndexOptions {
  projectRoot: string;
  tsconfigPath: string;
  fileFilter?: string[]; // array of allowed file paths (already expanded by caller)
  includeNodeModules?: boolean;
}

// ---------------------------------------------------------------------------
// Path normalization
// ---------------------------------------------------------------------------

/**
 * Normalize file path to POSIX relative path from project root.
 */
function normalizePath(projectRoot: string, filePath: string): string {
  const resolved = resolve(filePath);
  const rootResolved = resolve(projectRoot);
  const relativePath = relative(rootResolved, resolved);
  // Convert to POSIX (forward slashes)
  return relativePath.split(sep).join("/");
}

/**
 * Check if a file path matches the filter.
 */
function matchesFilter(
  normalizedPath: string,
  fileFilter?: string[],
): boolean {
  if (!fileFilter || fileFilter.length === 0) {
    return true;
  }
  return fileFilter.some((filter) => {
    // Exact match or prefix match
    return normalizedPath === filter || normalizedPath.startsWith(filter + "/");
  });
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

/**
 * Extract export information from a node.
 */
function extractExports(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  exports: ExportInfo[],
): void {
  // Export declarations: export { ... } from "..."
  if (ts.isExportDeclaration(node)) {
    if (node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) {
        const name = element.name.text;
        const location = sourceFile.getLineAndCharacterOfPosition(
          element.getStart(),
        );
        exports.push({
          name,
          kind: "const", // Re-export, kind unknown
          isDefault: false,
          isTypeOnly: node.isTypeOnly,
          location: { line: location.line + 1, col: location.character + 1 },
        });
      }
    }
    return;
  }

  // Export assignment: export = ...
  if (ts.isExportAssignment(node)) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    exports.push({
      name: "default",
      kind: "default",
      isDefault: true,
      isTypeOnly: false,
      location: { line: location.line + 1, col: location.character + 1 },
    });
    return;
  }

  // Named exports: export function/class/interface/type/const
  if (ts.isFunctionDeclaration(node) && node.name) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    exports.push({
      name: node.name.text,
      kind: "function",
      isDefault: false,
      isTypeOnly: false,
      location: { line: location.line + 1, col: location.character + 1 },
    });
    return;
  }

  if (ts.isClassDeclaration(node) && node.name) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    exports.push({
      name: node.name.text,
      kind: "class",
      isDefault: false,
      isTypeOnly: false,
      location: { line: location.line + 1, col: location.character + 1 },
    });
    return;
  }

  if (ts.isInterfaceDeclaration(node) && node.name) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    exports.push({
      name: node.name.text,
      kind: "interface",
      isDefault: false,
      isTypeOnly: true,
      location: { line: location.line + 1, col: location.character + 1 },
    });
    return;
  }

  if (ts.isTypeAliasDeclaration(node) && node.name) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    exports.push({
      name: node.name.text,
      kind: "type",
      isDefault: false,
      isTypeOnly: true,
      location: { line: location.line + 1, col: location.character + 1 },
    });
    return;
  }

  if (ts.isVariableStatement(node)) {
    for (const declaration of node.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name)) {
        const location = sourceFile.getLineAndCharacterOfPosition(
          declaration.getStart(),
        );
        exports.push({
          name: declaration.name.text,
          kind: "const",
          isDefault: false,
          isTypeOnly: false,
          location: { line: location.line + 1, col: location.character + 1 },
        });
      }
    }
    return;
  }

  // Default export: export default ...
  if (ts.isExportSpecifier(node)) {
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    exports.push({
      name: node.name.text,
      kind: "default",
      isDefault: true,
      isTypeOnly: false,
      location: { line: location.line + 1, col: location.character + 1 },
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

/**
 * Extract import information from a node.
 */
function extractImports(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  imports: ImportInfo[],
): void {
  if (!ts.isImportDeclaration(node)) {
    return;
  }

  const specifier = node.moduleSpecifier;
  if (!ts.isStringLiteral(specifier)) {
    return;
  }

  const moduleSpecifier = specifier.text;
  const importClause = node.importClause;

  if (!importClause) {
    // import "..."
    imports.push({
      specifier: moduleSpecifier,
      named: [],
      typeOnly: false,
    });
    return;
  }

  const isTypeOnly = node.importClause?.isTypeOnly ?? false;

  // Default import: import name from "..."
  const defaultImport = importClause.name?.text;

  // Namespace import: import * as name from "..."
  const namespaceImport = importClause.namedBindings
    ? ts.isNamespaceImport(importClause.namedBindings)
      ? importClause.namedBindings.name.text
      : undefined
    : undefined;

  // Named imports: import { a, b } from "..."
  const named: string[] = [];
  if (
    importClause.namedBindings &&
    ts.isNamedImports(importClause.namedBindings)
  ) {
    for (const element of importClause.namedBindings.elements) {
      named.push(element.name.text);
    }
  }

  imports.push({
    specifier: moduleSpecifier,
    named: named.sort(), // Sort for determinism
    defaultImport,
    namespaceImport,
    typeOnly: isTypeOnly,
  });
}

// ---------------------------------------------------------------------------
// Symbol index builder
// ---------------------------------------------------------------------------

/**
 * Build a deterministic symbol index from the repository.
 *
 * @param options - Build options
 * @returns SymbolIndex with all exports and imports
 */
export function buildSymbolIndex(
  options: BuildSymbolIndexOptions,
): SymbolIndex {
  const { projectRoot, tsconfigPath, fileFilter, includeNodeModules = false } =
    options;

  // Validate project root exists
  if (!existsSync(projectRoot)) {
    throw new SessionError(
      `Project root does not exist: ${projectRoot}`,
      "SYMBOL_INDEX_INVALID",
      { projectRoot },
    );
  }

  // Validate tsconfig exists
  const resolvedTsconfigPath = resolve(projectRoot, tsconfigPath);
  if (!existsSync(resolvedTsconfigPath)) {
    throw new SessionError(
      `tsconfig.json not found: ${resolvedTsconfigPath}`,
      "SYMBOL_INDEX_INVALID",
      { tsconfigPath: resolvedTsconfigPath },
    );
  }

  // Read and parse tsconfig
  const configFile = ts.readConfigFile(resolvedTsconfigPath, (path) =>
    readFileSync(path, "utf8"),
  );

  if (configFile.error) {
    throw new SessionError(
      `Failed to read tsconfig.json: ${configFile.error.messageText as string}`,
      "SYMBOL_INDEX_INVALID",
      { tsconfigPath: resolvedTsconfigPath },
    );
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    resolve(projectRoot),
  );

  if (parsedConfig.errors.length > 0) {
    const errorMessages = parsedConfig.errors
      .map((e) => e.messageText as string)
      .join("; ");
    throw new SessionError(
      `Failed to parse tsconfig.json: ${errorMessages}`,
      "SYMBOL_INDEX_INVALID",
      { tsconfigPath: resolvedTsconfigPath },
    );
  }

  // Filter file list if provided
  let fileList = parsedConfig.fileNames;
  if (fileFilter && fileFilter.length > 0) {
    fileList = fileList.filter((file) => {
      const normalized = normalizePath(projectRoot, file);
      return matchesFilter(normalized, fileFilter);
    });
  }

  // Filter out node_modules unless included
  if (!includeNodeModules) {
    fileList = fileList.filter((file) => !file.includes("node_modules"));
  }

  // Create TypeScript program
  const program = ts.createProgram(fileList, parsedConfig.options);

  // Build symbol index
  const files: FileSymbolInfo[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    const normalizedPath = normalizePath(projectRoot, sourceFile.fileName);

    // Skip declaration files and node_modules (if not included)
    if (
      sourceFile.isDeclarationFile ||
      (!includeNodeModules && normalizedPath.includes("node_modules"))
    ) {
      continue;
    }

    // Apply file filter
    if (fileFilter && fileFilter.length > 0) {
      if (!matchesFilter(normalizedPath, fileFilter)) {
        continue;
      }
    }

    const exports: ExportInfo[] = [];
    const imports: ImportInfo[] = [];

    // Traverse AST to find exports and imports
    ts.forEachChild(sourceFile, (node) => {
      // Check if node is exported
      let isExported = false;
      try {
        // Type guard: check if node has modifiers property
        if ("modifiers" in node && Array.isArray((node as any).modifiers)) {
          const modifiers = (node as any).modifiers as ts.Modifier[];
          isExported = modifiers.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword,
          );
        } else {
          const modifiers = ts.getModifiers(node as ts.HasModifiers);
          if (modifiers) {
            isExported = modifiers.some(
              (m) => m.kind === ts.SyntaxKind.ExportKeyword,
            );
          }
        }
      } catch {
        // Node doesn't support modifiers, skip
      }

      if (isExported) {
        extractExports(sourceFile, node, exports);
      }

      // Check for export declarations separately
      if (ts.isExportDeclaration(node)) {
        extractExports(sourceFile, node, exports);
      }

      // Extract imports
      if (ts.isImportDeclaration(node)) {
        extractImports(sourceFile, node, imports);
      }
    });

    // Sort exports and imports for determinism
    exports.sort((a, b) => {
      if (a.name !== b.name) {
        return a.name.localeCompare(b.name);
      }
      if (a.location.line !== b.location.line) {
        return a.location.line - b.location.line;
      }
      return a.location.col - b.location.col;
    });

    imports.sort((a, b) => {
      if (a.specifier !== b.specifier) {
        return a.specifier.localeCompare(b.specifier);
      }
      return 0;
    });

    files.push({
      path: normalizedPath,
      exports,
      imports,
    });
  }

  // Sort files by path for determinism
  files.sort((a, b) => a.path.localeCompare(b.path));

  // Build index
  const index: Omit<SymbolIndex, "symbolIndexHash"> = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    tsVersion: ts.version,
    files,
  };

  // Compute hash
  const canonical = canonicalJson(index);
  const symbolIndexHash = sha256Hex(canonical);

  return {
    ...index,
    symbolIndexHash,
  };
}
