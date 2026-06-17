import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
  classifyFinanceApTitle,
  filterFinanceApManagementReportRows,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
} from "./financeCashFlowDashboard.js";
import { buildNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const REF = new Date(2026, 5, 17);

function cutoff() {
  return buildNomusApReportSyncCutoff(LATEST_SYNC)!;
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Fornecedor Externo Ltda",
    personCnpj: "22.222.222/0001-22",
    description: "Nota fiscal serviço",
    dueDate: new Date(2026, 5, 12),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

const REPORTED_GHOST_SUPPLIERS = [
  "SECRETARIA DE ESTADO DA FAZENDA PR",
  "JOSE EDUARDO CARDOSO DOS SANTOS",
  "PROCESSO INDUSTRIAL",
  "CONTA ADMINISTRATIVA",
] as const;

function ghostSupplierRows(): FinanceCashFlowApRow[] {
  return [
    apRow({
      externalId: 9001,
      personName: "SECRETARIA DE ESTADO DA FAZENDA PR",
      balancePayable: 68000,
      amountPayable: 68000,
      dueDate: new Date(2026, 5, 12),
      syncedAt: STALE_SYNC,
    }),
    apRow({
      externalId: 9002,
      personName: "JOSE EDUARDO CARDOSO DOS SANTOS",
      balancePayable: 13649.24,
      amountPayable: 13649.24,
      dueDate: new Date(2026, 5, 2),
      syncedAt: STALE_SYNC,
    }),
    apRow({
      externalId: 9003,
      personName: "PROCESSO INDUSTRIAL",
      balancePayable: 1860,
      amountPayable: 1860,
      dueDate: new Date(2026, 5, 16),
      syncedAt: STALE_SYNC,
    }),
    apRow({
      externalId: 9004,
      personName: "CONTA ADMINISTRATIVA",
      balancePayable: 299.83,
      amountPayable: 299.83,
      dueDate: new Date(2026, 0, 11),
      syncedAt: STALE_SYNC,
    }),
    apRow({
      externalId: 9005,
      personName: "CONTA ADMINISTRATIVA",
      balancePayable: 299.83,
      amountPayable: 299.83,
      dueDate: new Date(2026, 3, 11),
      syncedAt: STALE_SYNC,
    }),
  ];
}

const juneFilters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
  month: 6,
};

describe("financeCashFlowOverduePayables", () => {
  it("AP stale não aparece em Pagamentos vencidos", () => {
    const rows = [
      apRow({ externalId: 1, syncedAt: LATEST_SYNC, balancePayable: 1000 }),
      apRow({ externalId: 2, syncedAt: STALE_SYNC, balancePayable: 5000 }),
    ];
    const payload = buildFinanceCashFlowDashboard([], rows, juneFilters, REF, null, cutoff());
    assert.equal(payload.overduePayables.length, 1);
    assert.equal(payload.overduePayables[0]!.externalId, 1);
  });

  it("AP pago/baixado não aparece como vencido", () => {
    const rows = [
      apRow({
        externalId: 10,
        balancePayable: 0,
        amountPaid: 500,
        amountPayable: 500,
        paymentDate: new Date(2026, 5, 10),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard([], rows, juneFilters, REF, null, cutoff());
    assert.equal(payload.overduePayables.length, 0);
  });

  it("AP intercompany não aparece em Pagamentos vencidos", () => {
    const rows = [
      apRow({
        externalId: 20,
        companyName: "LAZARIOS",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
        balancePayable: 9000,
        dueDate: new Date(2026, 5, 5),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard(
      [],
      rows,
      { ...juneFilters, companyName: "LAZARIOS" },
      REF,
      null,
      cutoff()
    );
    assert.equal(payload.overduePayables.length, 0);
  });

  it("AP externo Koppetel/Lazarios/SM aparece quando não é intercompany", () => {
    const rows = [
      apRow({
        externalId: 30,
        companyName: "KOPPETEL",
        personName: "Fornecedor Nacional Ltda",
        personCnpj: "33.333.333/0001-33",
        balancePayable: 1200,
        dueDate: new Date(2026, 5, 8),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard([], rows, juneFilters, REF, null, cutoff());
    assert.equal(payload.overduePayables.length, 1);
    assert.equal(payload.overduePayables[0]!.personName, "Fornecedor Nacional Ltda");
  });

  it("AP pedido de compra/agenda (type=2) não aparece na visão gerencial", () => {
    const rows = [
      apRow({
        externalId: 40,
        type: 2,
        description: "Agenda compras",
        balancePayable: 3000,
        dueDate: new Date(2026, 5, 4),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard([], rows, juneFilters, REF, null, cutoff());
    assert.equal(payload.overduePayables.length, 0);
  });

  it("AP vencido fresh com saldo > 0 aparece em Pagamentos vencidos", () => {
    const rows = [
      apRow({
        externalId: 50,
        balancePayable: 2500,
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const payload = buildFinanceCashFlowDashboard([], rows, juneFilters, REF, null, cutoff());
    assert.equal(payload.overduePayables.length, 1);
    assert.equal(payload.overduePayables[0]!.amount, 2500);
    assert.ok((payload.overduePayables[0]!.daysOverdue ?? 0) > 0);
  });

  it("Fluxo de Caixa e Contas a Pagar usam a mesma regra para AP gerencial vencido", () => {
    const rows = [
      apRow({ externalId: 60, balancePayable: 800, dueDate: new Date(2026, 5, 3) }),
      apRow({
        externalId: 61,
        syncedAt: STALE_SYNC,
        balancePayable: 9999,
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const apFilters = {
      status: "all" as const,
      year: 2026,
      month: 6,
    };
    const managementRows = filterFinanceApManagementReportRows(
      rows as FinanceApDashboardRow[],
      apFilters,
      REF,
      cutoff()
    );
    const apDash = buildFinanceAccountsPayableDashboard(
      rows as FinanceApDashboardRow[],
      apFilters,
      REF,
      cutoff()
    );
    const payload = buildFinanceCashFlowDashboard([], rows, juneFilters, REF, null, cutoff());

    const apOverdueIds = managementRows
      .filter((row) => classifyFinanceApTitle(row, REF) === "overdue")
      .map((row) => row.externalId)
      .sort((a, b) => a - b);
    const fcOverdueIds = payload.overduePayables.map((row) => row.externalId).sort((a, b) => a - b);

    assert.deepEqual(fcOverdueIds, apOverdueIds);
    assert.ok(apDash.cards.overdueAmount > 0);
    assert.equal(fcOverdueIds.includes(61), false);
  });

  it("fornecedores do exemplo stale não aparecem em Pagamentos vencidos", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      ghostSupplierRows(),
      { viewMode: "projected", dateBase: "due", status: "all", year: 2026 },
      REF,
      null,
      cutoff()
    );
    const names = payload.overduePayables.map((row) => row.personName);
    for (const supplier of REPORTED_GHOST_SUPPLIERS) {
      assert.ok(!names.includes(supplier), `stale ${supplier} não deve aparecer`);
    }
    assert.equal(payload.overduePayables.length, 0);
  });
});
