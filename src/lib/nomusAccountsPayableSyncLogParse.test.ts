import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  NOMUS_AP_SYNC_CONFIRM_PHRASE,
  NOMUS_AP_SYNC_MODE,
  NOMUS_AP_SYNC_SCRIPT_NAME,
} from "./nomusAccountsPayableSyncConstants.js";
import {
  buildApRecommendedAction,
  computeApOverallStatus,
  isApRunnerLogFileName,
  parseApRunnerLogContent,
  parseApDurationMs,
} from "./nomusAccountsPayableSyncLogParse.js";
import {
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
} from "./nomusDailySyncRunnerShared.js";
import {
  NomusAccountsPayableSyncConflictError,
  resolveNomusAccountsPayableSyncScriptPath,
} from "./nomusAccountsPayableSyncRunner.js";

test("identifica arquivo runner accounts-payable apply", () => {
  assert.equal(
    isApRunnerLogFileName("runner-accounts-payable_apply_2026-06-06T15-00-00-000Z.log"),
    true
  );
  assert.equal(isApRunnerLogFileName("runner-accounts-receivable_apply_2026.log"), false);
  assert.equal(isApRunnerLogFileName("runner-daily-apply_2026.log"), false);
});

test("parseApRunnerLogContent: running vs success vs failed vs skipped", () => {
  const running = parseApRunnerLogContent("STARTED_AT=2026-06-06T15:00:00+00:00\n");
  assert.equal(running.status, "running");

  const success = parseApRunnerLogContent(
    [
      "STARTED_AT=2026-06-06T15:00:00+00:00",
      "EXIT_CODE=0",
      "FINISHED_AT=2026-06-06T15:10:00+00:00",
      '{"summary":{"pagesRead":42,"recordsRead":1200,"mapped":1200,"syncStrategy":"full_refresh_upsert"},"applied":{"created":5,"updated":10,"unchanged":1185,"errors":0}}',
    ].join("\n")
  );
  assert.equal(success.status, "success");
  assert.equal(success.metrics.pagesRead, 42);
  assert.equal(success.metrics.recordsRead, 1200);
  assert.equal(success.metrics.updated, 10);
  assert.equal(success.syncStrategy, "full_refresh_upsert");

  const failed = parseApRunnerLogContent(
    "STARTED_AT=2026-06-06T15:00:00+00:00\nEXIT_CODE=1\nFINISHED_AT=2026-06-06T15:05:00+00:00\n"
  );
  assert.equal(failed.status, "failed");

  const skipped = parseApRunnerLogContent(
    "[nomus-accounts-payable-runner] SKIPPED: outra execução de Contas a Pagar ainda está em andamento.\nFINISHED_AT=2026-06-06T15:00:01+00:00\nEXIT_CODE=0\n"
  );
  assert.equal(skipped.status, "skipped");
});

test("computeApOverallStatus: log sem FINISHED_AT não implica RUNNING sem processo", () => {
  const parsed = parseApRunnerLogContent("STARTED_AT=2026-06-06T15:00:00+00:00\n");
  const r = computeApOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    logAgeMs: 60_000,
  });
  assert.equal(r.isActuallyRunning, false);
  assert.notEqual(r.overallStatus, "RUNNING");
  assert.equal(r.overallStatus, "STALE");
});

test("computeApOverallStatus: RUNNING com processo vivo", () => {
  const parsed = parseApRunnerLogContent("STARTED_AT=2026-06-06T15:00:00+00:00\n");
  const r = computeApOverallStatus({
    hasLiveProcess: true,
    hasActiveLock: false,
    parsed,
    logAgeMs: 60_000,
  });
  assert.equal(r.overallStatus, "RUNNING");
  assert.equal(r.isActuallyRunning, true);
});

test("computeApOverallStatus: SUCCESS recente", () => {
  const parsed = parseApRunnerLogContent(
    "STARTED_AT=2026-06-06T15:00:00+00:00\nEXIT_CODE=0\nFINISHED_AT=2026-06-06T15:10:00+00:00\n"
  );
  const r = computeApOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
    logAgeMs: 30 * 60 * 1000,
  });
  assert.equal(r.overallStatus, "SUCCESS");
});

test("buildApRecommendedAction orienta em falha e stale", () => {
  assert.match(
    buildApRecommendedAction({ overallStatus: "FAILED", parsed: parseApRunnerLogContent("") }) ?? "",
    /log/i
  );
  assert.match(
    buildApRecommendedAction({ overallStatus: "STALE", parsed: parseApRunnerLogContent("") }) ?? "",
    /manual/i
  );
});

test("parseApDurationMs calcula intervalo", () => {
  assert.equal(
    parseApDurationMs("2026-06-06T15:00:00+00:00", "2026-06-06T15:10:00+00:00"),
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
    "Authorization: Bearer secret-token-xyz\n[nomus-accounts-payable] falha conexão\n";
  assert.doesNotMatch(content.replace(/Bearer\s+\S+/gi, "Bearer ***"), /secret-token-xyz/);
});

test("NomusAccountsPayableSyncConflictError para resposta 409", () => {
  const err = new NomusAccountsPayableSyncConflictError();
  assert.equal(err.name, "NomusAccountsPayableSyncConflictError");
  assert.match(err.message, /andamento/i);
});

test("script e frase de confirmação", () => {
  assert.equal(NOMUS_AP_SYNC_SCRIPT_NAME, "runNomusAccountsPayableSync.sh");
  assert.equal(NOMUS_AP_SYNC_MODE, "apply");
  assert.equal(NOMUS_AP_SYNC_CONFIRM_PHRASE, "RODAR CONTAS A PAGAR NOMUS");
  assert.match(
    resolveNomusAccountsPayableSyncScriptPath(process.cwd()),
    /scripts[\\/]runNomusAccountsPayableSync\.sh$/
  );
});

test("runner shell tem shebang e referencia lock dedicado", () => {
  const scriptPath = resolveNomusAccountsPayableSyncScriptPath(process.cwd());
  const content = readFileSync(scriptPath, "utf8");
  assert.match(content, /^#!\/usr\/bin\/env bash/m);
  assert.match(content, /induscost-nomus-accounts-payable\.lock/);
  assert.match(content, /runner-accounts-payable_/);
  assert.match(content, /NOMUS_AP_INCREMENTAL=1/);
  assert.doesNotMatch(content, /secret-token/);
});

test("lock dedicado AP não usa lock AR", () => {
  const scriptPath = path.join(process.cwd(), "scripts", NOMUS_AP_SYNC_SCRIPT_NAME);
  const content = readFileSync(scriptPath, "utf8");
  assert.doesNotMatch(content, /accounts-receivable\.lock/);
});
