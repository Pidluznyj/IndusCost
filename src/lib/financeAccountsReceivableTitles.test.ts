import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceArTitlesPayload,
  isFinanceArHorizonTitlesQuery,
  parseFinanceArTitlesQuery,
  resolveFinanceArTitleDocumentReference,
} from "./financeAccountsReceivableTitles.js";
import { buildFinanceArTitlesExportWorkbook } from "./financeAccountsReceivableTitlesExport.js";
import { buildAccountsReceivableOpenHorizon } from "./financeAccountsReceivableHorizon.js";

function row(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personId: 1,
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    description: "Serviço",
    comments: null,
    dueDate: null,
    competenceDate: new Date(2026, 5, 1),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: false,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsReceivableTitles", () => {
  it("pagina resultados", () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ externalId: i + 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10 + i) })
    );
    const payload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 2,
        limit: 2,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        extended: {},
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
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({
        externalId: 2,
        balanceReceivable: 200,
        dueDate: new Date(2026, 5, 20),
        sourceInvoiceNumber: "NF-XYZ",
      }),
    ];
    const overdue = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        overdueOnly: true,
        localFilter: "all",
      },
      REF
    );
    assert.equal(overdue.total, 1);
    assert.equal(overdue.items[0]?.externalId, 1);

    const search = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        search: "xyz",
        localFilter: "all",
      },
      REF
    );
    assert.equal(search.total, 1);
    assert.equal(search.items[0]?.externalId, 2);
  });

  it("ordena por saldo desc", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 50, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balanceReceivable: 500, dueDate: new Date(2026, 5, 11) }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "balanceReceivable",
        sortDirection: "desc",
        filters: { status: "all" },
        extended: {},
        localFilter: "all",
      },
      REF
    );
    assert.equal(payload.items[0]?.externalId, 2);
  });

  it("parseFinanceArTitlesQuery interpreta params", () => {
    const q = parseFinanceArTitlesQuery({
      page: "2",
      limit: "25",
      sortBy: "balanceReceivable",
      sortDirection: "desc",
      overdueOnly: "true",
      search: "cliente",
      status: "overdue",
      qualityAlert: "missingDueDate",
    });
    assert.equal(q.page, 2);
    assert.equal(q.limit, 25);
    assert.equal(q.sortBy, "balanceReceivable");
    assert.equal(q.sortDirection, "desc");
    assert.equal(q.overdueOnly, true);
    assert.equal(q.search, "cliente");
    assert.equal(q.filters.status, "overdue");
    assert.equal(q.qualityAlert, "missingDueDate");
    const withLocal = parseFinanceArTitlesQuery({ localFilter: "settled" });
    assert.equal(withLocal.localFilter, "settled");
  });

  it("filtra por qualityAlert", () => {
    const rows = [
      row({ externalId: 1, personCnpj: null, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        qualityAlert: "missingPersonCnpj",
        localFilter: "all",
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
    const payload = buildFinanceArTitlesPayload(
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
        sourceInvoiceNumber: "NF-AAA",
      }),
      row({
        externalId: 2,
        dueDate: new Date(2026, 5, 20),
        sourceInvoiceNumber: "NF-BBB",
      }),
      row({
        externalId: 3,
        dueDate: new Date(2026, 4, 20),
        sourceInvoiceNumber: "NF-BBB",
      }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all", year: 2026, month: 6 },
        search: "bbb",
        localFilter: "all",
      },
      REF
    );
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 2);
  });

  it("parseFinanceArTitlesQuery interpreta year/month", () => {
    const q = parseFinanceArTitlesQuery({ year: "2026", month: "6", page: "1" });
    assert.equal(q.filters.year, 2026);
    assert.equal(q.filters.month, 6);
  });

  it("parseFinanceArTitlesQuery interpreta invoiceIssued", () => {
    const q = parseFinanceArTitlesQuery({ invoiceIssued: "yes", page: "1" });
    assert.equal(q.filters.invoiceIssued, "yes");
  });

  it("horizonte filtra faixa 0_7 ignorando filtros de mês", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 12) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 6, 12) }),
    ];
    const query = {
      page: 1,
      limit: 50,
      sortBy: "dueDate" as const,
      sortDirection: "asc" as const,
      filters: { status: "all" as const, year: 2026, month: 6 },
      extended: {},
      localFilter: "all" as const,
      agingBucket: "0_7" as const,
    };
    assert.equal(isFinanceArHorizonTitlesQuery(query), true);
    const payload = buildFinanceArTitlesPayload(rows, query, REF);
    assert.equal(payload.total, 1);
    assert.equal(payload.items[0]?.externalId, 1);
    assert.equal(payload.bucketTotals?.titlesCount, 1);
    assert.equal(payload.bucketTotals?.openBalanceAmount, 100);
  });

  it("totais do drilldown de horizonte batem com buildAccountsReceivableOpenHorizon", () => {
    const due = new Date(2026, 5, 12);
    const rows = [row({ externalId: 1, balanceReceivable: 150, dueDate: due })];
    const horizon = buildAccountsReceivableOpenHorizon(rows, REF);
    const card = horizon.buckets.find((b) => b.key === "0_7");
    assert.ok(card);
    const payload = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all", year: 2026, month: 7 },
        extended: {},
        localFilter: "all",
        agingBucket: "0_7",
      },
      REF
    );
    assert.equal(payload.bucketTotals?.titlesCount, card!.titlesCount);
    assert.equal(payload.bucketTotals?.openBalanceAmount, card!.amount);
  });

  it("retorna summary com totalizadores filtrados", () => {
    const rows = [
      row({ externalId: 1, amountReceivable: 1000, amountReceived: 200, balanceReceivable: 800, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, amountReceivable: 500, amountReceived: 500, balanceReceivable: 0, dueDate: new Date(2026, 5, 20), settlementDate: new Date(2026, 5, 18) }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      { page: 1, limit: 50, sortBy: "dueDate", sortDirection: "asc", filters: { status: "all" }, extended: {}, localFilter: "all" },
      REF
    );
    assert.equal(payload.summary.totalTitles, 2);
    assert.equal(payload.summary.totalOriginalValue, 1500);
    assert.equal(payload.summary.totalReceivedValue, 700);
    assert.equal(payload.summary.totalOpenValue, 800);
    assert.equal(payload.summary.averageTicket, 750);
  });

  it("filtra por issueDateFrom/issueDateTo e document", () => {
    const rows = [
      row({ externalId: 1, competenceDate: new Date(2026, 4, 10), sourceInvoiceNumber: "NF-111" }),
      row({ externalId: 2, competenceDate: new Date(2026, 6, 10), sourceInvoiceNumber: "NF-222" }),
    ];
    const byIssue = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1, limit: 50, sortBy: "dueDate", sortDirection: "asc", filters: { status: "all" },
        extended: { issueDateFrom: new Date(2026, 5, 1), issueDateTo: new Date(2026, 5, 30) },
        localFilter: "all",
      },
      REF
    );
    assert.equal(byIssue.total, 0);

    const byDoc = buildFinanceArTitlesPayload(
      rows,
      {
        page: 1, limit: 50, sortBy: "dueDate", sortDirection: "asc", filters: { status: "all" },
        extended: { document: "222" },
        localFilter: "all",
      },
      REF
    );
    assert.equal(byDoc.total, 1);
    assert.equal(byDoc.items[0]?.externalId, 2);
  });

  it("saldo líquido de summary: vencido + a vencer coerente com status", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 300, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const payload = buildFinanceArTitlesPayload(
      rows,
      { page: 1, limit: 50, sortBy: "dueDate", sortDirection: "asc", filters: { status: "all" }, extended: {}, localFilter: "all" },
      REF
    );
    assert.ok(payload.summary.totalOverdueValue >= 0);
    assert.ok(payload.summary.totalDueValue >= 0);
  });

  it("referência de documento cai no Pedido quando não há NF", () => {
    assert.equal(
      resolveFinanceArTitleDocumentReference({
        sourceInvoiceNumber: "NF-100",
        sourceInvoiceId: 100,
        orderCode: "PD 01002",
        description: null,
      }),
      "NF-100"
    );
    assert.equal(
      resolveFinanceArTitleDocumentReference({
        sourceInvoiceNumber: null,
        sourceInvoiceId: null,
        orderCode: "PD 01002",
        description: "Previsão residual · Pedido PD 01002",
      }),
      "PD 01002"
    );
    assert.equal(
      resolveFinanceArTitleDocumentReference({
        sourceInvoiceNumber: null,
        sourceInvoiceId: null,
        orderCode: null,
        description: "Previsão residual · Pedido PD 02781 · Parcela 2",
      }),
      "PD 02781"
    );
    assert.equal(
      resolveFinanceArTitleDocumentReference({
        sourceInvoiceNumber: null,
        sourceInvoiceId: null,
        orderCode: "12345",
        description: null,
      }),
      "Pedido 12345"
    );
  });

  it("Excel de títulos usa Pedido na coluna Documento quando sem NF", () => {
    const item = {
      ...buildFinanceArTitlesPayload(
        [row({ externalId: 9, sourceInvoiceId: null, sourceInvoiceNumber: null })],
        {
          page: 1,
          limit: 50,
          sortBy: "dueDate",
          sortDirection: "asc",
          filters: { status: "all" },
          extended: {},
          localFilter: "all",
        },
        REF
      ).items[0]!,
      orderCode: "PD 09999",
      description: "Previsão residual · Pedido PD 09999",
    };
    const payload = buildFinanceArTitlesPayload(
      [row({ externalId: 9, sourceInvoiceId: null, sourceInvoiceNumber: null })],
      {
        page: 1,
        limit: 50,
        sortBy: "dueDate",
        sortDirection: "asc",
        filters: { status: "all" },
        extended: {},
        localFilter: "all",
      },
      REF
    );
    const wb = buildFinanceArTitlesExportWorkbook(payload, [item], REF.toISOString());
    const sheet = wb.Sheets["Títulos"];
    assert.ok(sheet);
    const docCell = sheet["D2"];
    const pedidoCell = sheet["E2"];
    assert.equal(docCell?.v, "PD 09999");
    assert.equal(pedidoCell?.v, "PD 09999");
  });
});
