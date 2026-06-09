import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNfeOverallStatus,
  isNfeRunnerLogFileName,
  parseNfeRunnerLogContent,
} from "./nomusNfesSyncLogParse.js";

describe("nomusNfesSyncLogParse", () => {
  it("isNfeRunnerLogFileName matches runner pattern", () => {
    assert.equal(isNfeRunnerLogFileName("runner-nfes_apply_2026-01-01.log"), true);
    assert.equal(isNfeRunnerLogFileName("runner-accounts-payable_apply_x.log"), false);
  });

  it("parseNfeRunnerLogContent reads success summary", () => {
    const content = `STARTED_AT=2026-05-28T10:00:00+00:00
FINISHED_AT=2026-05-28T10:05:00+00:00
EXIT_CODE=0
{"summary":{"pagesRead":2,"recordsRead":80,"mapped":75,"syncStrategy":"incremental_overlap_upsert"},"applied":{"created":1,"updated":2,"unchanged":72,"errors":0}}
`;
    const parsed = parseNfeRunnerLogContent(content);
    assert.equal(parsed.status, "success");
    assert.equal(parsed.metrics.pagesRead, 2);
    assert.equal(parsed.metrics.mapped, 75);
    assert.equal(parsed.metrics.created, 1);
  });

  it("parseNfeRunnerLogContent detects skipped lock", () => {
    const parsed = parseNfeRunnerLogContent(
      "SKIPPED: outra execução de NF-e ainda está em andamento.\nFINISHED_AT=2026-05-28T10:00:00+00:00\nEXIT_CODE=0"
    );
    assert.equal(parsed.status, "skipped");
    assert.equal(parsed.skipped, true);
  });

  it("computeNfeOverallStatus running when lock held", () => {
    const status = computeNfeOverallStatus({
      hasLiveProcess: false,
      hasActiveLock: true,
      parsed: parseNfeRunnerLogContent(""),
      logAgeMs: 1000,
    });
    assert.equal(status.overallStatus, "RUNNING");
  });
});
