import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
  classifyFinanceApTitle,
  filterFinanceApRows,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceApExportCsv,
  mapFinanceApRowToExportCells,
} from "./financeAccountsPayableExport.js";
import {
  computeFinanceApDaysOverdue,
  getAccountsPayableOperationalDueDate,
  isAccountsPayableOverdue,
  isAccountsPayablePurchaseOrderSchedule,
} from "./financeAccountsPayableOperational.js";

const REF_JUN_9 = new Date(2026, 5, 9, 12, 0, 0, 0);
const REF_JUN_11 = new Date(2026, 5, 11, 12, 0, 0, 0);

function row(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    description: "Serviço",
    dueDate: new Date(2026, 5, 1),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: null,
    documentNumber: null,
    suspendPayment: false,
    nomusStatus: false,
    syncedAt: new Date("2026-06-09T12:00:00.000Z"),
    ...partial,
  };
}

describe("financeAccountsPayableOperational", () => {
  it("dueDate vencido com scheduleDate futuro entra como atrasado pelo vencimento", () => {
    const title = row({
      externalId: 1,
      dueDate: new Date(2026, 5, 2),
      scheduleDate: new Date(2026, 5, 21),
      balancePayable: 13649.24,
    });
    assert.equal(classifyFinanceApTitle(title, REF_JUN_9), "overdue");
    assert.equal(isAccountsPayableOverdue(title, REF_JUN_9), true);
    assert.ok(computeFinanceApDaysOverdue(title, REF_JUN_9) > 0);
    assert.equal(
      getAccountsPayableOperationalDueDate(title)?.toISOString(),
      title.dueDate?.toISOString()
    );
  });

  it("dueDate futuro com scheduleDate passado não entra como atrasado até dueDate", () => {
    const title = row({
      externalId: 3,
      dueDate: new Date(2027, 5, 11),
      scheduleDate: new Date(2026, 4, 1),
      balancePayable: 299.83,
    });
    assert.equal(classifyFinanceApTitle(title, REF_JUN_9), "upcoming");
    assert.equal(isAccountsPayableOverdue(title, REF_JUN_9), false);
    assert.equal(
      getAccountsPayableOperationalDueDate(title)?.toISOString(),
      title.dueDate?.toISOString()
    );
  });

  it("dueDate hoje com scheduleDate ontem vence hoje, não atrasado", () => {
    const title = row({
      externalId: 14945,
      personName: "CLARINDA MARQUES DE ANDRADE ADVOGADA",
      description: "HONORARIOS (Parcela 4 de 10)",
      dueDate: new Date(2026, 5, 11),
      scheduleDate: new Date(2026, 5, 10),
      balancePayable: 1350,
    });
    assert.equal(classifyFinanceApTitle(title, REF_JUN_11), "dueToday");
    assert.equal(isAccountsPayableOverdue(title, REF_JUN_11), false);
    assert.equal(computeFinanceApDaysOverdue(title, REF_JUN_11), 0);
  });

  it("dueDate ontem com scheduleDate ontem entra como atrasado", () => {
    const title = row({
      externalId: 16892,
      personName: "CIEE/PR",
      description: "Bolsa estágio",
      dueDate: new Date(2026, 5, 10),
      scheduleDate: new Date(2026, 5, 10),
      balancePayable: 942.81,
    });
    assert.equal(classifyFinanceApTitle(title, REF_JUN_11), "overdue");
    assert.equal(isAccountsPayableOverdue(title, REF_JUN_11), true);
    assert.ok(computeFinanceApDaysOverdue(title, REF_JUN_11) > 0);
  });

  it("dueDate vencido sem scheduleDate entra como atrasado", () => {
    const title = row({
      externalId: 2,
      dueDate: new Date(2026, 4, 10),
      scheduleDate: null,
      balancePayable: 942.81,
    });
    assert.equal(classifyFinanceApTitle(title, REF_JUN_9), "overdue");
    assert.equal(isAccountsPayableOverdue(title, REF_JUN_9), true);
    assert.ok(computeFinanceApDaysOverdue(title, REF_JUN_9) > 0);
  });

  it("scheduleDate futuro sem dueDate não entra como atrasado", () => {
    const title = row({
      externalId: 99,
      dueDate: null,
      scheduleDate: new Date(2026, 5, 20),
      balancePayable: 500,
    });
    assert.equal(classifyFinanceApTitle(title, REF_JUN_9), "upcoming");
    assert.equal(isAccountsPayableOverdue(title, REF_JUN_9), false);
  });

  it("type = 2 é excluído da visão gerencial", () => {
    const title = row({
      externalId: 4,
      type: 2,
      description: "Outro título",
      dueDate: new Date(2026, 4, 1),
      balancePayable: 500,
    });
    assert.equal(isAccountsPayablePurchaseOrderSchedule(title), true);
    const filtered = filterFinanceApRows([title], { status: "all", year: 2026 }, REF_JUN_9);
    assert.equal(filtered.length, 0);
  });

  it("descrição Pedido de compra PC é excluída", () => {
    const title = row({
      externalId: 5,
      description: "Pedido de compra PC 12345",
      dueDate: new Date(2026, 4, 1),
      balancePayable: 800,
    });
    assert.equal(isAccountsPayablePurchaseOrderSchedule(title), true);
    const dash = buildFinanceAccountsPayableDashboard(
      [title],
      { status: "all", year: 2026 },
      REF_JUN_9
    );
    assert.equal(dash.cards.openTitlesCount, 0);
    assert.equal(dash.purchaseOrderScheduleAudit.excludedCount, 1);
    assert.equal(dash.purchaseOrderScheduleAudit.excludedAmount, 800);
  });

  it("casos reais 12732/13529/14945 saem do vencido; apenas CIEE permanece em 11/06", () => {
    const rows = [
      row({
        externalId: 12732,
        personName: "PATRIMONIAL PK PARTICIPACOES E ADMINISTRACAO DE BENS LTDA",
        description: "Aluguel",
        dueDate: new Date(2026, 5, 30),
        scheduleDate: new Date(2025, 8, 30),
        balancePayable: 90000,
      }),
      row({
        externalId: 13529,
        personName: "DINALTE FERREIRA DOS SANTOS",
        description: "Salário Liquido + vr + bonus absenteísmo (Parcela 6 de 12)",
        dueDate: new Date(2026, 6, 6),
        scheduleDate: new Date(2026, 5, 7),
        balancePayable: 4375.47,
      }),
      row({
        externalId: 14945,
        personName: "CLARINDA MARQUES DE ANDRADE ADVOGADA",
        description: "HONORARIOS (Parcela 4 de 10)",
        dueDate: new Date(2026, 5, 11),
        scheduleDate: new Date(2026, 5, 10),
        balancePayable: 1350,
      }),
      row({
        externalId: 16892,
        personName: "CIEE/PR",
        description: "Bolsa estágio - Nivea Maria",
        dueDate: new Date(2026, 5, 10),
        scheduleDate: new Date(2026, 5, 10),
        balancePayable: 942.81,
      }),
    ];

    const dash = buildFinanceAccountsPayableDashboard(
      rows,
      { status: "all", year: 2026 },
      REF_JUN_11
    );
    const overdueRows = rows.filter(
      (r) => classifyFinanceApTitle(r, REF_JUN_11) === "overdue"
    );

    assert.equal(overdueRows.length, 1);
    assert.equal(overdueRows[0]?.externalId, 16892);
    assert.equal(dash.cards.overdueAmount, 942.81);
  });

  it("exclusão de pedido de compra afeta cards, aging, ranking, críticos e export", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 4, 1) }),
      row({
        externalId: 2,
        type: 2,
        description: "Pedido de compra PC 999",
        balancePayable: 371635.43,
        dueDate: new Date(2026, 4, 1),
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(
      rows,
      { status: "all", year: 2026 },
      REF_JUN_9
    );
    assert.equal(dash.cards.overdueAmount, 100);
    assert.equal(dash.cards.totalRecords, 1);
    assert.equal(dash.criticalTitles.length, 1);
    assert.equal(dash.supplierRanking.length, 1);
    assert.equal(dash.agingBuckets.find((b) => b.key === "overdue31to60")?.amount, 100);

    const csv = buildFinanceApExportCsv(rows, { status: "all", year: 2026 }, REF_JUN_9);
    assert.doesNotMatch(csv, /Pedido de compra PC/);
    assert.match(csv, /Fornecedor X/);
  });

  it("export contém colunas operacionais e motivo de exclusão", () => {
    const cells = mapFinanceApRowToExportCells(
      row({
        externalId: 10,
        dueDate: new Date(2026, 4, 1),
        scheduleDate: new Date(2026, 5, 21),
      }),
      REF_JUN_9
    );
    assert.match(cells.join(","), /01\/05\/2026/);
    assert.match(cells.join(","), /21\/06\/2026/);
    assert.match(cells.join(","), /21\/06\/2026/);
    assert.match(cells.join(","), /Não/);
    const poCells = mapFinanceApRowToExportCells(
      row({
        externalId: 11,
        type: 2,
        description: "Pedido de compra PC 1",
      }),
      REF_JUN_9
    );
    assert.match(poCells.join(","), /Sim/);
    assert.match(poCells.join(","), /Agenda de pedido de compra/);
  });

  it("métricas numéricas não retornam NaN ou Infinity", () => {
    const dash = buildFinanceAccountsPayableDashboard(
      [
        row({ externalId: 1, dueDate: new Date(2026, 4, 1), scheduleDate: new Date(2026, 5, 21) }),
        row({ externalId: 2, type: 2, balancePayable: 99999 }),
      ],
      { status: "all", year: 2026 },
      REF_JUN_9
    );
    for (const value of [
      dash.cards.overdueAmount,
      dash.cards.overduePercent,
      dash.cards.avgDaysOverdue,
      dash.purchaseOrderScheduleAudit.excludedAmount,
      ...dash.agingBuckets.map((b) => b.percentOfOpenAmount),
    ]) {
      if (value == null) continue;
      assert.ok(Number.isFinite(value));
      assert.notEqual(value, Infinity);
    }
  });
});
