/**
 * PERFORMANCE 09 — regressão de paridade funcional (Pedidos + Financeiro).
 * Garante que otimizações PERF 03–08 não removeram filtros, paginação, permissões
 * nem contratos de totais/ordem.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("PERFORMANCE 09 — regressão paridade Pedidos + Financeiro", () => {
  it("1) lista SO: ordem createdAt/issueDate, paginação e busca q", () => {
    const server = read("server.ts");
    const listQuery = read("src/lib/salesOrderListQuery.server.ts");
    assert.match(server, /orderBy: \[\{ createdAt: "desc" \}, \{ issueDate: "desc" \}\]/);
    assert.match(server, /parseSalesOrderListQuery/);
    assert.match(server, /listQuery\.pageSize/);
    assert.match(listQuery, /pageSize: Math\.min\(parsePositiveIntQuery\(query\.pageSize, 20\), 100\)/);
    assert.match(listQuery, /q: String\(query\.q/);
  });

  it("2) lista SO: aggregate de totais + DTO (sem nomusRawResponse no HTTP)", () => {
    const server = read("server.ts");
    const dto = read("src/lib/salesOrderListApiDto.ts");
    assert.match(server, /buildSalesOrderListSummaryFromAggregate/);
    assert.match(server, /toSalesOrderListHttpRow/);
    assert.match(dto, /nomusRawResponse/);
    assert.doesNotMatch(dto, /return \{[\s\S]*nomusRawResponse:/);
  });

  it("3) margens e billing status oficiais preservados na lista", () => {
    const server = read("server.ts");
    assert.match(server, /attachMarginsToSalesOrders/);
    assert.match(server, /resolveSalesOrderBillingStatus/);
    assert.match(server, /canViewMarginEconomics|products\.tab\.cost|costs\.view/);
  });

  it("4) AR/AP: draft ≠ applied; export usa applied; permissões view/export", () => {
    const ar = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    const ap = read("src/components/finance/FinanceAccountsPayablePage.tsx");
    assert.match(ar, /draftFilters/);
    assert.match(ar, /appliedFilters/);
    assert.match(ar, /buildFinanceArExportQuery\(appliedFilters\)/);
    assert.match(ap, /buildFinanceApExportQuery\(appliedFilters\)/);
    assert.match(ar, /canExportFinanceAccountsReceivable|canExport/);
    assert.match(ap, /canExportFinanceAccountsPayable|canExport/);
  });

  it("5) abas sob demanda (PERF 03) ainda condicionais", () => {
    const ar = read("src/components/finance/FinanceAccountsReceivablePage.tsx");
    const billing = read("src/components/finance/FinanceBillingPage.tsx");
    assert.match(ar, /activeTab === "overdue"/);
    assert.match(billing, /analysisTab === "overview"/);
    assert.doesNotMatch(billing, /FinanceBillingNfeDetailsTable/);
  });

  it("6) índices P1 migration presente sem alterar dados", () => {
    const sql = read(
      "prisma/migrations/20260804120000_perf08_sales_finance_read_indexes/migration.sql"
    );
    assert.match(sql, /SalesOrder_createdAt_issueDate_idx/);
    assert.match(sql, /NomusAccountsReceivable_open_dueDate_idx/);
    assert.doesNotMatch(sql, /\bUPDATE\b/i);
    assert.doesNotMatch(sql, /\bDELETE\b/i);
  });

  it("7) UI lista/tabela: paginação e debounce preservados", () => {
    const so = read("src/components/SalesOrdersModule.tsx");
    assert.match(so, /setTimeout\(\(\) => setSearch\(searchDraft\.trim\(\)\), 300\)/);
    assert.match(so, /setCurrentPage/);
    assert.match(so, /SALES_ORDERS_PAGE_SIZE/);
  });
});
