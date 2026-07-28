/**
 * PERFORMANCE 05 — regressão de consultas (Pedidos + Financeiro).
 * Valida wiring seguro: aggregate, Promise.all, sem loads duplicados.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderListSummaryFromAggregate,
  summarizeSalesOrderListRows,
} from "@/src/lib/salesOrdersListSummary.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("PERFORMANCE 05 — consultas SO + Finance", () => {
  it("aggregate de listagem preserva totais da soma em memória (população representativa)", () => {
    const populations = [
      [],
      [{ totalNetValue: 0, totalItems: 0 }],
      [
        { totalNetValue: 1000.5, totalItems: 2 },
        { totalNetValue: 2500, totalItems: 5 },
        { totalNetValue: null as unknown as number, totalItems: 1 },
      ],
      [
        { totalNetValue: "100.10", totalItems: 1 },
        { totalNetValue: "200.20", totalItems: 3 },
        { totalNetValue: "50.00", totalItems: 0 },
      ],
    ];

    for (const rows of populations) {
      const fromRows = summarizeSalesOrderListRows(
        rows.map((r) => ({
          totalNetValue: r.totalNetValue,
          totalItems: r.totalItems,
        }))
      );
      // Aggregate path: mesmos totais (count/sum) → mesmo summary/ticket.
      const fromAgg = buildSalesOrderListSummaryFromAggregate({
        totalOrders: fromRows.totalOrders,
        sumNetValue: fromRows.totalNetAmount,
        sumItems: fromRows.totalItems,
      });
      assert.deepEqual(fromAgg, fromRows);
      assert.equal(fromAgg.averageTicket, fromRows.averageTicket);
      assert.ok(Number.isFinite(fromAgg.averageTicket));
    }
  });

  it("SO list: aggregate + NF; margem da página fora do GET", () => {
    const server = read("server.ts");
    const start = server.indexOf('app.get("/api/sales-orders"');
    const chunk = server.slice(start, start + 4500);
    assert.match(chunk, /salesOrder\.aggregate/);
    assert.match(chunk, /_count:\s*\{\s*_all:\s*true/);
    assert.doesNotMatch(chunk, /attachMarginsToSalesOrders/);
    assert.match(chunk, /loadSalesOrderLinkedNfeContextMap/);
    assert.doesNotMatch(chunk, /SALES_ORDER_LIST_SUMMARY_PRISMA_SELECT/);
    assert.doesNotMatch(chunk, /prisma\.salesOrder\.count\(\{\s*where\s*\}\)/);
    assert.match(
      read("src/lib/salesOrderListPageMargins.server.ts"),
      /attachMarginsToSalesOrders/
    );
  });

  it("AR dashboard: load portfolio ‖ horizon", () => {
    const routes = read("src/lib/financeAccountsReceivableRoutes.ts");
    const start = routes.indexOf('"/api/finance/accounts-receivable/dashboard"');
    const chunk = routes.slice(start, start + 1200);
    assert.match(
      chunk,
      /Promise\.all\(\[\s*\n?\s*loadFinanceArRows\(filters\),\s*\n?\s*loadFinanceArOpenHorizonRowsFromPrisma/
    );
  });

  it("AR titles + export: enrichments em Promise.all", () => {
    const routes = read("src/lib/financeAccountsReceivableRoutes.ts");
    assert.match(
      routes,
      /Promise\.all\(\[\s*\n?\s*loadFinanceArEffectiveOrderContexts/
    );
    const titlesIdx = routes.indexOf('"/api/finance/accounts-receivable/titles"');
    const exportIdx = routes.indexOf('"/api/finance/accounts-receivable/titles/export.xlsx"');
    assert.ok(titlesIdx > 0 && exportIdx > titlesIdx);
    const titlesChunk = routes.slice(titlesIdx, exportIdx);
    const exportChunk = routes.slice(exportIdx, exportIdx + 2000);
    assert.match(titlesChunk, /resolveFinanceArNfeOrderLinksFromRows/);
    assert.match(exportChunk, /Promise\.all\(\[\s*\n?\s*loadFinanceArEffectiveOrderContexts/);
  });

  it("AP dashboard: filter options reutilizam ctx (sem 2º loadCostCenters/loadSuppliers)", () => {
    const routes = read("src/lib/financeAccountsPayableRoutes.ts");
    const start = routes.indexOf('"/api/finance/accounts-payable/dashboard"');
    const chunk = routes.slice(start, start + 1800);
    assert.match(chunk, /buildApCostCenterIntegrationContext/);
    assert.match(chunk, /ctx\.costCenterById\.values\(\)/);
    assert.match(chunk, /ctx\.suppliers/);
    assert.doesNotMatch(
      chunk,
      /integrationDeps\.loadCostCenters\(\)[\s\S]*integrationDeps\.loadSuppliers\(\)/
    );
  });
});
