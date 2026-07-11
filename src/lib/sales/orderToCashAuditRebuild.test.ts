import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOrderToCashRebuildPreviewSummary,
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

  it("rejeita mode inválido", () => {
    assert.throws(() => parseOrderToCashRebuildCli(["--mode=dry"]), /preview\|apply/);
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
    assert.ok(warnings.length > 0);
  });
});
