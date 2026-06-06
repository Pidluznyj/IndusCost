import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceApExportCsv,
  financeApExportCellsSafe,
  mapFinanceApRowToExportCells,
} from "./financeAccountsPayableExport.js";
import { financeApExportFilename } from "./financeAccountsPayableFormat.js";

function row(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    documentNumber: "NF-100",
    suspendPayment: false,
    description: "Serviço",
    nomusStatus: false,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsPayableExport", () => {
  it("gera CSV respeitando filtro de status", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const csvAll = buildFinanceApExportCsv(rows, { status: "all" }, REF);
    const csvOverdue = buildFinanceApExportCsv(rows, { status: "overdue" }, REF);
    assert.ok(csvAll.includes("ID Nomus"));
    assert.ok(csvAll.split("\n").length > csvOverdue.split("\n").length);
  });

  it("export respeita filtro year/month", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 4, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 3, dueDate: new Date(2026, 6, 1) }),
    ];
    const csv = buildFinanceApExportCsv(
      rows,
      { status: "all", year: 2026, month: 6 },
      REF
    );
    assert.match(csv, /2/);
    assert.doesNotMatch(csv, /\n3,/);
  });

  it("export inclui coluna documento e respeita filtro documentQuery", () => {
    const rows = [
      row({ externalId: 1, sourceInvoiceId: 10, documentNumber: "NF-10" }),
      row({ externalId: 2, sourceInvoiceId: null, documentNumber: "DOC-2" }),
    ];
    const csv = buildFinanceApExportCsv(rows, { status: "all", documentQuery: "DOC-2" }, REF);
    assert.match(csv, /DOC-2/);
    assert.doesNotMatch(csv.split("\n").slice(1).join("\n"), /NF-10/);
  });

  it("células exportadas não contêm NaN", () => {
    const cells = mapFinanceApRowToExportCells(row({ externalId: 1 }), REF);
    assert.ok(financeApExportCellsSafe(cells));
    assert.ok(cells.every((c) => !c.includes("undefined")));
  });

  it("nome do arquivo segue padrão contas-a-pagar-YYYY-MM-DD.csv", () => {
    assert.equal(
      financeApExportFilename(new Date(2026, 5, 6)),
      "contas-a-pagar-2026-06-06.csv"
    );
  });
});
