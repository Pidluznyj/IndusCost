import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceApTitlesPayload,
  type FinanceApTitlesQuery,
} from "./financeAccountsPayableTitles.js";
import {
  filterApTitleRowsByLocalFilter,
  resolveFinanceApTitleExclusionReason,
} from "./financeAccountsPayableTitlesLocalFilter.js";

const REF = new Date(2026, 5, 9, 12, 0, 0, 0);

function row(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa",
    personName: "Fornecedor",
    personCnpj: "123",
    description: "Serviço",
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 100,
    amountPaid: 0,
    balancePayable: 100,
    paymentMethodName: "PIX",
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: false,
    syncedAt: REF,
    ...partial,
  };
}

describe("financeAccountsPayableTitlesLocalFilter", () => {
  const rows = [
    row({
      externalId: 1,
      balancePayable: 0,
      amountPaid: 100,
      settlementDate: new Date(2026, 5, 1),
    }),
    row({ externalId: 2, dueDate: new Date(2026, 5, 1), balancePayable: 80 }),
    row({ externalId: 3, dueDate: new Date(2026, 5, 9), balancePayable: 40 }),
    row({ externalId: 4, dueDate: new Date(2026, 6, 1), balancePayable: 30 }),
    row({
      externalId: 5,
      dueDate: new Date(2026, 5, 20),
      scheduleDate: new Date(2026, 5, 7),
      balancePayable: 50,
    }),
    row({
      externalId: 6,
      type: 2,
      description: "PEDIDO DE COMPRA",
      dueDate: new Date(2026, 4, 1),
      balancePayable: 200,
    }),
  ];

  it("Todos retorna conjunto completo", () => {
    assert.equal(filterApTitleRowsByLocalFilter(rows, "all", REF).length, 6);
  });

  it("Pagos filtra títulos quitados", () => {
    const paid = filterApTitleRowsByLocalFilter(rows, "settled", REF);
    assert.equal(paid.length, 1);
    assert.equal(paid[0]!.externalId, 1);
  });

  it("Em aberto exclui pedidos de compra da visão gerencial", () => {
    const open = filterApTitleRowsByLocalFilter(rows, "open", REF);
    assert.equal(open.length, 4);
    assert.ok(open.every((r) => r.externalId !== 6));
  });

  it("Vencidos gerenciais usa data operacional", () => {
    const overdue = filterApTitleRowsByLocalFilter(rows, "overdue", REF);
    assert.equal(overdue.length, 1);
    assert.equal(overdue[0]!.externalId, 2);
  });

  it("Vence hoje filtra dueToday na visão gerencial", () => {
    const today = filterApTitleRowsByLocalFilter(rows, "dueToday", REF);
    assert.equal(today.length, 1);
    assert.equal(today[0]!.externalId, 3);
  });

  it("A vencer filtra upcoming na visão gerencial", () => {
    const upcoming = filterApTitleRowsByLocalFilter(rows, "upcoming", REF);
    assert.equal(upcoming.length, 2);
    assert.deepEqual(
      upcoming.map((r) => r.externalId).sort((a, b) => a - b),
      [4, 5]
    );
  });

  it("Agendados filtra scheduleDate divergente do vencimento", () => {
    const scheduled = filterApTitleRowsByLocalFilter(rows, "scheduled", REF);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]!.externalId, 5);
  });

  it("Excluídos filtra pedidos de compra", () => {
    const excluded = filterApTitleRowsByLocalFilter(rows, "excluded", REF);
    assert.equal(excluded.length, 1);
    assert.equal(excluded[0]!.externalId, 6);
  });

  it("Pedido de compra filtra type 2 ou descrição", () => {
    const po = filterApTitleRowsByLocalFilter(rows, "purchaseOrder", REF);
    assert.equal(po.length, 1);
    assert.equal(po[0]!.externalId, 6);
  });

  it("resolveFinanceApTitleExclusionReason descreve exclusão e remarcação", () => {
    assert.ok(resolveFinanceApTitleExclusionReason(rows[5]!).includes("pedido"));
    assert.ok(
      resolveFinanceApTitleExclusionReason(rows[4]!).includes("divergente")
    );
  });

  it("buildFinanceApTitlesPayload aplica localFilter na paginação", () => {
    const query: FinanceApTitlesQuery = {
      page: 1,
      limit: 50,
      sortBy: "dueDate",
      sortDirection: "asc",
      filters: { status: "all" },
      localFilter: "open",
    };
    const payload = buildFinanceApTitlesPayload(rows, query, REF);
    assert.equal(payload.total, 4);
    assert.ok(payload.items.every((i) => i.balancePayable > 0 && !i.isPurchaseOrderSchedule));
  });

  it("buildFinanceApTitlesPayload inclui excluídos com filtro purchaseOrder", () => {
    const query: FinanceApTitlesQuery = {
      page: 1,
      limit: 50,
      sortBy: "dueDate",
      sortDirection: "asc",
      filters: { status: "all" },
      localFilter: "purchaseOrder",
    };
    const payload = buildFinanceApTitlesPayload(rows, query, REF);
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 6);
  });

  it("UI títulos possui filtros locais sem alterar globais", () => {
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayableTitlesTab.tsx"),
      "utf8"
    );
    assert.match(tab, /FINANCE_AP_TITLES_LOCAL_FILTER_OPTIONS/);
    assert.match(tab, /localFilter/);
    assert.match(tab, /localFilter,/);
  });

  it("página AP usa design system executivo e aba auditoria", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsPayablePage.tsx"),
      "utf8"
    );
    assert.match(page, /FinanceDetailTabs/);
    assert.match(page, /FinanceApAuditTab/);
    assert.match(page, /totalPayableAmount/);
    assert.match(page, /FinanceExecutivePageHeader/);
    assert.match(page, /FinanceDataAuditDrawer/);
    assert.match(page, /FinanceActionCenterShell/);
    assert.match(page, /FINANCE_AP_EXECUTIVE_TABS/);
  });
});
