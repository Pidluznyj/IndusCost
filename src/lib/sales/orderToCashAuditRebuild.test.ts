import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderToCashRebuildPreviewSummary,
  detectNomusLockFilesPresent,
  exitCodeForOrderToCashApplyStatus,
  formatOrderToCashExecutiveSummary,
  parseOrderToCashRebuildCli,
  resolvePeriodBounds,
  validateOrderToCashRebuildFilters,
} from "./orderToCashAuditRebuild.js";
import type { OrderToCashAuditFactRow } from "./orderToCashAuditBuilder.js";

describe("orderToCashAuditRebuild CLI", () => {
  it("parseia mode preview e orderCode", () => {
    const opts = parseOrderToCashRebuildCli([
      "--mode",
      "preview",
      "--orderCode",
      "PD 02339",
    ]);
    assert.equal(opts.mode, "preview");
    assert.equal(opts.orderCode, "PD 02339");
    assert.equal(opts.dateAxis, "ORDER_ISSUE_DATE");
    assert.equal(opts.failIfSyncActive, false);
  });

  it("parseia customerExternalId + year", () => {
    const opts = parseOrderToCashRebuildCli([
      "--mode=apply",
      "--customerExternalId=200",
      "--year=2026",
      "--dateAxis=EXPECTED_DELIVERY_DATE",
    ]);
    assert.equal(opts.mode, "apply");
    assert.equal(opts.customerExternalId, 200);
    assert.equal(opts.year, 2026);
    assert.equal(opts.dateAxis, "EXPECTED_DELIVERY_DATE");
    const period = resolvePeriodBounds(opts);
    assert.equal(period.from?.getFullYear(), 2026);
    assert.equal(period.to?.getFullYear(), 2026);
  });

  it("parseia from/to e fail-if-sync-active", () => {
    const opts = parseOrderToCashRebuildCli([
      "--mode=apply",
      "--from=2025-06-01",
      "--to=2026-12-31",
      "--fail-if-sync-active",
    ]);
    assert.equal(opts.fromDate?.toISOString().slice(0, 10), "2025-06-01");
    assert.ok(opts.toDate);
    assert.equal(opts.failIfSyncActive, true);
  });

  it("rejeita mode inválido", () => {
    assert.throws(() => parseOrderToCashRebuildCli(["--mode=dry"]), /preview\|apply/);
  });

  it("detectNomusLockFilesPresent usa existsFn injetável", () => {
    const hits = detectNomusLockFilesPresent(
      ["/tmp/a.lock", "/tmp/b.lock"],
      (p) => p.endsWith("a.lock")
    );
    assert.deepEqual(hits, ["/tmp/a.lock"]);
  });

  it("exitCodeForOrderToCashApplyStatus", () => {
    assert.equal(exitCodeForOrderToCashApplyStatus("SUCCESS"), 0);
    assert.equal(exitCodeForOrderToCashApplyStatus("PARTIAL"), 1);
    assert.equal(exitCodeForOrderToCashApplyStatus("FAILED"), 1);
  });

  it("formatOrderToCashExecutiveSummary inclui totais e contagens", () => {
    const summary = buildOrderToCashRebuildPreviewSummary({
      ordersCount: 2,
      orderItemsCount: 3,
      rows: [
        {
          orderCode: "PD 1",
          orderToCashStage: "RECEBIDO",
          alertsJson: ["OK"],
        } as OrderToCashAuditFactRow,
      ],
      builderSummary: {
        totalOrderValue: 10,
        totalAllocatedValueByOrderPrice: 8,
        totalReceivableValue: 7,
        totalReceivedValue: 5,
        totalOpenValue: 2,
      },
      warnings: [],
    });
    const text = formatOrderToCashExecutiveSummary(summary, {
      mode: "apply",
      runId: "run-x",
      status: "SUCCESS",
    });
    assert.match(text, /totalOrders: 2/);
    assert.match(text, /totalFacts: 1/);
    assert.match(text, /totalAllocatedValue: 8/);
    assert.match(text, /orderToCashStageCounts/);
    assert.match(text, /runId: run-x/);
  });

  it("summary agrega alertas e top risco", () => {
    const row = {
      orderCode: "PD 02339",
      orderStatus: "SENT_TO_NOMUS",
      operationalStage: "DOCUMENT_NOT_FOUND",
      financialStage: "NO_CR",
      paymentStatus: "PLANNED_ONLY",
      orderToCashStage: "BLOQUEADO_REVISAO",
      temperature: "CONGELADO",
      orderNetValue: 158000,
      alertsJson: ["ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO"],
      blockingReasonsJson: ["ENTREGA_MUITO_ATRASADA_SEM_DOCUMENTO"],
    } as OrderToCashAuditFactRow;

    const summary = buildOrderToCashRebuildPreviewSummary({
      ordersCount: 1,
      orderItemsCount: 2,
      rows: [row],
      builderSummary: {
        totalOrderValue: 158000,
        totalAllocatedValueByOrderPrice: 0,
        totalReceivableValue: 0,
        totalReceivedValue: 0,
        totalOpenValue: 0,
      },
      warnings: [],
    });

    assert.equal(summary.totalFacts, 1);
    assert.equal(summary.totalBlockedValue, 158000);
    assert.ok(summary.alertCounts["ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO"] >= 1);
    assert.equal(summary.topRiskOrders[0]?.orderCode, "PD 02339");
  });

  it("validateOrderToCashRebuildFilters avisa sem filtro forte", () => {
    const warnings = validateOrderToCashRebuildFilters(
      parseOrderToCashRebuildCli(["--mode=preview"])
    );
    assert.ok(warnings.length >= 1);
  });
});
