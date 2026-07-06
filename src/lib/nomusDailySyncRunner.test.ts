import assert from "node:assert/strict";
import test from "node:test";
import {
  NOMUS_DAILY_SYNC_CONFIRM_PHRASE,
  NOMUS_DAILY_SYNC_MODE,
  NOMUS_DAILY_SYNC_SCRIPT_NAME,
} from "./nomusDailySyncConstants";
import { computeNomusDailyOverallStatus, parseDailyRunnerLogContent } from "./nomusDailySyncLogParse";
import {
  DAILY_LOG_STALE_RUNNING_MS,
  isDailyRunnerLogFileName,
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
  resolveNomusDailySyncScriptPath,
  shouldInferDailyRunningFromLog,
} from "./nomusDailySyncRunner";

test("identifica arquivo runner-daily apply", () => {
  assert.equal(isDailyRunnerLogFileName("runner-daily-apply_2026-05-28T02-00-00-000Z.log"), true);
  assert.equal(isDailyRunnerLogFileName("runner-daily-dry_2026-05-28T02-00-00-000Z.log"), true);
  assert.equal(isDailyRunnerLogFileName("customers_apply_2026.log"), false);
  assert.equal(isDailyRunnerLogFileName("sales-orders_apply_2026-05-28T12-00-00-000Z.log"), false);
});

test("parseDailyRunnerLogContent: running vs success vs skipped", () => {
  const running = parseDailyRunnerLogContent("STARTED_AT=2026-05-28T02:00:00+00:00\n");
  assert.equal(running.status, "running");

  const success = parseDailyRunnerLogContent(
    "STARTED_AT=2026-05-28T02:00:00+00:00\nEXIT_CODE=0\nFINISHED_AT=2026-05-28T04:00:00+00:00\n"
  );
  assert.equal(success.status, "success");

  const failed = parseDailyRunnerLogContent(
    "STARTED_AT=2026-05-28T02:00:00+00:00\nEXIT_CODE=1\nFINISHED_AT=2026-05-28T03:00:00+00:00\n"
  );
  assert.equal(failed.status, "failed");

  const skipped = parseDailyRunnerLogContent(
    "[nomus-daily-runner] SKIPPED: outra execução diária ainda está em andamento.\nFINISHED_AT=2026-05-28T02:00:01+00:00\n"
  );
  assert.equal(skipped.status, "skipped");
});

test("isNomusDailySyncRunning: log sem FINISHED_AT não implica rodando sem processo", () => {
  const parsed = parseDailyRunnerLogContent("STARTED_AT=2026-05-28T02:00:00+00:00\n");
  const r = computeNomusDailyOverallStatus({
    hasLiveProcess: false,
    hasActiveLock: false,
    parsed,
  });
  assert.equal(r.isActuallyRunning, false);
  assert.notEqual(r.overallStatus, "RUNNING");
});

test("pgrep: só status 0 indica processo ativo", () => {
  assert.equal(isProcessActiveFromPgrepStatus(0), true);
  assert.equal(isProcessActiveFromPgrepStatus(1), false);
});

test("flock: exit 0 = lock livre; exit ≠ 0 = ocupado", () => {
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(0), false);
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(1), true);
});

test("inferência legada por log: running recente", () => {
  const running = parseDailyRunnerLogContent("STARTED_AT=2026-05-28T02:00:00+00:00\n");
  assert.equal(shouldInferDailyRunningFromLog(running, 60_000), true);
  assert.equal(
    shouldInferDailyRunningFromLog(running, DAILY_LOG_STALE_RUNNING_MS + 1),
    false
  );
});

test("lock file no disco sem flock ativo não marca running", () => {
  assert.equal(
    computeNomusDailyOverallStatus({
      hasLiveProcess: false,
      hasActiveLock: false,
      parsed: parseDailyRunnerLogContent("STARTED_AT=2026-06-03T02:00:01\n"),
    }).overallStatus,
    "STALE"
  );
});

test("frase de confirmação esperada na UI", () => {
  assert.equal(NOMUS_DAILY_SYNC_CONFIRM_PHRASE, "RODAR ROTINA DIÁRIA NOMUS");
});

test("rotina fixa: script e modo", () => {
  assert.equal(NOMUS_DAILY_SYNC_SCRIPT_NAME, "runNomusDailySync.sh");
  assert.equal(NOMUS_DAILY_SYNC_MODE, "apply");
  assert.match(resolveNomusDailySyncScriptPath(process.cwd()), /scripts[\\/]runNomusDailySync\.sh$/);
});
