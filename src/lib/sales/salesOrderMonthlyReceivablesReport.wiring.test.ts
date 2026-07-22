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
});
