import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecommendedAction,
  computeNomusDailyOverallStatus,
  parseDailyRunnerLogContent,
  parseDailyRunnerSteps,
} from "./nomusDailySyncLogParse";

const PRODUCTS_TIMEOUT_LOG = `
STARTED_AT=2026-06-03T02:00:01+00:00
=== EXECUTANDO TARGET: customers ===
TARGET_STARTED_AT=2026-06-03T02:00:05+00:00
TARGET_EXIT_CODE=0
TARGET_FINISHED_AT=2026-06-03T02:15:00+00:00
=== EXECUTANDO TARGET: products ===
TARGET_STARTED_AT=2026-06-03T02:17:00+00:00
[nomus-products-v1] página 10 lida com 50 produtos acumulado=500
TypeError fetch failed UND_ERR_SOCKET timeout
TARGET_EXIT_CODE=1
TARGET_FINISHED_AT=2026-06-03T02:45:00+00:00
[nomus-daily-runner] ERRO: target products falhou. Interrompendo fila.
`.trim();

test("parse: falha em products sem FINISHED_AT global → terminalFailure", () => {
  const parsed = parseDailyRunnerLogContent(PRODUCTS_TIMEOUT_LOG);
  assert.equal(parsed.terminalFailure, true);
  assert.notEqual(parsed.status, "running");
  const products = parsed.steps.find((s) => s.target === "products");
  assert.equal(products?.exitCode, 1);
  assert.equal(parsed.steps.find((s) => s.target === "customers")?.exitCode, 0);
});

test("overall: log antigo sem processo → STALE", () => {
  const parsed = parseDailyRunnerLogContent("STARTED_AT=2026-06-03T02:00:01+00:00\n");
  const r = computeNomusDailyOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    now: new Date("2026-06-03T12:00:00Z"),
  });
  assert.equal(r.overallStatus, "STALE");
  assert.equal(r.isActuallyRunning, false);
  assert.ok(r.staleReason);
});

test("overall: products falhou após customers → PARTIAL_FAILED sem spinner", () => {
  const parsed = parseDailyRunnerLogContent(PRODUCTS_TIMEOUT_LOG);
  const r = computeNomusDailyOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    now: new Date("2026-06-03T03:00:00Z"),
  });
  assert.equal(r.overallStatus, "PARTIAL_FAILED");
  assert.equal(r.isActuallyRunning, false);
});

test("overall: processo vivo → RUNNING", () => {
  const parsed = parseDailyRunnerLogContent(PRODUCTS_TIMEOUT_LOG);
  const r = computeNomusDailyOverallStatus({
    hasLiveProcess: true,
    hasActiveLock: false,
    parsed,
  });
  assert.equal(r.overallStatus, "RUNNING");
  assert.equal(r.isActuallyRunning, true);
});

test("overall: sucesso com FINISHED_AT", () => {
  const parsed = parseDailyRunnerLogContent(
    "STARTED_AT=2026-06-03T02:00:00+00:00\nEXIT_CODE=0\nFINISHED_AT=2026-06-03T05:00:00+00:00\n"
  );
  const r = computeNomusDailyOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    now: new Date("2026-06-03T06:00:00Z"),
  });
  assert.equal(r.overallStatus, "SUCCESS");
});

test("recommendedAction: timeout products", () => {
  const parsed = parseDailyRunnerLogContent(PRODUCTS_TIMEOUT_LOG);
  const failed = parsed.steps.filter((s) => s.exitCode != null && s.exitCode !== 0);
  const msg = buildRecommendedAction({
    overallStatus: "PARTIAL_FAILED",
    failedSteps: failed,
    lastErrorLine: parsed.lastErrorLine,
  });
  assert.ok(msg?.includes("Produtos"));
  assert.ok(msg?.includes("UND_ERR_SOCKET") || msg?.includes("timeout") || msg?.includes("rede"));
});

test("parseDailyRunnerSteps extrai customers e products", () => {
  const steps = parseDailyRunnerSteps(PRODUCTS_TIMEOUT_LOG);
  assert.equal(steps.length, 2);
  assert.equal(steps[0]?.target, "customers");
  assert.equal(steps[1]?.target, "products");
});
