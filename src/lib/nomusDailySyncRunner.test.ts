import assert from "node:assert/strict";
import test from "node:test";
import {
  NOMUS_DAILY_SYNC_CONFIRM_PHRASE,
  NOMUS_DAILY_SYNC_MODE,
  NOMUS_DAILY_SYNC_SCRIPT_NAME,
} from "./nomusDailySyncConstants";
import {
  isDailyRunnerLogFileName,
  parseDailyRunnerLogContent,
  resolveNomusDailySyncScriptPath,
} from "./nomusDailySyncRunner";

test("identifica arquivo runner-daily apply", () => {
  assert.equal(isDailyRunnerLogFileName("runner-daily-apply_2026-05-28T02-00-00-000Z.log"), true);
  assert.equal(isDailyRunnerLogFileName("customers_apply_2026.log"), false);
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

test("rotina fixa: script e modo não são parametrizáveis pelo runner", () => {
  assert.equal(NOMUS_DAILY_SYNC_SCRIPT_NAME, "runNomusDailySync.sh");
  assert.equal(NOMUS_DAILY_SYNC_MODE, "apply");
  const scriptPath = resolveNomusDailySyncScriptPath(process.cwd());
  assert.match(scriptPath, /scripts[\\/]runNomusDailySync\.sh$/);
});

test("frase de confirmação esperada na UI", () => {
  assert.equal(NOMUS_DAILY_SYNC_CONFIRM_PHRASE, "RODAR ROTINA DIÁRIA NOMUS");
});
