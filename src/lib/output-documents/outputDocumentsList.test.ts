/**
 * DS-04.1 — Testes de valores, cancelados, paginação e filtros financeiros.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutputDocumentListItem,
  buildOutputDocumentsListSummary,
  compareOutputDocumentListRows,
  matchesFinancialFilters,
  matchesTriState,
  needsFinancialPostFilter,
  paginateRows,
  resolveListDocumentFinancialStatus,
  type OutputDocumentListEnrichment,
  type OutputDocumentListStageRow,
} from "./outputDocumentsList.js";

const REF = new Date(2026, 6, 15, 12, 0, 0, 0);

function row(
  partial: Partial<OutputDocumentListStageRow> &
    Pick<OutputDocumentListStageRow, "id" | "externalId">
): OutputDocumentListStageRow {
  return {
    idNfe: null,
    tipoDocumentoEstoque: "DocumentoSaida",
    dataDocumento: new Date(2026, 0, 10),
    documentNumber: null,
    statusRaw: "Aberto",
    isCancelled: false,
    totalValue: 100,
    personExternalId: null,
    personName: "Cliente",
    companyExternalId: null,
    companyName: "Empresa",
    paymentTermsRaw: null,
    syncedAt: new Date(2026, 0, 11),
    ...partial,
  };
}

function enrichment(
  partial: Partial<OutputDocumentListEnrichment> = {}
): OutputDocumentListEnrichment {
  return {
    nfeByExternalId: new Map(),
    receivablesByNfe: new Map(),
    allocatedOrdersCountByDoc: new Map(),
    orderCodesByDoc: new Map(),
    customerNameByDoc: new Map(),
    companyNameByDoc: new Map(),
    referenceDate: REF,
    ...partial,
  };
}

describe("outputDocumentsList — resumo e valores", () => {
  it("exclui cancelados do valor válido e conta cancelados", () => {
    const rows = [
      row({ id: "a", externalId: 1, totalValue: 100 }),
      row({ id: "b", externalId: 2, totalValue: 50, isCancelled: true }),
      row({ id: "c", externalId: 3, totalValue: 25 }),
    ];
    const summary = buildOutputDocumentsListSummary(rows, enrichment());
    assert.equal(summary.documentCount, 3);
    assert.equal(summary.validTotalValue, 125);
    assert.equal(summary.cancelled, 1);
  });

  it("não duplica valor do documento por alocação/pedido", () => {
    const rows = [row({ id: "a", externalId: 8451, totalValue: 1000, idNfe: 7208 })];
    const enrich = enrichment({
      allocatedOrdersCountByDoc: new Map([[8451, 3]]),
      nfeByExternalId: new Map([
        [
          7208,
          {
            externalId: 7208,
            numero: "7208",
            status: 6,
            valorLiquido: 1000,
            xmlVNF: 1000,
          },
        ],
      ]),
      receivablesByNfe: new Map([
        [
          7208,
          [
            {
              externalId: 1,
              sourceInvoiceId: 7208,
              amountReceivable: 1000,
              amountReceived: 0,
              balanceReceivable: 1000,
              dueDate: new Date(2026, 7, 1),
            },
          ],
        ],
      ]),
    });

    const summary = buildOutputDocumentsListSummary(rows, enrich);
    assert.equal(summary.validTotalValue, 1000);
    assert.equal(summary.withNfe, 1);
    assert.equal(summary.withReceivable, 1);

    const item = buildOutputDocumentListItem(rows[0]!, enrich);
    assert.equal(item.totalValue, 1000);
    assert.equal(item.allocatedOrdersCount, 3);
  });

  it("Pedido via orderCodes (NfeLink) sem O2C; valor e cliente por fallback oficial", () => {
    const rows = [
      row({
        id: "a",
        externalId: 8572,
        idNfe: 7305,
        totalValue: null,
        personName: null,
        companyName: null,
        statusRaw: null,
      }),
    ];
    const enrich = enrichment({
      nfeByExternalId: new Map([
        [
          7305,
          {
            externalId: 7305,
            numero: "7305",
            status: 4,
            valorLiquido: 1500,
            xmlVNF: 1500,
          },
        ],
      ]),
      allocatedOrdersCountByDoc: new Map([[8572, 1]]),
      orderCodesByDoc: new Map([[8572, ["PD 02596"]]]),
      customerNameByDoc: new Map([[8572, "Cliente Oficial"]]),
      companyNameByDoc: new Map([[8572, "KOPPETEL"]]),
    });

    const item = buildOutputDocumentListItem(rows[0]!, enrich);
    assert.equal(item.allocatedOrdersCount, 1);
    assert.equal(item.primaryOrderCode, "PD 02596");
    assert.deepEqual(item.orderCodes, ["PD 02596"]);
    assert.equal(item.totalValue, 1500);
    assert.equal(item.customerName, "Cliente Oficial");
    assert.equal(item.companyName, "KOPPETEL");

    const summary = buildOutputDocumentsListSummary(rows, enrich);
    assert.equal(summary.validTotalValue, 1500);
    assert.equal(summary.withNfe, 1);
  });

  it("conta aguardando CR quando há NF sem títulos", () => {
    const rows = [
      row({ id: "a", externalId: 1, idNfe: 100, totalValue: 200 }),
    ];
    const enrich = enrichment({
      nfeByExternalId: new Map([
        [
          100,
          {
            externalId: 100,
            numero: "100",
            status: 6,
            valorLiquido: 200,
            xmlVNF: 200,
          },
        ],
      ]),
    });
    const financial = resolveListDocumentFinancialStatus(rows[0]!, enrich);
    assert.equal(financial.status, "aguardando_cr");

    const summary = buildOutputDocumentsListSummary(rows, enrich);
    assert.equal(summary.awaitingReceivable, 1);
    assert.equal(summary.withReceivable, 0);
    assert.equal(summary.withNfe, 1);
  });
});

describe("outputDocumentsList — filtros e paginação", () => {
  it("matchesTriState e needsFinancialPostFilter", () => {
    assert.equal(matchesTriState(true, "all"), true);
    assert.equal(matchesTriState(true, "yes"), true);
    assert.equal(matchesTriState(false, "yes"), false);
    assert.equal(matchesTriState(false, "no"), true);
    assert.equal(
      needsFinancialPostFilter({ hasReceivable: "all", financialStatus: null }),
      false
    );
    assert.equal(
      needsFinancialPostFilter({
        hasReceivable: "yes",
        financialStatus: null,
      }),
      true
    );
    assert.equal(
      needsFinancialPostFilter({
        hasReceivable: "all",
        financialStatus: "recebido",
      }),
      true
    );
  });

  it("filtra por situação financeira oficial", () => {
    const rowA = row({ id: "a", externalId: 1, idNfe: 10 });
    const enrich = enrichment({
      nfeByExternalId: new Map([
        [
          10,
          {
            externalId: 10,
            numero: "10",
            status: 6,
            valorLiquido: 100,
            xmlVNF: 100,
          },
        ],
      ]),
    });
    const financial = resolveListDocumentFinancialStatus(rowA, enrich);
    assert.equal(
      matchesFinancialFilters(financial, {
        hasReceivable: "no",
        financialStatus: "aguardando_cr",
      }),
      true
    );
    assert.equal(
      matchesFinancialFilters(financial, {
        hasReceivable: "yes",
        financialStatus: null,
      }),
      false
    );
  });

  it("paginação corta itens corretamente", () => {
    const rows = [1, 2, 3, 4, 5];
    const page1 = paginateRows(rows, 1, 2);
    assert.deepEqual(page1.items, [1, 2]);
    assert.equal(page1.totalItems, 5);
    assert.equal(page1.totalPages, 3);

    const page3 = paginateRows(rows, 3, 2);
    assert.deepEqual(page3.items, [5]);
  });

  it("ordenação por totalValue e externalId estável", () => {
    const a = row({ id: "a", externalId: 2, totalValue: 50 });
    const b = row({ id: "b", externalId: 1, totalValue: 100 });
    assert.ok(compareOutputDocumentListRows(a, b, "totalValue", "desc") > 0);
    assert.ok(compareOutputDocumentListRows(a, b, "externalId", "asc") > 0);
  });
});
