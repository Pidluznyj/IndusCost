/**
 * Regressão DS-05.6 — adapter canônico Documentos de Saída → Auditoria 360º / PD.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { ResolvedOutputDocument } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";
import {
  buildReceivableExternalIdByNfeMap,
  dedupeResolvedOutputDocumentsByExternalId,
  pickPrimaryReceivableExternalId,
  projectResolvedOutputDocumentForOrder,
  resolveAuditDocumentNfeNumber,
  resolveAuditDocumentReceivableExternalId,
  stockDocumentEntryFromResolved,
} from "./orderFullAuditOutputDocumentsAdapter.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function resolvedDoc(
  partial: {
    externalId: number;
    id?: string;
    idNfe?: number | null;
    documentNumber?: string | null;
    totalValue?: string | null;
    items?: ResolvedOutputDocument["items"];
    o2cLines?: ResolvedOutputDocument["o2c"]["allocationLines"];
    receivables?: ResolvedOutputDocument["receivables"]["receivables"];
    orders?: ResolvedOutputDocument["orders"]["orders"];
  }
): ResolvedOutputDocument {
  const externalId = partial.externalId;
  const id = partial.id ?? `doc-${externalId}`;
  const items = partial.items ?? [
    {
      id: `item-${externalId}-1`,
      externalItemId: 1,
      externalProductId: 100,
      quantity: "10",
      unitValue: "5",
      estimatedTotalValue: "50",
    },
  ];
  return {
    document: {
      id,
      externalId,
      idNfe: partial.idNfe ?? 7208,
      tipoDocumentoEstoque: "DocumentoSaida",
      dataDocumento: new Date("2026-06-01T00:00:00.000Z"),
      documentNumber: partial.documentNumber ?? `DS-${externalId}`,
      statusRaw: "Emitido",
      isCancelled: false,
      totalValue: partial.totalValue ?? "100",
      personExternalId: 1,
      personName: "Cliente",
      companyExternalId: 1,
      companyName: "KOPPETEL",
      movementDate: null,
      paymentTermsRaw: null,
    },
    items,
    listedFromStage: true,
    dependsOnO2cForListing: false,
    nfe: {
      externalId: partial.idNfe ?? 7208,
      link: { classification: "persistido", sources: ["stock_document_idNfe"], reasons: [] },
      record: {
        externalId: partial.idNfe ?? 7208,
        id: "nfe-1",
        numero: "98765",
        chave: null,
        status: 100,
        foundLocally: true,
      },
    },
    orders: {
      link: {
        classification: "derivado",
        sources: ["sales_order_nfe_link"],
        reasons: [],
      },
      orders: partial.orders ?? [
        {
          salesOrderId: "order-a",
          orderCode: "PD-100",
          status: "Aberto",
          linkIds: [],
          sources: ["sales_order_nfe_link"],
          items: [],
        },
      ],
    },
    o2c: {
      present: (partial.o2cLines?.length ?? 0) > 0,
      runIds: partial.o2cLines?.length ? ["run-1"] : [],
      allocationLines: partial.o2cLines ?? [],
      usedForAllocationOnly: true,
    },
    receivables: {
      link: {
        classification: "derivado",
        sources: ["order_to_cash_fact"],
        reasons: [],
      },
      receivables: partial.receivables ?? [],
    },
  };
}

describe("orderFullAuditOutputDocumentsAdapter", () => {
  it("PD com um documento: cabeçalho e projeção sem inflar total", () => {
    const doc = resolvedDoc({
      externalId: 8451,
      o2cLines: [
        {
          stockDocumentItemId: "item-8451-1",
          salesOrderId: "order-a",
          salesOrderItemId: "soi-1",
          allocatedValueByDocumentPrice: "40",
          quantityUsedForOrder: "8",
          runId: "run-1",
        },
        {
          stockDocumentItemId: "item-8451-1",
          salesOrderId: "order-a",
          salesOrderItemId: "soi-1",
          allocatedValueByDocumentPrice: "10",
          quantityUsedForOrder: "2",
          runId: "run-1",
        },
      ],
    });
    const entry = stockDocumentEntryFromResolved(doc);
    assert.equal(entry.stockDocumentExternalId, 8451);
    assert.equal(entry.documentNumber, "DS-8451");
    assert.equal(entry.idNfe, 7208);

    const { projection, forThisOrder } = projectResolvedOutputDocumentForOrder(
      doc,
      "order-a"
    );
    assert.equal(projection.document.totalValue, 100);
    assert.equal(forThisOrder.allocatedValue, 50);
    assert.equal(projection.items.length, 1);
  });

  it("múltiplos documentos e múltiplos pedidos: dedup + alocação por foco", () => {
    const docs = dedupeResolvedOutputDocumentsByExternalId([
      resolvedDoc({
        externalId: 1,
        idNfe: 100,
        o2cLines: [
          {
            stockDocumentItemId: "item-1-1",
            salesOrderId: "order-a",
            salesOrderItemId: "soi-a",
            allocatedValueByDocumentPrice: "30",
            quantityUsedForOrder: "3",
            runId: "run-1",
          },
        ],
      }),
      resolvedDoc({
        externalId: 1,
        idNfe: 100,
        documentNumber: "DUP",
      }),
      resolvedDoc({
        externalId: 2,
        idNfe: 200,
        totalValue: "80",
        items: [
          {
            id: "item-2-1",
            externalItemId: 1,
            externalProductId: 200,
            quantity: "4",
            unitValue: "20",
            estimatedTotalValue: "80",
          },
        ],
        o2cLines: [
          {
            stockDocumentItemId: "item-2-1",
            salesOrderId: "order-b",
            salesOrderItemId: "soi-b",
            allocatedValueByDocumentPrice: "80",
            quantityUsedForOrder: "4",
            runId: "run-1",
          },
          {
            stockDocumentItemId: "item-2-1",
            salesOrderId: "order-a",
            salesOrderItemId: "soi-a2",
            allocatedValueByDocumentPrice: "0",
            quantityUsedForOrder: "0",
            runId: "run-1",
          },
        ],
        orders: [
          {
            salesOrderId: "order-a",
            orderCode: "PD-100",
            status: "Aberto",
            linkIds: [],
            sources: ["order_to_cash_fact"],
            items: [],
          },
          {
            salesOrderId: "order-b",
            orderCode: "PD-200",
            status: "Aberto",
            linkIds: [],
            sources: ["order_to_cash_fact"],
            items: [],
          },
        ],
      }),
    ]);
    assert.equal(docs.length, 2);

    const focused = projectResolvedOutputDocumentForOrder(docs[1]!, "order-b");
    assert.equal(focused.forThisOrder.allocatedValue, 80);
    assert.ok(focused.projection.linkedOrders.length >= 1);
  });

  it("preenche CR a partir dos receivables do resolver (não nulo)", () => {
    const docs = [
      resolvedDoc({
        externalId: 10,
        idNfe: 5001,
        receivables: [
          {
            id: "ar-1",
            externalId: 9001,
            sourceInvoiceId: 5001,
            amountReceivable: "100",
            balanceReceivable: "40",
            status: true,
          },
          {
            id: "ar-2",
            externalId: 9000,
            sourceInvoiceId: 5001,
            amountReceivable: "50",
            balanceReceivable: "0",
            status: true,
          },
        ],
      }),
    ];
    const map = buildReceivableExternalIdByNfeMap(docs);
    assert.equal(map.get(5001), 9001);
    assert.equal(resolveAuditDocumentReceivableExternalId(5001, map), 9001);
    assert.equal(resolveAuditDocumentReceivableExternalId(null, map), null);
    assert.equal(
      pickPrimaryReceivableExternalId(docs[0]!.receivables.receivables),
      9001
    );
  });

  it("documento sem O2C permanece listável e sem alocação", () => {
    const doc = resolvedDoc({
      externalId: 77,
      idNfe: 707,
      o2cLines: [],
      receivables: [],
    });
    assert.equal(doc.dependsOnO2cForListing, false);
    assert.equal(doc.o2c.present, false);
    const entry = stockDocumentEntryFromResolved(doc);
    assert.equal(entry.linkOrigin, "SALES_ORDER_NFE_LINK");
    const { projection, forThisOrder } = projectResolvedOutputDocumentForOrder(
      doc,
      "order-a"
    );
    assert.equal(projection.document.totalValue, 100);
    assert.equal(forThisOrder.allocatedValue, 0);
  });

  it("número da NF-e vem do mapa oficial, não do primeiro fact", () => {
    const nfeMap = new Map([[7208, { numero: "98765" }]]);
    assert.equal(resolveAuditDocumentNfeNumber(7208, nfeMap, "fallback"), "98765");
    assert.equal(resolveAuditDocumentNfeNumber(999, nfeMap, "fallback"), "fallback");
  });
});

describe("orderFullAuditService wiring (DS-05.6)", () => {
  it("reutiliza o loader canônico e preenche CR/raw com autorização", () => {
    const service = read("src/lib/finance/orderFullAuditService.ts");
    assert.match(service, /loadOutputDocumentsForSalesOrder/);
    assert.match(service, /buildReceivableExternalIdByNfeMap/);
    assert.match(service, /resolveAuditDocumentReceivableExternalId/);
    assert.match(service, /allocationLinesFromResolvedO2c/);
    assert.match(service, /stockDocumentRawByExternalId/);
    assert.doesNotMatch(
      service,
      /receivableExternalId:\s*null,\s*\n\s*lineType:/
    );

    const routes = read("src/lib/financePortfolioReconciliationRoutes.ts");
    assert.match(routes, /decideOutputDocumentRawAccess/);
    assert.match(routes, /parseIncludeRawFlag/);
    assert.match(routes, /getCurrentAppUser/);

    const detail = read(
      "src/lib/sales-orders/salesOrderDetailService.server.ts"
    );
    assert.match(detail, /documentNumber\?\.trim\(\)/);
  });
});
