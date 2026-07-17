/**
 * DS-03.10 — testes da integração do sync de Documentos de Saída.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeStockDocumentsIncrementalWindow,
} from "./nomusStockDocumentsSyncLifecycle.js";
import { parseStockDocumentsSyncCli } from "./nomusStockDocumentsSyncLogic.js";
import {
  isStockDocumentsRunnerLogFileName,
  parseStockDocumentsRunnerLogContent,
  computeStockDocumentsOverallStatus,
} from "./nomusStockDocumentsSyncLogParse.js";
import {
  NOMUS_STOCK_DOCUMENTS_SCHEDULE_HINT,
  NOMUS_STOCK_DOCUMENTS_SYNC_TARGET,
} from "./nomusStockDocumentsSyncConstants.js";

describe("DS-03.10 stock documents sync integration", () => {
  it("target oficial usa hífen (health registry)", () => {
    assert.equal(NOMUS_STOCK_DOCUMENTS_SYNC_TARGET, "stock-documents");
    assert.ok(NOMUS_STOCK_DOCUMENTS_SCHEDULE_HINT.includes("23 */2"));
  });

  it("janela incremental a partir do checkpoint com overlap", () => {
    const window = computeStockDocumentsIncrementalWindow({
      checkpointTo: "2026-07-10",
      now: new Date("2026-07-17T12:00:00.000Z"),
      overlapDays: 7,
    });
    assert.equal(window.source, "checkpoint_overlap");
    assert.equal(window.from, "2026-07-03");
    assert.equal(window.to, "2026-07-17");
  });

  it("janela inicial usa lookback quando não há checkpoint", () => {
    const window = computeStockDocumentsIncrementalWindow({
      checkpointTo: null,
      now: new Date("2026-07-17T12:00:00.000Z"),
      lookbackDays: 14,
    });
    assert.equal(window.source, "initial_lookback");
    assert.equal(window.from, "2026-07-03");
    assert.equal(window.to, "2026-07-17");
  });

  it("CLI aceita incremental sem --from/--to", () => {
    const cli = parseStockDocumentsSyncCli(["apply"], {
      NOMUS_STOCK_DOCUMENTS_INCREMENTAL: "1",
    });
    assert.equal(cli.mode, "apply");
    assert.equal(cli.from, null);
    assert.equal(cli.to, null);
  });

  it("CLI ainda exige janela sem incremental", () => {
    assert.throws(
      () => parseStockDocumentsSyncCli(["preview"], {}),
      /INCREMENTAL|from|idNfe/i
    );
  });

  it("parseia log do runner com soft-fail SKIPPED", () => {
    assert.equal(
      isStockDocumentsRunnerLogFileName(
        "runner-stock-documents_apply_2026-07-17T12-00-00-000Z.log"
      ),
      true
    );
    const parsed = parseStockDocumentsRunnerLogContent(`
STARTED_AT=2026-07-17T12:00:00-03:00
SYNC_STRATEGY=incremental_window_upsert
[nomus-stock-documents-runner] SKIPPED: outra execução ainda em andamento.
FINISHED_AT=2026-07-17T12:00:01-03:00
EXIT_CODE=0
`);
    assert.equal(parsed.skipped, true);
    assert.equal(parsed.status, "skipped");
    assert.equal(parsed.syncStrategy, "incremental_window_upsert");

    const overall = computeStockDocumentsOverallStatus({
      hasLiveProcess: false,
      hasActiveLock: false,
      parsed,
      logAgeMs: 1000,
    });
    assert.equal(overall.overallStatus, "SKIPPED");
  });
});
