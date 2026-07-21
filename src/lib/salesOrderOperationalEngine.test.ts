/**
 * OP-02 — Testes do motor canônico: unicidade, joins, métricas, PD 02739, paridade.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  aggregateFactsBySalesOrderId,
  assertUniqueSalesOrderIds,
  collapseCartesianJoinToOrderFacts,
  computeBalanceToInvoice,
  computeSalesOrderOperationalMetrics,
  uniqueSalesOrderIds,
} from "./salesOrderOperationalMetrics.js";
import { aggregateReceivablesBySalesOrderId } from "./salesOrderOperationalFacts.server.js";
import {
  NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV,
  isNomusSourceOperationallyPresent,
  isNomusSourcePresenceVisibleForAudit,
  mergeSalesOrderOperationalPresenceWhere,
} from "./nomus/nomusSourcePresencePolicy.js";
import { buildSalesOrderListWhere } from "./salesOrdersListSummary.js";
import { buildMaterialDemandSalesOrderWhere } from "./materialDemandFilters.js";
import { diffSalesOrderPopulationIds } from "./salesOrderOperationalEngine.server.js";
import { SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS } from "./salesOrderOperationalTypes.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

const FLAG = NOMUS_OPS_EXCLUDE_MISSING_SALES_ORDERS_ENV;
const envOn = { [FLAG]: "true" };
const envOff = { [FLAG]: "false" };

/** Caso explícito OP-02 / HOTFIX-05. */
const PD_02739 = {
  id: "so-pd-02739",
  orderCode: "PD 02739",
  externalSalesOrderId: 2737,
  sourcePresenceStatus: "MISSING_CONFIRMED" as const,
  totalNetValue: 117_000,
  totalItems: 1,
};

describe("OP-02 salesOrderOperationalMetrics — unicidade e joins", () => {
  it("1. SalesOrder único não duplica com vários itens no count", () => {
    const ids = ["so-1", "so-1", "so-1"];
    const { uniqueIds, duplicateCount } = assertUniqueSalesOrderIds(ids, {
      throwOnDuplicate: false,
    });
    assert.deepEqual(uniqueIds, ["so-1"]);
    assert.equal(duplicateCount, 2);
    const metrics = computeSalesOrderOperationalMetrics([
      {
        salesOrderId: "so-1",
        totalNetValue: 1000,
        totalItems: 3,
        invoicedNfeAmount: 0,
      },
    ]);
    assert.equal(metrics.orderCount, 1);
    assert.equal(metrics.soldAmount, 1000);
    assert.equal(metrics.itemCount, 3);
  });

  it("2-4. não duplica com NFs + CRs + itens simultaneamente (caso cartesiano)", () => {
    const fact = collapseCartesianJoinToOrderFacts({
      salesOrderId: "so-cart",
      totalNetValue: 10_000,
      totalItems: 3,
      nfeAmounts: [4_000, 3_500],
      receivableAmounts: [2_000, 1_500, 1_000, 500],
    });
    assert.equal(fact.salesOrderId, "so-cart");
    assert.equal(fact.totalNetValue, 10_000);
    assert.equal(fact.totalItems, 3);
    assert.equal(fact.invoicedNfeAmount, 7_500);
    assert.equal(fact.receivableOpenAmount, 5_000);

    const metrics = computeSalesOrderOperationalMetrics([fact]);
    assert.equal(metrics.orderCount, 1);
    assert.equal(metrics.soldAmount, 10_000);
    assert.equal(metrics.invoicedNfeAmount, 7_500);
    assert.equal(metrics.balanceToInvoice, 2_500);
    assert.equal(metrics.averageTicket, 10_000);
  });

  it("16-17. valor vendido uma vez e ticket canônico", () => {
    const metrics = computeSalesOrderOperationalMetrics([
      { salesOrderId: "a", totalNetValue: 100, totalItems: 1, invoicedNfeAmount: 0 },
      { salesOrderId: "b", totalNetValue: 300, totalItems: 2, invoicedNfeAmount: 50 },
    ]);
    assert.equal(metrics.soldAmount, 400);
    assert.equal(metrics.orderCount, 2);
    assert.equal(metrics.averageTicket, 200);
    assert.equal(metrics.balanceToInvoice, 350);
  });

  it("25. totais estáveis independentemente da ordem", () => {
    const rows = [
      { salesOrderId: "x", totalNetValue: 10, totalItems: 1, invoicedNfeAmount: 1 },
      { salesOrderId: "y", totalNetValue: 20, totalItems: 1, invoicedNfeAmount: 2 },
      { salesOrderId: "z", totalNetValue: 30, totalItems: 1, invoicedNfeAmount: 3 },
    ];
    const forward = computeSalesOrderOperationalMetrics(rows);
    const reverse = computeSalesOrderOperationalMetrics([...rows].reverse());
    assert.deepEqual(forward, reverse);
  });

  it("assertUnique lança com duplicatas", () => {
    assert.throws(() => assertUniqueSalesOrderIds(["a", "a"]));
  });

  it("aggregateFactsBySalesOrderId preserva header e soma NF", () => {
    const map = aggregateFactsBySalesOrderId([
      { salesOrderId: "1", totalNetValue: 100, totalItems: 2, invoicedNfeAmount: 40 },
      { salesOrderId: "1", totalNetValue: 999, totalItems: 99, invoicedNfeAmount: 10 },
    ]);
    const fact = map.get("1")!;
    assert.equal(fact.totalNetValue, 100);
    assert.equal(fact.totalItems, 2);
    assert.equal(fact.invoicedNfeAmount, 50);
  });

  it("computeBalanceToInvoice nunca negativo", () => {
    assert.equal(computeBalanceToInvoice(100, 150), 0);
    assert.equal(computeBalanceToInvoice(100, 40), 60);
  });

  it("aggregateReceivablesBySalesOrderId (facts module)", () => {
    const map = aggregateReceivablesBySalesOrderId([
      { salesOrderId: "so-1", balanceReceivable: 10 },
      { salesOrderId: "so-1", balanceReceivable: 15 },
      { salesOrderId: "so-2", balanceReceivable: 5 },
    ]);
    assert.equal(map.get("so-1")!.titleCount, 2);
    assert.equal(map.get("so-1")!.openAmount, 25);
    assert.equal(map.size, 2);
  });
});

describe("OP-02 presença operacional e PD 02739", () => {
  it("5-6. PRESENT e MISSING_CANDIDATE entram", () => {
    assert.equal(isNomusSourceOperationallyPresent("PRESENT"), true);
    assert.equal(isNomusSourceOperationallyPresent("MISSING_CANDIDATE"), true);
  });

  it("7. MISSING_CONFIRMED sai com flag true — PD 02739", () => {
    const where = buildSalesOrderListWhere({ q: "02739" }, { env: envOn });
    assert.match(JSON.stringify(where), /MISSING_CONFIRMED/);
    assert.equal(isNomusSourceOperationallyPresent(PD_02739.sourcePresenceStatus), false);
    // Não contribui para totais operacionais
    const ops = [PD_02739].filter((r) => isNomusSourceOperationallyPresent(r.sourcePresenceStatus));
    assert.equal(ops.length, 0);
    const metrics = computeSalesOrderOperationalMetrics(
      ops.map((r) => ({
        salesOrderId: r.id,
        totalNetValue: r.totalNetValue,
        totalItems: r.totalItems,
        invoicedNfeAmount: 0,
      }))
    );
    assert.equal(metrics.orderCount, 0);
    assert.equal(metrics.soldAmount, 0);
  });

  it("8. MISSING_CONFIRMED entra com flag false", () => {
    const where = buildSalesOrderListWhere({ q: "02739" }, { env: envOff });
    assert.doesNotMatch(JSON.stringify(where), /MISSING_CONFIRMED/);
  });

  it("9. busca textual não contorna a policy", () => {
    const where = buildSalesOrderListWhere({ q: "02739" }, { env: envOn });
    const parsed = where as { AND?: unknown[] };
    assert.ok(Array.isArray(parsed.AND));
    const last = parsed.AND![parsed.AND!.length - 1];
    assert.deepEqual(last, { sourcePresenceStatus: { not: "MISSING_CONFIRMED" } });
  });

  it("19-20. detalhe histórico encontra ausente; contexto não mistura", () => {
    assert.equal(isNomusSourcePresenceVisibleForAudit("MISSING_CONFIRMED"), true);
    const hist = mergeSalesOrderOperationalPresenceWhere(
      { id: PD_02739.id },
      { env: envOn, includeConfirmedMissing: true }
    );
    assert.deepEqual(hist, { id: PD_02739.id });
    const ops = mergeSalesOrderOperationalPresenceWhere(
      { id: PD_02739.id },
      { env: envOn }
    );
    assert.match(JSON.stringify(ops), /MISSING_CONFIRMED/);
  });

  it("material demand where aplica presença (OP-02)", () => {
    const where = buildMaterialDemandSalesOrderWhere(
      {
        startDate: null,
        endDate: null,
        dateBasis: "issueDate",
        status: null,
        statuses: ["SENT_TO_NOMUS"],
        customerId: null,
        productId: null,
        materialId: null,
        companyIssuer: null,
        unitKey: null,
        mode: "value",
        search: "",
        includeOrdersWithoutDeliveryDate: true,
        invoicingScope: "all",
        seller: null,
      },
      { env: envOn }
    );
    assert.match(JSON.stringify(where), /MISSING_CONFIRMED/);
  });
});

describe("OP-02 paridade de consumidores (wiring)", () => {
  it("10-15. list/cards/PDF/Excel/industrial/CRM/funnel usam população canônica", () => {
    const files: Array<[string, RegExp]> = [
      ["src/lib/salesOrderListQuery.server.ts", /resolveSalesOrderListWhere|buildSalesOrderListWhere/],
      ["src/lib/salesOrderListReportExport.server.ts", /resolveSalesOrderListWhere/],
      ["src/lib/sales/salesOrderReportService.server.ts", /resolveSalesOrderListWhere|buildSalesOrderListWhere/],
      ["src/lib/sales/salesOrderIndustrialResultReportService.server.ts", /resolveSalesOrderListWhere/],
      ["src/lib/salesOrderInternalMarginExport.server.ts", /resolveSalesOrderListWhere|buildSalesOrderListWhere/],
      ["src/lib/salesOrderResultEngine.server.ts", /resolveSalesOrderListWhere|parseSalesOrderListQuery/],
      ["src/lib/salesOrderManagement.ts", /buildSalesOrderListWhere/],
      ["src/lib/commercial/crmSalesOrderMetricsService.ts", /mergeSalesOrderOperationalPresenceWhere/],
      ["src/lib/materialDemandFilters.ts", /mergeSalesOrderOperationalPresenceWhere/],
      ["src/lib/salesOrderMetricsEngine.ts", /buildSalesOrderListWhere/],
      ["src/lib/salesOrderOperationalPopulation.server.ts", /resolveSalesOrderListWhere/],
      ["src/lib/salesOrderOperationalEngine.server.ts", /runSalesOrderOperationalEngine/],
    ];
    for (const [rel, re] of files) {
      assert.match(read(rel), re, rel);
    }
  });

  it("detalhe não aplica exclusão operacional", () => {
    const detail = read("src/lib/sales-orders/salesOrderDetailService.server.ts");
    assert.doesNotMatch(detail, /mergeSalesOrderOperationalPresenceWhere/);
  });

  it("diffSalesOrderPopulationIds detecta divergência", () => {
    const d = diffSalesOrderPopulationIds(["a", "b"], ["b", "c"]);
    assert.equal(d.equal, false);
    assert.deepEqual(d.onlyLeft, ["a"]);
    assert.deepEqual(d.onlyRight, ["c"]);
    assert.equal(diffSalesOrderPopulationIds(["a"], ["a"]).equal, true);
  });

  it("definições oficiais documentadas", () => {
    assert.ok(SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS.soldAmount.includes("totalNetValue"));
    assert.ok(SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS.averageTicket.includes("soldAmount"));
  });

  it("uniqueSalesOrderIds preserva ordem da primeira ocorrência", () => {
    assert.deepEqual(uniqueSalesOrderIds(["c", "a", "c", "b"]), ["c", "a", "b"]);
  });
});
