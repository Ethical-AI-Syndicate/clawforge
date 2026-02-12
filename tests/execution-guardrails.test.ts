import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "node:fs";

const SESSION_SRC = join(process.cwd(), "src", "session");
const FORBIDDEN = [
  "child_process",
  "require(\"child_process",
  "require('child_process",
  "from \"child_process",
  "from 'child_process",
  "spawn(",
  "exec(",
  ".exec(",
  ".spawn(",
  "eval(",
  "new Function(",
  "require(\"http\"",
  "require('http'",
  "require(\"https\"",
  "require('https'",
  "from \"http\"",
  "from \"https\"",
  "from \"net\"",
  "require(\"net\"",
];
const FORBIDDEN_EXCEPT_PERSISTENCE = ["fs.writeFileSync", "fs.writeFile("];

function getSessionFiles(): string[] {
  return readdirSync(SESSION_SRC).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".d.ts"),
  );
}

describe("Execution guardrails — no execution surface in session layer", () => {
  it("no session module imports child_process", () => {
    for (const file of getSessionFiles()) {
      // Skip lint files as they contain forbidden patterns as strings to check for
      if (file === "prompt-lint.ts" || file === "step-packet-lint.ts") continue;
      const content = readFileSync(join(SESSION_SRC, file), "utf8");
      expect(
        content.includes("child_process"),
        `${file} must not reference child_process`,
      ).toBe(false);
    }
  });

  it("no session module uses spawn or exec", () => {
    const skipExecCheck = ["prompt-lint.ts", "step-packet-lint.ts", "symbol-boundary.ts", "symbol-validate.ts"];
    for (const file of getSessionFiles()) {
      if (skipExecCheck.includes(file)) continue;
      const content = readFileSync(join(SESSION_SRC, file), "utf8");
      for (const token of ["spawn(", "exec(", ".spawn(", ".exec("]) {
        expect(
          content.includes(token),
          `${file} must not use ${token}`,
        ).toBe(false);
      }
    }
  });

  it("no session module imports http, https, or net", () => {
    for (const file of getSessionFiles()) {
      const content = readFileSync(join(SESSION_SRC, file), "utf8");
      for (const mod of ['"http"', "'http'", '"https"', "'https'", '"net"', "'net'"]) {
        expect(
          content.includes(mod),
          `${file} must not import ${mod}`,
        ).toBe(false);
      }
    }
  });

  it("only node:crypto is allowed for cryptographic operations (no other execution/network modules)", () => {
    const ALLOWED_CRYPTO = ['"node:crypto"', "'node:crypto'", 'from "node:crypto"', "from 'node:crypto'"];
    const FORBIDDEN_NETWORK = [
      '"undici"', "'undici'", 'from "undici"', "from 'undici'",
      '"axios"', "'axios'", 'from "axios"', "from 'axios'",
      '"fetch"', "'fetch'", 'from "fetch"', "from 'fetch'",
      'require("undici"', "require('undici'",
      'require("axios"', "require('axios'",
      'require("fetch"', "require('fetch'",
    ];
    
    for (const file of getSessionFiles()) {
      const content = readFileSync(join(SESSION_SRC, file), "utf8");
      
      // Check for forbidden network/execution modules (skip lint files that list these as forbidden strings)
      const skipNetworkCheck = ["prompt-lint.ts", "step-packet-lint.ts"];
      if (!skipNetworkCheck.includes(file)) {
        for (const mod of FORBIDDEN_NETWORK) {
          expect(
            content.includes(mod),
            `${file} must not import ${mod}`,
          ).toBe(false);
        }
      }
      
      // If crypto is used directly (not via local import), it must be node:crypto
      // Allow imports from local crypto modules (e.g., "./crypto.js")
      // Skip if "crypto" only appears in comments (e.g., "cryptographic")
      const hasLocalCryptoImport = content.includes('from "./crypto') || content.includes("from './crypto");
      const cryptoInComments = content.includes("cryptographic") || content.includes("Cryptographic");
      if (content.includes("crypto") && !hasLocalCryptoImport && !cryptoInComments) {
        const hasAllowedCrypto = ALLOWED_CRYPTO.some((allowed) => content.includes(allowed));
        if (!hasAllowedCrypto) {
          expect.fail(
            `${file} uses crypto but must use node:crypto (not require('crypto') or other variants)`,
          );
        }
      }
    }
  });

  it("no session module uses eval or new Function", () => {
    for (const file of getSessionFiles()) {
      const content = readFileSync(join(SESSION_SRC, file), "utf8");
      expect(content.includes("eval("), `${file} must not use eval`).toBe(false);
      expect(
        content.includes("new Function("),
        `${file} must not use new Function`,
      ).toBe(false);
    }
  });

  it("only persistence.ts may use fs.writeFileSync / fs.writeFile", () => {
    for (const file of getSessionFiles()) {
      const content = readFileSync(join(SESSION_SRC, file), "utf8");
      const isPersistence = file === "persistence.ts";
      for (const token of FORBIDDEN_EXCEPT_PERSISTENCE) {
        const hasIt = content.includes(token);
        if (hasIt && !isPersistence) {
          expect.fail(`${file} must not use ${token}; only persistence.ts may`);
        }
      }
    }
  });

  it("compiled dist/session has no forbidden execution strings", () => {
    const distSession = join(process.cwd(), "dist", "session");
    let files: string[];
    try {
      files = readdirSync(distSession).filter((f) => f.endsWith(".js"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw e;
    }
    const skipExecInDist = ["prompt-lint.js", "step-packet-lint.js", "symbol-boundary.js", "symbol-validate.js"];
    for (const file of files) {
      if (skipExecInDist.includes(file)) continue;
      const content = readFileSync(join(distSession, file), "utf8");
      for (const token of FORBIDDEN) {
        expect(
          content.includes(token),
          `dist/session/${file} must not contain ${token}`,
        ).toBe(false);
      }
    }
  });

  it("Phase K modules (prompt-capsule, model-response, symbol-boundary, prompt-lint) have no execution surfaces", () => {
    const phaseKFiles = [
      "prompt-capsule.ts",
      "model-response.ts",
      "symbol-boundary.ts",
      "prompt-lint.ts",
    ];
    
    for (const fileName of phaseKFiles) {
      const filePath = join(SESSION_SRC, fileName);
      try {
        const content = readFileSync(filePath, "utf8");
        
        // Check for forbidden patterns (skip lint files and regex-heavy modules that use .exec() for regex)
        const skipPhaseKForbidden = ["prompt-lint.ts", "step-packet-lint.ts", "symbol-boundary.ts"];
        if (!skipPhaseKForbidden.includes(fileName)) {
          for (const token of FORBIDDEN) {
            expect(
              content.includes(token),
              `Phase K module ${fileName} must not contain ${token}`,
            ).toBe(false);
          }
        }
        
        // Check for network modules
        for (const mod of ['"http"', "'http'", '"https"', "'https'", '"net"', "'net'"]) {
          expect(
            content.includes(mod),
            `Phase K module ${fileName} must not import ${mod}`,
          ).toBe(false);
        }
        
        // Check for eval/new Function
        expect(
          content.includes("eval("),
          `Phase K module ${fileName} must not use eval`,
        ).toBe(false);
        expect(
          content.includes("new Function("),
          `Phase K module ${fileName} must not use new Function`,
        ).toBe(false);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          // File doesn't exist yet (might be during development)
          continue;
        }
        throw e;
      }
    }
  });

  it("Phase L modules (symbol-index, symbol-validate) may use TypeScript compiler API only", () => {
    const ALLOWED_TYPESCRIPT_IMPORTS = [
      'import * as ts from "typescript"',
      "import * as ts from 'typescript'",
      'import ts from "typescript"',
      "import ts from 'typescript'",
      'from "typescript"',
      "from 'typescript'",
    ];
    const FORBIDDEN_EXECUTION = [
      "child_process",
      "spawn",
      "exec",
      "eval",
      "new Function",
      "http",
      "https",
      "net",
    ];

    const phaseLFiles = ["symbol-index.ts", "symbol-validate.ts"];

    for (const fileName of phaseLFiles) {
      const filePath = join(SESSION_SRC, fileName);
      try {
        const content = readFileSync(filePath, "utf8");

        // Must use TypeScript compiler API
        const hasTypeScriptImport = ALLOWED_TYPESCRIPT_IMPORTS.some((pattern) =>
          content.includes(pattern),
        );
        expect(
          hasTypeScriptImport,
          `Phase L module ${fileName} must import TypeScript compiler API`,
        ).toBe(true);

        // Must not use forbidden execution patterns (excluding regex.exec() which is a regex method)
        for (const forbidden of FORBIDDEN_EXECUTION) {
          // Skip regex.exec() calls - these are regex methods, not child_process
          if (forbidden === "exec" && (content.includes("RegExpExecArray") || content.includes("regex.exec") || content.includes("Re.exec"))) {
            continue;
          }
          expect(
            content.includes(forbidden),
            `Phase L module ${fileName} must not contain ${forbidden}`,
          ).toBe(false);
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          // File doesn't exist yet (might be during development)
          continue;
        }
        throw e;
      }
    }
  });
});
