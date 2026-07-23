/**
 * Regressão: enrich da lista usa SalesOrderNfeLink ∪ O2C e relação Prisma `Customer`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOutputDocumentsOrderSearchTerms,
  loadOutputDocumentsList,
} from "./outputDocumentsList.server.js";

describe("buildOutputDocumentsOrderSearchTerms", () => {
  it("gera variantes PD / número para filtro de pedido", () => {
    const terms = buildOutputDocumentsOrderSearchTerms("2716");
    assert.ok(terms.includes("2716"));
    assert.ok(terms.includes("PD2716"));
    assert.ok(terms.some((t) => /PD\s*0*2716/i.test(t)));
  });
});

describe("outputDocumentsList.server — enrich Pedido/Cliente", () => {
  it("seleciona Customer (Prisma) e preenche pedido/cliente via NfeLink", async () => {
    let salesOrderSelect: unknown = null;

    const prisma = {
      nomusStockDocument: {
        findMany: async () => [
          {
            id: "doc-1",
            externalId: 8572,
            idNfe: 7305,
            tipoDocumentoEstoque: "DocumentoSaida",
            dataDocumento: new Date(2026, 6, 9),
            documentNumber: "8572",
            statusRaw: null,
            isCancelled: false,
            totalValue: null,
            personExternalId: null,
            personName: null,
            companyExternalId: null,
            companyName: null,
            paymentTermsRaw: null,
            syncedAt: new Date(2026, 6, 10),
          },
        ],
      },
      nomusNfe: {
        findMany: async () => [
          {
            externalId: 7305,
            numero: "7305",
            status: 4,
            valorLiquido: 1500,
            xmlVNF: 1500,
          },
        ],
      },
      nomusAccountsReceivable: {
        findMany: async () => [],
      },
      orderToCashAuditFact: {
        findMany: async () => [],
      },
      salesOrderNfeLink: {
        findMany: async () => [
          {
            nfeExternalId: 7305,
            salesOrderId: "order-1",
            orderCode: "PD 02596",
          },
        ],
      },
      salesOrder: {
        findMany: async (args: { select?: unknown }) => {
          salesOrderSelect = args.select;
          return [
            {
              id: "order-1",
              orderCode: "PD 02596",
              companyIssuer: "KOPPETEL",
              Customer: {
                tradeName: "Cliente Oficial",
                companyName: "Cliente Oficial LTDA",
              },
            },
          ];
        },
      },
    };

    const payload = await loadOutputDocumentsList(
      { page: 1, pageSize: 50 },
      { prisma: prisma as never, now: new Date(2026, 6, 15) }
    );

    assert.ok(salesOrderSelect);
    assert.ok(
      Object.prototype.hasOwnProperty.call(salesOrderSelect, "Customer"),
      "deve usar relação Prisma Customer (maiúsculo)"
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(salesOrderSelect, "customer"),
      false,
      "não deve usar customer minúsculo (quebra a API)"
    );

    assert.equal(payload.items.length, 1);
    const item = payload.items[0]!;
    assert.equal(item.primaryOrderCode, "PD 02596");
    assert.equal(item.customerName, "Cliente Oficial");
    assert.equal(item.companyName, "KOPPETEL");
    assert.equal(item.totalValue, 1500);
  });

  it("filtro de cliente alcança documento com personName nulo via Pedido/Customer", async () => {
    const whereCalls: unknown[] = [];
    const prisma = {
      nomusStockDocument: {
        findMany: async (args: { where?: unknown }) => {
          whereCalls.push(args.where);
          return [
            {
              id: "doc-1",
              externalId: 8572,
              idNfe: 7305,
              tipoDocumentoEstoque: "DocumentoSaida",
              dataDocumento: new Date(2026, 6, 9),
              documentNumber: "8572",
              statusRaw: null,
              isCancelled: false,
              totalValue: null,
              personExternalId: null,
              personName: null,
              companyExternalId: null,
              companyName: null,
              paymentTermsRaw: null,
              syncedAt: new Date(2026, 6, 10),
            },
          ];
        },
      },
      nomusNfe: {
        findMany: async () => [
          {
            externalId: 7305,
            numero: "7305",
            status: 4,
            valorLiquido: 1500,
            xmlVNF: 1500,
          },
        ],
      },
      nomusAccountsReceivable: { findMany: async () => [] },
      orderToCashAuditFact: { findMany: async () => [] },
      salesOrderNfeLink: {
        findMany: async () => [
          {
            nfeExternalId: 7305,
            salesOrderId: "order-1",
            orderCode: "PD 02596",
          },
        ],
      },
      salesOrder: {
        findMany: async () => [
          {
            id: "order-1",
            orderCode: "PD 02596",
            companyIssuer: "KOPPETEL",
            Customer: {
              tradeName: "Cliente Oficial",
              companyName: "Cliente Oficial LTDA",
            },
          },
        ],
      },
    };

    const payload = await loadOutputDocumentsList(
      {
        page: 1,
        pageSize: 50,
        customerId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      { prisma: prisma as never, now: new Date(2026, 6, 15) }
    );

    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0]!.customerName, "Cliente Oficial");
    assert.ok(whereCalls.length >= 1);
    const whereJson = JSON.stringify(whereCalls[0]);
    assert.match(whereJson, /7305|8572|idNfe|externalId/);
  });
});
