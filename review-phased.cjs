#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const {
  DefinitionOfDoneSchema,
  DecisionLockSchema
} = require("./dist/session");

const { evaluateExecutionGate } = require("./dist/session/gate");

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function fail(reason) {
  console.error("❌ Execution Plan Sanity Check Failed");
  console.error(reason);
  process.exit(3);
}

const sessionDir = path.join(__dirname, "sessions", "clawforge-v0-phase-d");

const dodPath = path.join(sessionDir, "dod.json");
const lockPath = path.join(sessionDir, "decision-lock.json");

const dod = loadJson(dodPath);
const lock = loadJson(lockPath);

const planPath = path.join(sessionDir, "execution-plan.json");

if (!fs.existsSync(planPath)) {
  fail("execution-plan.json not found in session directory");
}

function sanityCheckExecutionPlan(plan, dod, lock) {
  // Basic identity checks
  if (plan.sessionId !== dod.sessionId) {
    fail("executionPlan.sessionId does not match DoD sessionId");
  }

  if (plan.dodId !== dod.dodId) {
    fail("executionPlan.dodId does not match DoD dodId");
  }

  if (plan.lockId !== lock.lockId) {
    fail("executionPlan.lockId does not match Decision Lock lockId");
  }

  // Steps must exist
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    fail("executionPlan.steps must be a non-empty array");
  }

  // Step IDs must be unique and ordered
  const stepIds = plan.steps.map(s => s.stepId);
  const uniqueStepIds = new Set(stepIds);

  if (uniqueStepIds.size !== stepIds.length) {
    fail("executionPlan.stepIds must be unique");
  }

  // Every step must be explicitly constrained
  for (const step of plan.steps) {
    if (typeof step.aiAllowed !== "boolean") {
      fail(`step ${step.stepId} missing explicit aiAllowed flag`);
    }

    if (!step.verification) {
      fail(`step ${step.stepId} missing verification block`);
    }

    if (!step.verification.method) {
      fail(`step ${step.stepId} verification.method missing`);
    }
  }

  // Forbidden actions must exist (guardrail proof)
  if (!Array.isArray(plan.forbiddenActions) || plan.forbiddenActions.length === 0) {
    fail("executionPlan.forbiddenActions must be explicitly listed");
  }

  // No new goals allowed
  const planText = JSON.stringify(plan);
  if (!planText.includes(lock.goal)) {
    fail("executionPlan does not reference Decision Lock goal text");
  }

  // Completion criteria must exist
  if (!Array.isArray(plan.completionCriteria) || plan.completionCriteria.length === 0) {
    fail("executionPlan.completionCriteria missing or empty");
  }

  console.log("✅ Execution plan sanity checks passed");
}

const executionPlan = loadJson(planPath);

console.log("Reviewing session:", sessionDir);
console.log("—".repeat(60));

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

console.log("2. Execution gate evaluation");

const gateResult = evaluateExecutionGate(dod, lock);

console.log(JSON.stringify(gateResult, null, 2));

if (!gateResult.passed) {
  console.error("❌ Gate failed — execution prohibited");
  process.exit(2);
}

console.log();
console.log("3. Execution plan sanity checks");

sanityCheckExecutionPlan(executionPlan, dod, lock);

console.log("4. Execution plan lint");

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
  console.log("✅ Gate passed — execution would be permitted");
  process.exit(0);
})().catch((err) => {
  console.error("❌ Execution plan lint failed");
  console.error(err);
  process.exit(3);
});
