import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { provePatchApplies } from "../src/session/patch-apply.js";
import { buildRepoSnapshot } from "../src/session/repo-snapshot.js";
import type { PatchArtifact } from "../src/session/patch-artifact.js";
import type { RepoSnapshot } from "../src/session/repo-snapshot.js";
import { SESSION_SCHEMA_VERSION } from "../src/session/schemas.js";
import { SessionError } from "../src/session/errors.js";

describe("Patch Applicability Prover", () => {
  let testDir: string;
  let projectRoot: string;
  let snapshot: RepoSnapshot;
  const SESSION_ID = "123e4567-e89b-12d3-a456-426614174000";
  const PATCH_ID = "223e4567-e89b-12d3-a456-426614174000";

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "patch-apply-test-"));
    projectRoot = join(testDir, "project");
    mkdirSync(projectRoot, { recursive: true });

    // Create test files
    writeFileSync(
      join(projectRoot, "file1.ts"),
      `export const a = 1;
export const b = 2;
export const c = 3;`,
    );

    writeFileSync(
      join(projectRoot, "file2.ts"),
      `export function func() {
  return 42;
}`,
    );

    // Build snapshot
    snapshot = buildRepoSnapshot({
      projectRoot,
      fileList: ["file1.ts", "file2.ts"],
      sessionId: SESSION_ID,
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("Hash Validation", () => {
    it("should reject wrong baseSnapshotHash", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
        baseSnapshotHash: "wrong-hash",
      } as PatchArtifact & { baseSnapshotHash: string };

      expect(() => {
        provePatchApplies(patch, snapshot, {
          projectRoot,
          allowedFiles: ["file1.ts"],
        });
      }).toThrow(SessionError);
    });

    it("should accept correct baseSnapshotHash", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
        baseSnapshotHash: snapshot.snapshotHash,
      } as PatchArtifact & { baseSnapshotHash: string };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(true);
    });
  });

  describe("File Boundary Validation", () => {
    it("should reject patch touches file outside allowedFiles", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-export const a = 1;
+export const a = 2;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file2.ts"], // file1.ts not allowed
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      expect(report.conflicts[0]!.reason).toContain("allowedFiles");
    });

    it("should accept patch touches file in allowedFiles", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(true);
    });
  });

  describe("Conflict Detection", () => {
    it("should reject hunk context mismatch", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 999; // Wrong context
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      expect(report.conflicts[0]!.reason).toContain("Context line mismatch");
    });

    it("should reject modify non-existent file", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "nonexistent.ts",
            changeType: "modify",
            diff: `--- a/nonexistent.ts
+++ b/nonexistent.ts
@@ -1,1 +1,1 @@
-export const a = 1;
+export const a = 2;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["nonexistent.ts"],
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      expect(report.conflicts[0]!.reason).toContain("does not exist");
    });

    it("should reject create existing file", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "create",
            diff: `--- /dev/null
+++ b/file1.ts
@@ -0,0 +1,1 @@
+export const new = 1;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      expect(report.conflicts[0]!.reason).toContain("already exists");
    });

    it("should reject delete non-existent file", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "nonexistent.ts",
            changeType: "delete",
            diff: `--- a/nonexistent.ts
+++ /dev/null
@@ -1,1 +0,0 @@
-export const a = 1;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowDeletes: true,
        allowedFiles: ["nonexistent.ts"],
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      expect(report.conflicts[0]!.reason).toContain("does not exist");
    });

    it("should reject delete operations by default", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "delete",
            diff: `--- a/file1.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const a = 1;
-export const b = 2;
-export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowDeletes: false, // default
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      expect(report.conflicts[0]!.reason).toContain("not allowed");
    });
  });

  describe("Clean Apply Proofs", () => {
    it("should accept clean apply proof (create)", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "newfile.ts",
            changeType: "create",
            diff: `--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,1 @@
+export const new = 1;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["newfile.ts"],
      });

      expect(report.applied).toBe(true);
      expect(report.conflicts.length).toBe(0);
      expect(report.touchedFiles.length).toBe(1);
      expect(report.touchedFiles[0]!.changeType).toBe("create");
      expect(report.touchedFiles[0]!.postHash).toBeDefined();
    });

    it("should accept clean apply proof (modify)", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(true);
      expect(report.conflicts.length).toBe(0);
      expect(report.touchedFiles.length).toBe(1);
      expect(report.touchedFiles[0]!.changeType).toBe("modify");
      expect(report.touchedFiles[0]!.preHash).toBeDefined();
      expect(report.touchedFiles[0]!.postHash).toBeDefined();
      expect(report.touchedFiles[0]!.preHash).not.toBe(
        report.touchedFiles[0]!.postHash,
      );
    });

    it("should accept clean apply proof (delete if allowed)", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "delete",
            diff: `--- a/file1.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export const a = 1;
-export const b = 2;
-export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowDeletes: true,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(true);
      expect(report.conflicts.length).toBe(0);
      expect(report.touchedFiles.length).toBe(1);
      expect(report.touchedFiles[0]!.changeType).toBe("delete");
      expect(report.touchedFiles[0]!.preHash).toBeDefined();
    });
  });

  describe("Multiple Hunks and Files", () => {
    it("should handle multiple hunks per file", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-export const a = 1;
+export const a = 2;
@@ -2,1 +2,1 @@
-export const b = 2;
+export const b = 3;
@@ -3,1 +3,1 @@
-export const c = 3;
+export const c = 4;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(true);
    });

    it("should handle multiple files", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-export const a = 1;
+export const a = 2;`,
          },
          {
            path: "file2.ts",
            changeType: "modify",
            diff: `--- a/file2.ts
+++ b/file2.ts
@@ -1,1 +1,1 @@
-export function func() {
+export function func2() {
@@ -2,1 +2,1 @@
   return 42;
 }`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts", "file2.ts"],
      });

      expect(report.applied).toBe(true);
      expect(report.touchedFiles.length).toBe(2);
    });
  });

  describe("Hash Computation", () => {
    it("should compute correct pre/post hashes", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 1;
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      const touchedFile = report.touchedFiles[0]!;
      expect(touchedFile.preHash).toBeDefined();
      expect(touchedFile.postHash).toBeDefined();

      // Verify preHash matches snapshot
      const fileSnapshot = snapshot.includedFiles.find(
        (f) => f.path === "file1.ts",
      );
      expect(touchedFile.preHash).toBe(fileSnapshot!.contentHash);

      // Verify postHash is different
      expect(touchedFile.preHash).not.toBe(touchedFile.postHash);
    });

    it("should compute reportHash correctly", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,1 @@
-export const a = 1;
+export const a = 2;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report1 = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      const report2 = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report1.reportHash).toBe(report2.reportHash);
    });
  });

  describe("Conflict Details", () => {
    it("should provide detailed conflict information", () => {
      const patch: PatchArtifact = {
        schemaVersion: SESSION_SCHEMA_VERSION,
        sessionId: SESSION_ID,
        stepId: "step-1",
        patchId: PATCH_ID,
        filesChanged: [
          {
            path: "file1.ts",
            changeType: "modify",
            diff: `--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 export const a = 999; // Wrong
-export const b = 2;
+export const b = 3;
 export const c = 3;`,
          },
        ],
        declaredImports: [],
        declaredNewDependencies: [],
      };

      const report = provePatchApplies(patch, snapshot, {
        projectRoot,
        allowedFiles: ["file1.ts"],
      });

      expect(report.applied).toBe(false);
      expect(report.conflicts.length).toBeGreaterThan(0);
      const conflict = report.conflicts[0]!;
      expect(conflict.filePath).toBe("file1.ts");
      expect(conflict.hunkIndex).toBeDefined();
      expect(conflict.reason).toBeDefined();
      expect(conflict.expectedHash).toBeDefined();
      expect(conflict.actualHash).toBeDefined();
    });
  });
});
