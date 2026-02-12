import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRepoSnapshot,
  computeSnapshotHash,
  type RepoSnapshot,
} from "../src/session/repo-snapshot.js";
import { SessionError } from "../src/session/errors.js";
import { sha256Hex } from "../src/session/crypto.js";

describe("Repo Snapshot Builder", () => {
  let testDir: string;
  let projectRoot: string;
  const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "repo-snapshot-test-"));
    projectRoot = join(testDir, "project");
    mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("should build snapshot with file content hashes", () => {
    writeFileSync(join(projectRoot, "file1.ts"), "export const a = 1;");
    writeFileSync(join(projectRoot, "file2.ts"), "export const b = 2;");

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file1.ts", "file2.ts"],
      sessionId: SESSION_ID,
    });

    expect(snapshot.schemaVersion).toBeDefined();
    expect(snapshot.sessionId).toBe(SESSION_ID);
    expect(snapshot.snapshotId).toBeDefined();
    expect(snapshot.generatedAt).toBeDefined();
    expect(snapshot.rootDescriptor).toBeDefined();
    expect(snapshot.snapshotHash).toBeDefined();
    expect(snapshot.includedFiles.length).toBe(2);

    const file1 = snapshot.includedFiles.find((f) => f.path === "file1.ts");
    expect(file1).toBeDefined();
    expect(file1!.contentHash).toBeDefined();
    expect(file1!.contentHash.length).toBe(64); // SHA-256 hex

    const file2 = snapshot.includedFiles.find((f) => f.path === "file2.ts");
    expect(file2).toBeDefined();
    expect(file2!.contentHash).toBeDefined();
  });

  it("should produce deterministic ordering", () => {
    writeFileSync(join(projectRoot, "z.ts"), "export const z = 1;");
    writeFileSync(join(projectRoot, "a.ts"), "export const a = 1;");
    writeFileSync(join(projectRoot, "m.ts"), "export const m = 1;");

    const snapshot1 = buildRepoSnapshot({
      projectRoot,
      fileList: ["z.ts", "a.ts", "m.ts"],
      sessionId: SESSION_ID,
    });

    const snapshot2 = buildRepoSnapshot({
      projectRoot,
      fileList: ["a.ts", "m.ts", "z.ts"],
      sessionId: SESSION_ID,
    });

    const paths1 = snapshot1.includedFiles.map((f) => f.path);
    const paths2 = snapshot2.includedFiles.map((f) => f.path);
    expect(paths1).toEqual(paths2);
    expect(paths1).toEqual(["a.ts", "m.ts", "z.ts"]);
  });

  it("should produce stable hash for same snapshot", () => {
    writeFileSync(join(projectRoot, "file.ts"), "export const a = 1;");

    const snapshot1 = buildRepoSnapshot({
      projectRoot,
      fileList: ["file.ts"],
      sessionId: SESSION_ID,
    });

    const snapshot2 = buildRepoSnapshot({
      projectRoot,
      fileList: ["file.ts"],
      sessionId: SESSION_ID,
    });

    expect(snapshot1.snapshotHash).toBe(snapshot2.snapshotHash);
  });

  it("should normalize paths to POSIX style", () => {
    mkdirSync(join(projectRoot, "src"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "file.ts"), "export const a = 1;");

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: [join("src", "file.ts")],
      sessionId: SESSION_ID,
    });

    const file = snapshot.includedFiles[0];
    expect(file).toBeDefined();
    expect(file!.path).not.toContain("\\");
    expect(file!.path).toMatch(/^src\/file\.ts$/);
  });

  it("should compute correct content hashes", () => {
    const content = "export const a = 1;";
    writeFileSync(join(projectRoot, "file.ts"), content);

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file.ts"],
      sessionId: SESSION_ID,
    });

    const file = snapshot.includedFiles[0];
    expect(file).toBeDefined();

    // Hash should match content
    const expectedHash = sha256Hex(content);
    expect(file!.contentHash).toBe(expectedHash);
  });

  it("should handle empty file list", () => {
    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: [],
      sessionId: SESSION_ID,
    });

    expect(snapshot.includedFiles.length).toBe(0);
    expect(snapshot.snapshotHash).toBeDefined();
  });

  it("should reject non-existent files", () => {
    expect(() => {
      buildRepoSnapshot({
        projectRoot,
        fileList: ["nonexistent.ts"],
        sessionId: SESSION_ID,
      });
    }).toThrow(SessionError);
  });

  it("should reject paths with traversal", () => {
    writeFileSync(join(projectRoot, "file.ts"), "export const a = 1;");

    expect(() => {
      buildRepoSnapshot({
        projectRoot,
        fileList: ["../file.ts"],
        sessionId: SESSION_ID,
      });
    }).toThrow(SessionError);
  });

  it("should reject paths escaping project root", () => {
    writeFileSync(join(testDir, "outside.ts"), "export const a = 1;");

    expect(() => {
      buildRepoSnapshot({
        projectRoot,
        fileList: [join("..", "outside.ts")],
        sessionId: SESSION_ID,
      });
    }).toThrow(SessionError);
  });

  it("should handle subdirectories", () => {
    mkdirSync(join(projectRoot, "src", "nested"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "file1.ts"), "export const a = 1;");
    writeFileSync(join(projectRoot, "src", "nested", "file2.ts"), "export const b = 2;");

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["src/file1.ts", "src/nested/file2.ts"],
      sessionId: SESSION_ID,
    });

    expect(snapshot.includedFiles.length).toBe(2);
    expect(snapshot.includedFiles.some((f) => f.path === "src/file1.ts")).toBe(true);
    expect(snapshot.includedFiles.some((f) => f.path === "src/nested/file2.ts")).toBe(true);
  });

  it("should use custom root descriptor", () => {
    writeFileSync(join(projectRoot, "file.ts"), "export const a = 1;");

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file.ts"],
      sessionId: SESSION_ID,
      rootDescriptor: "custom descriptor",
    });

    expect(snapshot.rootDescriptor).toBe("custom descriptor");
  });

  it("should compute snapshot hash correctly", () => {
    writeFileSync(join(projectRoot, "file.ts"), "export const a = 1;");

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file.ts"],
      sessionId: SESSION_ID,
    });

    const computedHash = computeSnapshotHash(snapshot);
    expect(computedHash).toBe(snapshot.snapshotHash);
  });

  it("should handle files with different content", () => {
    writeFileSync(join(projectRoot, "file1.ts"), "export const a = 1;");
    writeFileSync(join(projectRoot, "file2.ts"), "export const b = 2;");

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file1.ts", "file2.ts"],
      sessionId: SESSION_ID,
    });

    const file1 = snapshot.includedFiles.find((f) => f.path === "file1.ts");
    const file2 = snapshot.includedFiles.find((f) => f.path === "file2.ts");

    expect(file1!.contentHash).not.toBe(file2!.contentHash);
  });

  it("should handle files with same content", () => {
    const content = "export const a = 1;";
    writeFileSync(join(projectRoot, "file1.ts"), content);
    writeFileSync(join(projectRoot, "file2.ts"), content);

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file1.ts", "file2.ts"],
      sessionId: SESSION_ID,
    });

    const file1 = snapshot.includedFiles.find((f) => f.path === "file1.ts");
    const file2 = snapshot.includedFiles.find((f) => f.path === "file2.ts");

    expect(file1!.contentHash).toBe(file2!.contentHash);
  });

  it("should reject invalid project root", () => {
    expect(() => {
      buildRepoSnapshot({
        projectRoot: "/nonexistent/path",
        fileList: [],
        sessionId: SESSION_ID,
      });
    }).toThrow(SessionError);
  });

  it("should handle large file lists", () => {
    const files: string[] = [];
    for (let i = 0; i < 100; i++) {
      const fileName = `file${i}.ts`;
      writeFileSync(join(projectRoot, fileName), `export const a${i} = ${i};`);
      files.push(fileName);
    }

    const snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: files,
      sessionId: SESSION_ID,
    });

    expect(snapshot.includedFiles.length).toBe(100);
    expect(snapshot.includedFiles.map((f) => f.path).sort()).toEqual(
      files.sort(),
    );
  });
});
