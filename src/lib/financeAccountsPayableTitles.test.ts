import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceApTitlesPayload,
  parseFinanceApTitlesQuery,
} from "./financeAccountsPayableTitles.js";

function row(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: null,
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "Boleto",
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

describe("financeAccountsPayableTitles", () => {
  it("pagina resultados", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ externalId: i + 1, balancePayable: 100, dueDate: new Date(2026, 5, 10 + i) })
    );
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 2,
        limit: 2,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        localFilter: "all",
      },
      REF
    );
    assert.equal(payload.total, 5);
    assert.equal(payload.totalPages, 3);
    assert.equal(payload.page, 2);
    assert.equal(payload.items.length, 2);
  });

  it("filtra overdueOnly e busca por NF", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 1) }),
      row({
        externalId: 2,
        balancePayable: 200,
        dueDate: new Date(2026, 5, 20),
        documentNumber: "NF-XYZ",
      }),
    ];
    const overdue = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        localFilter: "all",
        overdueOnly: true,
      },
      REF
    );
    assert.equal(overdue.total, 1);
    assert.equal(overdue.items[0]?.externalId, 1);

    const search = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        localFilter: "all",
        search: "xyz",
      },
      REF
    );
    assert.equal(search.total, 1);
    assert.equal(search.items[0]?.externalId, 2);
  });

  it("ordena por saldo desc", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 50, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balancePayable: 500, dueDate: new Date(2026, 5, 11) }),
    ];
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "balancePayable",
        sortDirection: "desc",
        filters: { status: "all" },
        localFilter: "all",
      },
      REF
    );
    assert.equal(payload.items[0]?.externalId, 2);
  });

  it("parseFinanceApTitlesQuery interpreta params", () => {
    const q = parseFinanceApTitlesQuery({
      page: "2",
      limit: "25",
      sortBy: "balancePayable",
      sortDirection: "desc",
      overdueOnly: "true",
      search: "fornecedor",
      status: "overdue",
      qualityAlert: "missingDueDate",
    });
    assert.equal(q.page, 2);
    assert.equal(q.limit, 25);
    assert.equal(q.sortBy, "balancePayable");
    assert.equal(q.sortDirection, "desc");
    assert.equal(q.overdueOnly, true);
    assert.equal(q.search, "fornecedor");
    assert.equal(q.filters.status, "overdue");
    assert.equal(q.qualityAlert, "missingDueDate");
    assert.equal(q.localFilter, "all");
  });

  it("parseFinanceApTitlesQuery interpreta localFilter", () => {
    const q = parseFinanceApTitlesQuery({ localFilter: "purchaseOrder", page: "1" });
    assert.equal(q.localFilter, "purchaseOrder");
  });

  it("filtra por qualityAlert", () => {
    const rows = [
      row({ externalId: 1, personCnpj: null, balancePayable: 100, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        localFilter: "all",
        qualityAlert: "missingPersonCnpj",
      },
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
  });

  it("pagina com filtro year/month", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 4, 10) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 3, dueDate: new Date(2026, 5, 20) }),
      row({ externalId: 4, dueDate: new Date(2026, 6, 1) }),
    ];
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 1,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all", year: 2026, month: 6 },
        localFilter: "all",
      },
      REF
    );
    assert.equal(payload.total, 2);
    assert.equal(payload.totalPages, 2);
    assert.equal(payload.items[0]?.externalId, 2);
  });

  it("filtra por mês + busca", () => {
    const rows = [
      row({
        externalId: 1,
        dueDate: new Date(2026, 5, 10),
        documentNumber: "NF-AAA",
      }),
      row({
        externalId: 2,
        dueDate: new Date(2026, 5, 20),
        documentNumber: "NF-BBB",
      }),
      row({
        externalId: 3,
        dueDate: new Date(2026, 4, 20),
        documentNumber: "NF-BBB",
      }),
    ];
    const payload = buildFinanceApTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all", year: 2026, month: 6 },
        localFilter: "all",
        search: "bbb",
      },
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 2);
  });

  it("parseFinanceApTitlesQuery interpreta year/month", () => {
    const q = parseFinanceApTitlesQuery({ year: "2026", month: "6", page: "1" });
    assert.equal(q.filters.year, 2026);
    assert.equal(q.filters.month, 6);
  });

  it("parseFinanceApTitlesQuery interpreta documentQuery", () => {
    const q = parseFinanceApTitlesQuery({ documentQuery: "NF-10", page: "1" });
    assert.equal(q.filters.documentQuery, "NF-10");
  });
});
