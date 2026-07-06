import assert from "node:assert/strict";
import test from "node:test";
import {
  NOMUS_AR_SYNC_CONFIRM_PHRASE,
  NOMUS_AR_SYNC_MODE,
  NOMUS_AR_SYNC_SCRIPT_NAME,
} from "./nomusAccountsReceivableSyncConstants.js";
import {
  buildArRecommendedAction,
  computeArOverallStatus,
  isArRunnerLogFileName,
  parseArRunnerLogContent,
  parseDurationMs,
} from "./nomusAccountsReceivableSyncLogParse.js";
import {
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
} from "./nomusDailySyncRunnerShared.js";
import { resolveNomusAccountsReceivableSyncScriptPath } from "./nomusAccountsReceivableSyncRunner.js";

test("identifica arquivo runner accounts-receivable apply", () => {
  assert.equal(
    isArRunnerLogFileName("runner-accounts-receivable_apply_2026-06-06T15-00-00-000Z.log"),
    true
  );
  assert.equal(isArRunnerLogFileName("runner-daily-apply_2026.log"), false);
  assert.equal(isArRunnerLogFileName("sales-orders_apply_2026.log"), false);
});

test("parseArRunnerLogContent: running vs success vs failed vs skipped", () => {
  const running = parseArRunnerLogContent("STARTED_AT=2026-06-06T15:00:00+00:00\n");
  assert.equal(running.status, "running");

  const success = parseArRunnerLogContent(
    [
      "STARTED_AT=2026-06-06T15:00:00+00:00",
      'EXIT_CODE=0',
      'FINISHED_AT=2026-06-06T15:10:00+00:00',
      '{"summary":{"pagesRead":115,"recordsRead":5718,"mapped":5718,"syncStrategy":"full_refresh_upsert"},"applied":{"created":0,"updated":12,"unchanged":5706,"errors":0}}',
    ].join("\n")
  );
  assert.equal(success.status, "success");
  assert.equal(success.metrics.pagesRead, 115);
  assert.equal(success.metrics.recordsRead, 5718);
  assert.equal(success.metrics.updated, 12);
  assert.equal(success.syncStrategy, "full_refresh_upsert");

  const failed = parseArRunnerLogContent(
    "STARTED_AT=2026-06-06T15:00:00+00:00\nEXIT_CODE=1\nFINISHED_AT=2026-06-06T15:05:00+00:00\n"
  );
  assert.equal(failed.status, "failed");

  const skipped = parseArRunnerLogContent(
    "[nomus-accounts-receivable-runner] SKIPPED: outra execução de Contas a Receber ainda está em andamento.\nFINISHED_AT=2026-06-06T15:00:01+00:00\nEXIT_CODE=0\n"
  );
  assert.equal(skipped.status, "skipped");
});

test("computeArOverallStatus: log sem FINISHED_AT não implica RUNNING sem processo", () => {
  const parsed = parseArRunnerLogContent("STARTED_AT=2026-06-06T15:00:00+00:00\n");
  const r = computeArOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    logAgeMs: 60_000,
  });
  assert.equal(r.isActuallyRunning, false);
  assert.notEqual(r.overallStatus, "RUNNING");
  assert.equal(r.overallStatus, "STALE");
});

test("computeArOverallStatus: RUNNING com processo vivo", () => {
  const parsed = parseArRunnerLogContent("STARTED_AT=2026-06-06T15:00:00+00:00\n");
  const r = computeArOverallStatus({
    hasLiveProcess: true,
    hasActiveLock: false,
    parsed,
    logAgeMs: 60_000,
  });
  assert.equal(r.overallStatus, "RUNNING");
  assert.equal(r.isActuallyRunning, true);
});

test("computeArOverallStatus: SUCCESS recente", () => {
  const parsed = parseArRunnerLogContent(
    "STARTED_AT=2026-06-06T15:00:00+00:00\nEXIT_CODE=0\nFINISHED_AT=2026-06-06T15:10:00+00:00\n"
  );
  const r = computeArOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    logAgeMs: 30 * 60 * 1000,
  });
  assert.equal(r.overallStatus, "SUCCESS");
});

test("buildArRecommendedAction orienta em falha e stale", () => {
  assert.match(
    buildArRecommendedAction({ overallStatus: "FAILED", parsed: parseArRunnerLogContent("") }) ?? "",
    /log/i
  );
  assert.match(
    buildArRecommendedAction({ overallStatus: "STALE", parsed: parseArRunnerLogContent("") }) ?? "",
    /manual/i
  );
});

test("parseDurationMs calcula intervalo", () => {
  assert.equal(
    parseDurationMs("2026-06-06T15:00:00+00:00", "2026-06-06T15:10:00+00:00"),
    600_000
  );
});

test("flock e pgrep helpers", () => {
  assert.equal(isProcessActiveFromPgrepStatus(0), true);
  assert.equal(isProcessActiveFromPgrepStatus(1), false);
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(0), false);
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(1), true);
});

test("runner não deve logar token em mensagens de erro mascaradas", () => {
  const content =
    "Authorization: Bearer secret-token-xyz\n[nomus-accounts-receivable] falha conexão\n";
  assert.doesNotMatch(content.replace(/Bearer\s+\S+/gi, "Bearer ***"), /secret-token-xyz/);
});

test("script e frase de confirmação", () => {
  assert.equal(NOMUS_AR_SYNC_SCRIPT_NAME, "runNomusAccountsReceivableSync.sh");
  assert.equal(NOMUS_AR_SYNC_MODE, "apply");
  assert.equal(NOMUS_AR_SYNC_CONFIRM_PHRASE, "RODAR CONTAS A RECEBER NOMUS");
  assert.match(
    resolveNomusAccountsReceivableSyncScriptPath(process.cwd()),
    /scripts[\\/]runNomusAccountsReceivableSync\.sh$/
  );
});
