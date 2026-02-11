#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  DefinitionOfDoneSchema,
  DecisionLockSchema,
} = require("./dist/session");

const { evaluateExecutionGate } = require("./dist/session/gate");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fail(reason, exitCode) {
  console.error("❌ Phase E Review Failed");
  console.error(reason);
  process.exit(exitCode || 3);
}

const sessionDir = path.join(__dirname, "sessions", "clawforge-v0-phase-e");

const dodPath = path.join(sessionDir, "dod.json");
const lockPath = path.join(sessionDir, "decision-lock.json");

if (!fs.existsSync(dodPath)) fail("dod.json not found", 1);
if (!fs.existsSync(lockPath)) fail("decision-lock.json not found", 1);

const dod = loadJson(dodPath);
const lock = loadJson(lockPath);

console.log("Reviewing session:", sessionDir);
console.log("—".repeat(60));

// 1. Schema validation
console.log("1. Schema validation");

const dodResult = DefinitionOfDoneSchema.safeParse(dod);
const lockResult = DecisionLockSchema.safeParse(lock);

if (!dodResult.success) {
  console.error("❌ Definition of Done invalid");
  console.error(dodResult.error.format());
  process.exit(1);
}

if (!lockResult.success) {
  console.error("❌ Decision Lock invalid");
  console.error(lockResult.error.format());
  process.exit(1);
}

console.log("✅ Schemas valid");
console.log();

// 2. Gate evaluation
console.log("2. Execution gate evaluation");

const gateResult = evaluateExecutionGate(dod, lock);
console.log(JSON.stringify(gateResult, null, 2));

if (!gateResult.passed) {
  console.error("❌ Gate failed — execution prohibited");
  process.exit(2);
}

console.log();

// 3. Execution plan lint
console.log("3. Execution plan lint");

const planPath = path.join(sessionDir, "execution-plan.json");
if (!fs.existsSync(planPath)) {
  fail("execution-plan.json not found in session directory");
}

const executionPlan = loadJson(planPath);

(async () => {
  const { lintExecutionPlan } = await import(
    path.join(__dirname, "dist", "session", "execution-plan-lint.js")
  );
  try {
    lintExecutionPlan(executionPlan, dod, lock.goal);
  } catch (e) {
    fail(e.message);
  }
  console.log("✅ Execution plan lint passed");
  console.log();

  // 4. Reviewer pipeline
  console.log("4. Reviewer pipeline validation");

  const envelopePath = path.join(sessionDir, "step-envelope.json");
  const patchPath = path.join(sessionDir, "patch-artifact.json");

  if (!fs.existsSync(envelopePath)) {
    fail("step-envelope.json not found");
  }
  if (!fs.existsSync(patchPath)) {
    fail("patch-artifact.json not found");
  }

  const stepEnvelope = loadJson(envelopePath);
  const patchArtifact = loadJson(patchPath);

  const { reviewStep } = await import(
    path.join(__dirname, "dist", "session", "reviewer-orchestrator.js")
  );

  let reviewResult;
  try {
    reviewResult = reviewStep({
      stepEnvelope,
      patchArtifact,
      dod,
      decisionLock: lock,
    });
  } catch (e) {
    fail(`Review step threw: ${e.message}`);
  }

  if (!reviewResult.passed) {
    console.error(`❌ Review failed at role: ${reviewResult.failedAt}`);
    for (const report of reviewResult.reports) {
      if (!report.passed) {
        for (const v of report.violations) {
          console.error(`  [${v.ruleId}] ${v.message}`);
        }
      }
    }
    process.exit(3);
  }

  console.log(`✅ All ${reviewResult.reports.length} reviewers passed`);
  console.log();

  // 5. Verify reviewer reports persisted
  console.log("5. Verify reviewer reports persisted");

  const { readReviewerReports } = await import(
    path.join(__dirname, "dist", "session", "persistence.js")
  );

  const sessionsRoot = path.join(__dirname, "sessions");
  const sessionId = dod.sessionId;
  const reports = readReviewerReports(sessionsRoot, sessionId, stepEnvelope.stepId);

  if (reports.length > 0) {
    console.log(`✅ Found ${reports.length} persisted reviewer report(s)`);
  } else {
    console.log("⚠️  No persisted reviewer reports found (expected if not yet written)");
  }

  console.log();
  console.log("✅ Phase E review complete — all checks passed");
  process.exit(0);
})().catch((err) => {
  console.error("❌ Phase E review failed");
  console.error(err);
  process.exit(3);
});
