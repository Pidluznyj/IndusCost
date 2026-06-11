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

const REF = new Date(2026, 5, 9, 12, 0, 0, 0);

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
  it("dueDate vencido com scheduleDate futuro não entra como atrasado", () => {
    const title = row({
      externalId: 1,
      dueDate: new Date(2026, 5, 2),
      scheduleDate: new Date(2026, 5, 21),
      balancePayable: 13649.24,
    });
    assert.equal(classifyFinanceApTitle(title, REF), "upcoming");
    assert.equal(isAccountsPayableOverdue(title, REF), false);
    assert.equal(computeFinanceApDaysOverdue(title, REF), 0);
  });

  it("dueDate vencido sem scheduleDate entra como atrasado", () => {
    const title = row({
      externalId: 2,
      dueDate: new Date(2026, 4, 10),
      scheduleDate: null,
      balancePayable: 942.81,
    });
    assert.equal(classifyFinanceApTitle(title, REF), "overdue");
    assert.equal(isAccountsPayableOverdue(title, REF), true);
    assert.ok(computeFinanceApDaysOverdue(title, REF) > 0);
  });

  it("scheduleDate vencido entra como atrasado", () => {
    const title = row({
      externalId: 3,
      dueDate: new Date(2027, 5, 11),
      scheduleDate: new Date(2026, 4, 1),
      balancePayable: 299.83,
    });
    assert.equal(classifyFinanceApTitle(title, REF), "overdue");
    assert.equal(getAccountsPayableOperationalDueDate(title)?.toISOString(), title.scheduleDate?.toISOString());
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
    const filtered = filterFinanceApRows([title], { status: "all", year: 2026 }, REF);
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
    const dash = buildFinanceAccountsPayableDashboard([title], { status: "all", year: 2026 }, REF);
    assert.equal(dash.cards.openTitlesCount, 0);
    assert.equal(dash.purchaseOrderScheduleAudit.excludedCount, 1);
    assert.equal(dash.purchaseOrderScheduleAudit.excludedAmount, 800);
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
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all", year: 2026 }, REF);
    assert.equal(dash.cards.overdueAmount, 100);
    assert.equal(dash.cards.totalRecords, 1);
    assert.equal(dash.criticalTitles.length, 1);
    assert.equal(dash.supplierRanking.length, 1);
    assert.equal(dash.agingBuckets.find((b) => b.key === "overdue31to60")?.amount, 100);

    const csv = buildFinanceApExportCsv(rows, { status: "all", year: 2026 }, REF);
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
      REF
    );
    assert.match(cells.join(","), /09\/06\/2026/);
    assert.match(cells.join(","), /21\/06\/2026/);
    assert.match(cells.join(","), /Não/);
    const poCells = mapFinanceApRowToExportCells(
      row({
        externalId: 11,
        type: 2,
        description: "Pedido de compra PC 1",
      }),
      REF
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
      REF
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
