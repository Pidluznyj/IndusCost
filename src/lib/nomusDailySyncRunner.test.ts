import assert from "node:assert/strict";
import test from "node:test";
import {
  NOMUS_DAILY_SYNC_CONFIRM_PHRASE,
  NOMUS_DAILY_SYNC_MODE,
  NOMUS_DAILY_SYNC_SCRIPT_NAME,
} from "./nomusDailySyncConstants";
import {
  DAILY_LOG_STALE_RUNNING_MS,
  isDailyRunnerLogFileName,
  isGlobalNomusSyncLockHeldFromFlockProbe,
  isProcessActiveFromPgrepStatus,
  parseDailyRunnerLogContent,
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

test("pgrep: só status 0 indica processo ativo", () => {
  assert.equal(isProcessActiveFromPgrepStatus(0), true);
  assert.equal(isProcessActiveFromPgrepStatus(1), false);
  assert.equal(isProcessActiveFromPgrepStatus(null), false);
});

test("flock: exit 0 = lock livre; exit ≠ 0 = ocupado (arquivo stale no disco não basta)", () => {
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(0), false);
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(1), true);
  assert.equal(isGlobalNomusSyncLockHeldFromFlockProbe(null), false);
});

test("inferência por log: só runner-daily recente sem FINISHED_AT", () => {
  const running = parseDailyRunnerLogContent("STARTED_AT=2026-05-28T02:00:00+00:00\n");
  assert.equal(shouldInferDailyRunningFromLog(running, 60_000), true);
  assert.equal(
    shouldInferDailyRunningFromLog(running, DAILY_LOG_STALE_RUNNING_MS + 1),
    false
  );

  const success = parseDailyRunnerLogContent(
    "STARTED_AT=2026-05-28T02:00:00+00:00\nFINISHED_AT=2026-05-28T04:00:00+00:00\nEXIT_CODE=0\n"
  );
  assert.equal(shouldInferDailyRunningFromLog(success, 60_000), false);
});

test("logs sales-orders não entram no filtro runner-daily", () => {
  assert.equal(isDailyRunnerLogFileName("sales-orders_apply_2026-05-28T12-00-00-000Z.log"), false);
});

test("ausência de runner-daily não marca running via parse", () => {
  const parsed = parseDailyRunnerLogContent("");
  assert.equal(parsed.status, "idle");
  assert.equal(shouldInferDailyRunningFromLog(parsed, 0), false);
});

test("rotina fixa: script e modo não são parametrizáveis pelo runner", () => {
  assert.equal(NOMUS_DAILY_SYNC_SCRIPT_NAME, "runNomusDailySync.sh");
  assert.equal(NOMUS_DAILY_SYNC_MODE, "apply");
  const scriptPath = resolveNomusDailySyncScriptPath(process.cwd());
  assert.match(scriptPath, /scripts[\\/]runNomusDailySync\.sh$/);
});

test("frase de confirmação esperada na UI", () => {
  assert.equal(NOMUS_DAILY_SYNC_CONFIRM_PHRASE, "RODAR ROTINA DIÁRIA NOMUS");
});
