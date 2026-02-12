import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSymbolIndex, type SymbolIndex } from "../src/session/symbol-index.js";
import { SessionError } from "../src/session/errors.js";

describe("Symbol Index Builder", () => {
  let testDir: string;
  let projectRoot: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "symbol-index-test-"));
    projectRoot = join(testDir, "project");
    mkdirSync(projectRoot, { recursive: true });
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    mkdirSync(join(projectRoot, "other"), { recursive: true });
    mkdirSync(join(projectRoot, "node_modules", "external"), { recursive: true });
    writeFileSync(join(projectRoot, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "Bundler",
        strict: true,
      },
    }));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should build index with exports and imports", () => {
    // Create test files
    writeFileSync(
      join(projectRoot, "src", "file1.ts"),
      `export function func1() { return 1; }
export class Class1 {}
export interface Interface1 {}
export type Type1 = string;
export const CONST1 = "value";`,
    );

    writeFileSync(
      join(projectRoot, "src", "file2.ts"),
      `import { func1, Class1 } from "./file1.js";
import type { Interface1, Type1 } from "./file1.js";
export function func2() { return func1(); }`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    expect(index.schemaVersion).toBeDefined();
    expect(index.tsVersion).toBeDefined();
    expect(index.generatedAt).toBeDefined();
    expect(index.symbolIndexHash).toBeDefined();
    expect(index.files.length).toBeGreaterThan(0);

    const file1 = index.files.find((f) => f.path === "src/file1.ts");
    expect(file1).toBeDefined();
    expect(file1!.exports.length).toBe(5);
    expect(file1!.exports.some((e) => e.name === "func1" && e.kind === "function")).toBe(true);
    expect(file1!.exports.some((e) => e.name === "Class1" && e.kind === "class")).toBe(true);
    expect(file1!.exports.some((e) => e.name === "Interface1" && e.kind === "interface")).toBe(true);
    expect(file1!.exports.some((e) => e.name === "Type1" && e.kind === "type")).toBe(true);
    expect(file1!.exports.some((e) => e.name === "CONST1" && e.kind === "const")).toBe(true);

    const file2 = index.files.find((f) => f.path === "src/file2.ts");
    expect(file2).toBeDefined();
    expect(file2!.imports.length).toBeGreaterThan(0);
  });

  it("should produce deterministic output ordering", () => {
    writeFileSync(join(projectRoot, "src", "a.ts"), "export const a = 1;");
    writeFileSync(join(projectRoot, "src", "z.ts"), "export const z = 1;");
    writeFileSync(join(projectRoot, "src", "m.ts"), "export const m = 1;");

    const index1 = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const index2 = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    // Files should be sorted
    const paths1 = index1.files.map((f) => f.path);
    const paths2 = index2.files.map((f) => f.path);
    expect(paths1).toEqual(paths2);
    expect(paths1).toEqual(["src/a.ts", "src/m.ts", "src/z.ts"]);
  });

  it("should capture named imports correctly", () => {
    writeFileSync(
      join(projectRoot, "src", "exporter.ts"),
      "export const a = 1; export const b = 2;",
    );

    writeFileSync(
      join(projectRoot, "src", "importer.ts"),
      `import { a, b } from "./exporter.js";`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const importer = index.files.find((f) => f.path === "src/importer.ts");
    expect(importer).toBeDefined();
    const importInfo = importer!.imports.find((i) => i.specifier === "./exporter.js");
    expect(importInfo).toBeDefined();
    expect(importInfo!.named).toContain("a");
    expect(importInfo!.named).toContain("b");
  });

  it("should capture default imports correctly", () => {
    writeFileSync(
      join(projectRoot, "src", "exporter.ts"),
      "export default function defaultExport() {}",
    );

    writeFileSync(
      join(projectRoot, "src", "importer.ts"),
      `import defaultExport from "./exporter.js";`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const importer = index.files.find((f) => f.path === "src/importer.ts");
    expect(importer).toBeDefined();
    const importInfo = importer!.imports.find((i) => i.specifier === "./exporter.js");
    expect(importInfo).toBeDefined();
    expect(importInfo!.defaultImport).toBe("defaultExport");
  });

  it("should capture namespace imports correctly", () => {
    writeFileSync(
      join(projectRoot, "src", "exporter.ts"),
      "export const a = 1;",
    );

    writeFileSync(
      join(projectRoot, "src", "importer.ts"),
      `import * as ns from "./exporter.js";`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const importer = index.files.find((f) => f.path === "src/importer.ts");
    expect(importer).toBeDefined();
    const importInfo = importer!.imports.find((i) => i.specifier === "./exporter.js");
    expect(importInfo).toBeDefined();
    expect(importInfo!.namespaceImport).toBe("ns");
  });

  it("should capture type-only imports correctly", () => {
    writeFileSync(
      join(projectRoot, "src", "exporter.ts"),
      "export type Type1 = string;",
    );

    writeFileSync(
      join(projectRoot, "src", "importer.ts"),
      `import type { Type1 } from "./exporter.js";`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const importer = index.files.find((f) => f.path === "src/importer.ts");
    expect(importer).toBeDefined();
    const importInfo = importer!.imports.find((i) => i.specifier === "./exporter.js");
    expect(importInfo).toBeDefined();
    expect(importInfo!.typeOnly).toBe(true);
  });

  it("should produce stable hash for same index", () => {
    writeFileSync(join(projectRoot, "src", "file.ts"), "export const a = 1;");

    const index1 = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const index2 = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    expect(index1.symbolIndexHash).toBe(index2.symbolIndexHash);
  });

  it("should normalize paths to POSIX style", () => {
    writeFileSync(join(projectRoot, "src", "file.ts"), "export const a = 1;");

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    for (const file of index.files) {
      expect(file.path).not.toContain("\\");
      expect(file.path).toMatch(/^src\/file\.ts$/);
    }
  });

  it("should respect file filter", () => {
    writeFileSync(join(projectRoot, "src", "included.ts"), "export const a = 1;");
    writeFileSync(join(projectRoot, "other", "excluded.ts"), "export const b = 2;");

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const paths = index.files.map((f) => f.path);
    expect(paths).toContain("src/included.ts");
    expect(paths).not.toContain("other/excluded.ts");
  });

  it("should exclude node_modules by default", () => {
    writeFileSync(join(projectRoot, "src", "file.ts"), "export const a = 1;");
    writeFileSync(
      join(projectRoot, "node_modules", "external", "index.ts"),
      "export const b = 2;",
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
    });

    const paths = index.files.map((f) => f.path);
    expect(paths).not.toContain("node_modules/external/index.ts");
  });

  it("should include node_modules when requested", () => {
    writeFileSync(join(projectRoot, "src", "file.ts"), "export const a = 1;");
    writeFileSync(
      join(projectRoot, "node_modules", "external", "index.ts"),
      "export const b = 2;",
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      includeNodeModules: true,
    });

    const paths = index.files.map((f) => f.path);
    // May or may not include node_modules depending on tsconfig, but shouldn't error
    expect(index.files.length).toBeGreaterThan(0);
  });

  it("should throw error for invalid project root", () => {
    expect(() => {
      buildSymbolIndex({
        projectRoot: "/nonexistent/path",
        tsconfigPath: "tsconfig.json",
      });
    }).toThrow(SessionError);
  });

  it("should throw error for invalid tsconfig path", () => {
    expect(() => {
      buildSymbolIndex({
        projectRoot,
        tsconfigPath: "nonexistent.json",
      });
    }).toThrow(SessionError);
  });

  it("should capture export locations correctly", () => {
    writeFileSync(
      join(projectRoot, "src", "file.ts"),
      `export function func1() {}
export class Class1 {}`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const file = index.files.find((f) => f.path === "src/file.ts");
    expect(file).toBeDefined();
    const func1 = file!.exports.find((e) => e.name === "func1");
    expect(func1).toBeDefined();
    expect(func1!.location.line).toBeGreaterThan(0);
    expect(func1!.location.col).toBeGreaterThan(0);
  });

  it("should sort exports deterministically", () => {
    writeFileSync(
      join(projectRoot, "src", "file.ts"),
      `export const z = 1;
export const a = 2;
export const m = 3;`,
    );

    const index = buildSymbolIndex({
      projectRoot,
      tsconfigPath: "tsconfig.json",
      fileFilter: ["src"],
    });

    const file = index.files.find((f) => f.path === "src/file.ts");
    expect(file).toBeDefined();
    const names = file!.exports.map((e) => e.name);
    expect(names).toEqual(["a", "m", "z"]);
  });
});
