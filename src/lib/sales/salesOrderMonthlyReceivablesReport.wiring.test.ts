/**
 * Wiring OP-08 — relatório consome OP-02 + FIN-05/FIN-08, sem motor paralelo.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderMonthlyReceivablesReport wiring", () => {
  it("serviço usa OP-02 + FIN-05 + FIN-08 sem planned receivables legado", () => {
    const svc = read("src/lib/sales/salesOrderMonthlyReceivablesReportService.server.ts");
    assert.match(svc, /resolveSalesOrderListWhere/);
    assert.match(svc, /buildSalesOrderEffectiveFinancialSchedule/);
    assert.match(svc, /listEffectiveReceivableLinesFromSchedule/);
    assert.match(svc, /rowHasReceivablesInSelectedPeriod/);
    assert.doesNotMatch(svc, /buildSalesOrderPlannedReceivables/);
  });

  it("math reutiliza buildFinanceArEffectiveTitles", () => {
    const math = read("src/lib/sales/salesOrderMonthlyReceivablesReportMath.ts");
    assert.match(math, /buildFinanceArEffectiveTitles/);
  });

  it("rotas registradas no server e commercialAccess", () => {
    const server = read("server.ts");
    assert.match(server, /registerSalesOrderMonthlyReceivablesReportRoutes/);
    const access = read("src/lib/commercialAccess.ts");
    assert.match(access, /monthly-receivables/);
    const routes = read("src/lib/salesOrderMonthlyReceivablesReportRoutes.ts");
    assert.match(routes, /\/api\/sales-orders\/reports\/monthly-receivables/);
    assert.match(routes, /export\.xlsx/);
    assert.match(routes, /export\.pdf/);
  });

  it("App expõe rota e link Comercial", () => {
    const app = read("src/App.tsx");
    assert.match(app, /sales-orders\/monthly-receivables/);
    assert.match(app, /SalesOrderMonthlyReceivablesReportPage/);
  });

  it("UI inicia com filtro do ano calendário corrente e Status CR = Todos", () => {
    const page = read(
      "src/components/sales/SalesOrderMonthlyReceivablesReportPage.tsx"
    );
    assert.match(page, /defaultMonthlyReceivablesYearFilters/);
    assert.match(page, /initialYearFilters\.dueMonthFrom/);
    assert.match(page, /initialYearFilters\.startDate/);
    // População ampla (previstos + CR + doc), alinhada ao Fluxo de Caixa — não default "open"
    assert.match(page, /useState\(""\)/);
    assert.doesNotMatch(page, /useState\("open"\)/);
    assert.match(page, /monthly-receivables-filter-receivable-status/);
  });

  it("matriz congela Pedido/Cliente/Valor com fundo opaco, slider no topo e mês corrente", () => {
    const page = read(
      "src/components/sales/SalesOrderMonthlyReceivablesReportPage.tsx"
    );
    const css = read(
      "src/components/sales/sales-order-monthly-receivables-matrix.css"
    );
    assert.match(page, /mr-sticky-pedido/);
    assert.match(page, /mr-sticky-cliente/);
    assert.match(page, /mr-sticky-valor/);
    assert.match(page, /monthly-receivables-month-slider/);
    assert.match(page, /monthly-receivables-scroll-top/);
    assert.match(page, /useTableHorizontalScrollSync/);
    assert.match(page, /currentYearMonthKey/);
    assert.match(page, /scrollLeftToAlignMonthAfterSticky/);
    assert.match(page, /data-month-key/);
    assert.match(css, /position:\s*sticky/);
    assert.match(css, /--mr-left-valor/);
    assert.match(css, /--mr-bg-body/);
    assert.match(css, /background-color:\s*var\(--mr-bg-body\)/);
    assert.doesNotMatch(css, /background(?:-color)?:\s*hsl\(var\(--(?:card|muted)/);
  });
});
