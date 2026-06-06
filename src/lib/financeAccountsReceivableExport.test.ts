import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArExportCsv,
  financeArExportCellsSafe,
  mapFinanceArRowToExportCells,
} from "./financeAccountsReceivableExport.js";
import { financeArExportFilename } from "./financeAccountsReceivableFormat.js";

function row(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    description: "Serviço",
    nomusStatus: false,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsReceivableExport", () => {
  it("gera CSV respeitando filtro de status", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const csvAll = buildFinanceArExportCsv(rows, { status: "all" }, REF);
    const csvOverdue = buildFinanceArExportCsv(rows, { status: "overdue" }, REF);
    assert.ok(csvAll.includes("ID Nomus"));
    assert.ok(csvAll.split("\n").length > csvOverdue.split("\n").length);
  });

  it("células exportadas não contêm NaN", () => {
    const cells = mapFinanceArRowToExportCells(row({ externalId: 1 }), REF);
    assert.ok(financeArExportCellsSafe(cells));
    assert.ok(cells.every((c) => !c.includes("undefined")));
  });

  it("nome do arquivo segue padrão contas-a-receber-YYYY-MM-DD.csv", () => {
    assert.equal(
      financeArExportFilename(new Date(2026, 5, 6)),
      "contas-a-receber-2026-06-06.csv"
    );
  });
});
