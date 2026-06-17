import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceArTitlesPayload,
  type FinanceArTitlesQuery,
} from "./financeAccountsReceivableTitles.js";
import { filterArTitleRowsByLocalFilter } from "./financeAccountsReceivableTitlesLocalFilter.js";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";

const REF = new Date(2026, 5, 15, 12, 0, 0, 0);

function row(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Cliente",
    personCnpj: "123",
    description: null,
    dueDate: new Date(2026, 5, 20),
    settlementDate: null,
    amountReceivable: 100,
    amountReceived: 0,
    balanceReceivable: 100,
    paymentMethodName: "Boleto",
    bankAccountName: null,
    sourceInvoiceId: 1,
    sourceInvoiceNumber: "NF-1",
    suspendCollection: false,
    nomusStatus: null,
    syncedAt: REF,
    ...partial,
  };
}

describe("financeAccountsReceivableTitlesLocalFilter", () => {
  const rows = [
    row({ externalId: 1, balanceReceivable: 0, amountReceived: 100, settlementDate: new Date("2026-06-01") }),
    row({ externalId: 2, dueDate: new Date(2026, 5, 1), balanceReceivable: 50, amountReceived: 50 }),
    row({ externalId: 3, dueDate: new Date(2026, 5, 1), balanceReceivable: 80 }),
    row({ externalId: 4, dueDate: new Date(2026, 5, 15), balanceReceivable: 40 }),
    row({ externalId: 5, dueDate: new Date(2026, 6, 1), balanceReceivable: 30 }),
    row({
      externalId: 6,
      dueDate: new Date(2026, 5, 1),
      sourceInvoiceId: null,
      sourceInvoiceNumber: null,
      balanceReceivable: 20,
    }),
  ];

  it("Todos retorna conjunto completo após filtro global simulado", () => {
    assert.equal(filterArTitleRowsByLocalFilter(rows, "all", REF).length, 6);
  });

  it("Pagos filtra títulos quitados", () => {
    const paid = filterArTitleRowsByLocalFilter(rows, "settled", REF);
    assert.equal(paid.length, 1);
    assert.equal(paid[0]!.externalId, 1);
  });

  it("Em aberto filtra saldo positivo", () => {
    const open = filterArTitleRowsByLocalFilter(rows, "open", REF);
    assert.equal(open.length, 5);
  });

  it("Vencidos filtra status overdue", () => {
    const overdue = filterArTitleRowsByLocalFilter(rows, "overdue", REF);
    assert.equal(overdue.length, 3);
    assert.deepEqual(
      overdue.map((r) => r.externalId).sort((a, b) => a - b),
      [2, 3, 6]
    );
  });

  it("Vence hoje filtra dueToday", () => {
    const today = filterArTitleRowsByLocalFilter(rows, "dueToday", REF);
    assert.equal(today.length, 1);
    assert.equal(today[0]!.externalId, 4);
  });

  it("A vencer filtra upcoming", () => {
    const upcoming = filterArTitleRowsByLocalFilter(rows, "upcoming", REF);
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0]!.externalId, 5);
  });

  it("Parcial filtra recebido parcial com saldo", () => {
    const partial = filterArTitleRowsByLocalFilter(rows, "partial", REF);
    assert.equal(partial.length, 1);
    assert.equal(partial[0]!.externalId, 2);
  });

  it("Sem documento filtra títulos abertos sem NF", () => {
    const missing = filterArTitleRowsByLocalFilter(rows, "missingDocument", REF);
    assert.equal(missing.length, 1);
    assert.equal(missing[0]!.externalId, 6);
  });

  it("buildFinanceArTitlesPayload aplica localFilter na paginação", () => {
    const query: FinanceArTitlesQuery = {
      page: 1,
      limit: 50,
      sortBy: "dueDate",
      sortDirection: "asc",
      filters: { status: "all" },
      localFilter: "open",
    };
    const payload = buildFinanceArTitlesPayload(rows, query, REF);
    assert.equal(payload.total, 5);
    assert.ok(payload.items.every((i) => i.balanceReceivable > 0));
  });

  it("UI títulos possui filtros locais sem alterar globais", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivableTitlesTab.tsx"),
      "utf8"
    );
    assert.match(tab, /FINANCE_AR_TITLES_LOCAL_FILTER_OPTIONS/);
    assert.match(tab, /localFilter/);
    assert.match(tab, /Filtros locais refinam o grid/);
    assert.match(tab, /localFilter,/);
  });

  it("página AR usa design system executivo e aba auditoria", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.match(page, /FinanceDetailTabs/);
    assert.match(page, /FinanceArAuditTab/);
    assert.match(page, /totalAmountReceivable/);
    assert.match(page, /Fonte: Nomus/);
    assert.match(page, /FinanceActionCenterShell/);
  });
});
