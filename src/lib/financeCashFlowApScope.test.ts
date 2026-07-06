import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
} from "./financeCashFlowDashboard.js";

const REF = new Date(2026, 5, 9);

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 1,
    companyName: "KOPPETEL",
    personName: "Fornecedor Externo Ltda",
    personCnpj: "22.222.222/0001-22",
    description: "Nota fiscal serviço",
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  };
}

describe("financeCashFlowApIntercompany", () => {
  const juneKoppetelFilters = {
    viewMode: "combined" as const,
    dateBase: "due" as const,
    status: "all" as const,
    year: 2026,
    month: 6,
    companyName: "KOPPETEL",
  };

  it("junho/2026 inclui AP externo da Koppetel", () => {
    const rows = [
      apRow({ externalId: 1, balancePayable: 500, amountPayable: 500 }),
      apRow({
        externalId: 2,
        personName: "Lazarios Comercio de Plasticos LTDA",
        personCnpj: "72.569.510/0001-95",
        balancePayable: 1000,
        amountPayable: 1000,
        dueDate: new Date(2026, 5, 15),
      }),
    ];

    const payload = buildFinanceCashFlowDashboard([], rows, juneKoppetelFilters, REF);
    const jun = payload.monthlySeries.find((p) => p.month === 6);
    assert.ok(jun);
    assert.equal(jun!.outflowAmount, 500);
    assert.equal(payload.dataSanitization.ignoredInternalGroupPayables, 1);
  });

  it("junho/2026 exclui somente intercompany entre empresas do grupo", () => {
    const rows = [
      apRow({
        externalId: 10,
        companyName: "LAZARIOS",
        personName: "Koppetel Comercio de Plasticos LTDA",
        personCnpj: "14.055.501/0001-80",
        balancePayable: 800,
        dueDate: new Date(2026, 5, 12),
      }),
      apRow({
        externalId: 11,
        companyName: "LAZARIOS",
        personName: "Fornecedor Nacional Ltda",
        personCnpj: "33.333.333/0001-33",
        balancePayable: 200,
        dueDate: new Date(2026, 5, 18),
      }),
    ];

    const payload = buildFinanceCashFlowDashboard(
      [],
      rows,
      { ...juneKoppetelFilters, companyName: "LAZARIOS" },
      REF
    );
    const jun = payload.monthlySeries.find((p) => p.month === 6);
    assert.equal(jun!.outflowAmount, 200);
  });

  it("fluxo mensal AP aloca por dueDate na visão padrão", () => {
    const rows = [
      apRow({
        externalId: 10,
        dueDate: new Date(2026, 5, 10),
        scheduleDate: new Date(2026, 6, 1),
        paymentDate: new Date(2026, 6, 5),
        settlementDate: new Date(2026, 6, 5),
        amountPayable: 800,
        amountPaid: 800,
        balancePayable: 0,
      }),
    ];

    const payload = buildFinanceCashFlowDashboard(
      [],
      rows,
      { ...juneKoppetelFilters, viewMode: "combined" },
      REF
    );
    const jun = payload.monthlySeries.find((p) => p.month === 6);
    const jul = payload.monthlySeries.find((p) => p.month === 7);
    assert.ok(jun);
    assert.ok(jul);
    assert.equal(jun!.outflowAmount, 800);
    assert.equal(jul!.outflowAmount ?? 0, 0);
  });

  it("Contas a Pagar e Fluxo de Caixa usam a mesma base AP (externo + intercompany)", () => {
    const rows: FinanceApDashboardRow[] = [
      apRow({ externalId: 1, balancePayable: 300, amountPayable: 300 }),
      apRow({
        externalId: 2,
        personName: "SM Comercio de Plasticos LTDA - SM",
        personCnpj: "55.717.719/0001-30",
        balancePayable: 700,
        amountPayable: 700,
        dueDate: new Date(2026, 5, 25),
      }),
    ];

    const apFilters = {
      status: "all" as const,
      year: 2026,
      month: 6,
      companyName: "KOPPETEL",
    };
    const apDashboard = buildFinanceAccountsPayableDashboard(rows, apFilters, REF);
    const cashFlow = buildFinanceCashFlowDashboard([], rows, juneKoppetelFilters, REF);
    const jun = cashFlow.monthlySeries.find((p) => p.month === 6);

    assert.equal(apDashboard.cards.totalPayableAmount, 300);
    assert.equal(jun!.outflowAmount, 300);
  });
});
