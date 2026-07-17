/**
 * DS-03.7 — testes do resolver canônico de Documento de Saída.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyOutputDocumentNfeLink,
  classifyOutputDocumentReceivablesLink,
  classifyOutputDocumentSalesOrderLink,
  resolveOutputDocument,
  type OutputDocumentResolveEvidence,
  type OutputDocumentStageHeader,
  type OutputDocumentStageItem,
} from "./nomusOutputDocumentResolver.js";
import {
  loadOutputDocumentByExternalId,
  loadOutputDocumentsForSalesOrder,
} from "./nomusOutputDocumentResolver.server.js";

const ORDER_A = "00000000-0000-4000-8000-0000000000a1";
const ORDER_B = "00000000-0000-4000-8000-0000000000b2";
const DOC_ID = "doc-uuid-8451";
const ITEM_ID = "item-uuid-1";

function baseDocument(
  overrides: Partial<OutputDocumentStageHeader> = {}
): OutputDocumentStageHeader {
  return {
    id: DOC_ID,
    externalId: 8451,
    idNfe: 7208,
    tipoDocumentoEstoque: "DocumentoSaida",
    dataDocumento: new Date("2026-07-10T12:00:00.000Z"),
    documentNumber: "DS-8451",
    statusRaw: "Aberto",
    isCancelled: false,
    totalValue: "1234.56",
    personExternalId: 501,
    personName: "Cliente Exemplo",
    companyExternalId: 2,
    companyName: "Empresa SA",
    movementDate: null,
    paymentTermsRaw: "28 DDL",
    ...overrides,
  };
}

function baseItem(
  overrides: Partial<OutputDocumentStageItem> = {}
): OutputDocumentStageItem {
  return {
    id: ITEM_ID,
    externalItemId: 1,
    externalProductId: 100,
    quantity: "1",
    unitValue: "100",
    estimatedTotalValue: "100",
    ...overrides,
  };
}

function emptyEvidence(
  overrides: Partial<OutputDocumentResolveEvidence> = {}
): OutputDocumentResolveEvidence {
  return {
    document: baseDocument(),
    items: [baseItem()],
    nfe: null,
    salesOrderNfeLinks: [],
    salesOrders: [],
    salesOrderItems: [],
    o2cFacts: [],
    receivables: [],
    ...overrides,
  };
}

describe("classifyOutputDocument*Link", () => {
  it("NF persistida pelo idNfe do stage", () => {
    const link = classifyOutputDocumentNfeLink({
      persistedIdNfe: 7208,
      o2cNfeIds: [],
      nfeFoundLocally: true,
    });
    assert.equal(link.classification, "persistido");
  });

  it("NF conflitante quando O2C discorda do stage", () => {
    const link = classifyOutputDocumentNfeLink({
      persistedIdNfe: 7208,
      o2cNfeIds: [9999],
      nfeFoundLocally: true,
    });
    assert.equal(link.classification, "conflitante");
  });

  it("pedidos via SalesOrderNfeLink são derivados; discordância com O2C é conflito", () => {
    const ok = classifyOutputDocumentSalesOrderLink({
      persistedIdNfe: 7208,
      orderIdsViaNfeLink: [ORDER_A],
      orderIdsViaO2c: [ORDER_A],
    });
    assert.equal(ok.classification, "derivado");

    const conflict = classifyOutputDocumentSalesOrderLink({
      persistedIdNfe: 7208,
      orderIdsViaNfeLink: [ORDER_A],
      orderIdsViaO2c: [ORDER_B],
    });
    assert.equal(conflict.classification, "conflitante");
  });

  it("CR sem NF fica não resolvido", () => {
    const link = classifyOutputDocumentReceivablesLink({
      resolvedNfeExternalId: null,
      receivableCount: 0,
    });
    assert.equal(link.classification, "nao_resolvido");
  });
});

describe("resolveOutputDocument", () => {
  it("lista documento do stage sem O2C, sem NF e sem pedido", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        document: baseDocument({ idNfe: null }),
      })
    );
    assert.equal(result.listedFromStage, true);
    assert.equal(result.dependsOnO2cForListing, false);
    assert.equal(result.document.externalId, 8451);
    assert.equal(result.items.length, 1);
    assert.equal(result.nfe.link.classification, "nao_resolvido");
    assert.equal(result.orders.link.classification, "nao_resolvido");
    assert.equal(result.o2c.present, false);
    assert.equal(result.receivables.link.classification, "nao_resolvido");
  });

  it("resolve NF local e CR pela NF sem depender de O2C", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        nfe: {
          externalId: 7208,
          id: "nfe-uuid",
          numero: "7208",
          chave: "KEY7208",
          status: 1,
          foundLocally: true,
        },
        receivables: [
          {
            id: "ar-1",
            externalId: 55,
            sourceInvoiceId: 7208,
            amountReceivable: "100.00",
            balanceReceivable: "100.00",
            status: true,
          },
        ],
      })
    );
    assert.equal(result.nfe.link.classification, "persistido");
    assert.equal(result.nfe.externalId, 7208);
    assert.equal(result.nfe.record?.foundLocally, true);
    assert.equal(result.o2c.present, false);
    assert.equal(result.receivables.link.classification, "derivado");
    assert.equal(result.receivables.receivables.length, 1);
  });

  it("resolve pedido via SalesOrderNfeLink e preserva itens do stage", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        nfe: {
          externalId: 7208,
          id: "nfe-uuid",
          numero: "7208",
          chave: null,
          status: 1,
          foundLocally: true,
        },
        salesOrderNfeLinks: [
          {
            linkId: "link-1",
            salesOrderId: ORDER_A,
            orderCode: "PD02590",
            nfeExternalId: 7208,
          },
        ],
        salesOrders: [{ id: ORDER_A, orderCode: "PD02590", status: "OPEN" }],
        salesOrderItems: [
          {
            id: "soi-1",
            salesOrderId: ORDER_A,
            externalProductId: 100,
            nomusItemExternalId: 9,
          },
        ],
      })
    );
    assert.equal(result.orders.link.classification, "derivado");
    assert.equal(result.orders.orders.length, 1);
    assert.equal(result.orders.orders[0]!.salesOrderId, ORDER_A);
    assert.deepEqual(result.orders.orders[0]!.sources, ["sales_order_nfe_link"]);
    assert.equal(result.orders.orders[0]!.items.length, 1);
    assert.equal(result.items[0]!.id, ITEM_ID);
    assert.equal(result.o2c.present, false);
  });

  it("aceita múltiplos pedidos na mesma NF (sem conflito entre links)", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        salesOrderNfeLinks: [
          {
            linkId: "l-a",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            nfeExternalId: 7208,
          },
          {
            linkId: "l-b",
            salesOrderId: ORDER_B,
            orderCode: "PD-B",
            nfeExternalId: 7208,
          },
        ],
        salesOrders: [
          { id: ORDER_A, orderCode: "PD-A", status: "OPEN" },
          { id: ORDER_B, orderCode: "PD-B", status: "OPEN" },
        ],
      })
    );
    assert.equal(result.orders.link.classification, "derivado");
    assert.equal(result.orders.orders.length, 2);
  });

  it("deduplica vínculos SalesOrderNfeLink duplicados", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        salesOrderNfeLinks: [
          {
            linkId: "l1",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            nfeExternalId: 7208,
          },
          {
            linkId: "l1-dup",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            nfeExternalId: 7208,
          },
        ],
        salesOrders: [{ id: ORDER_A, orderCode: "PD-A", status: "OPEN" }],
      })
    );
    assert.equal(result.orders.orders.length, 1);
    assert.equal(result.orders.orders[0]!.linkIds.length, 1);
  });

  it("overlay O2C para alocação sem exigir O2C para listar", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        salesOrderNfeLinks: [
          {
            linkId: "l1",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            nfeExternalId: 7208,
          },
        ],
        salesOrders: [{ id: ORDER_A, orderCode: "PD-A", status: "OPEN" }],
        o2cFacts: [
          {
            runId: "run-1",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            salesOrderItemId: "soi-1",
            nfeExternalId: 7208,
            stockDocumentExternalId: 8451,
            stockDocumentIdNfe: 7208,
            stockDocumentItemId: ITEM_ID,
            allocatedValueByDocumentPrice: "50.00",
            quantityUsedForOrder: "1",
            receivableIds: [55],
          },
        ],
      })
    );
    assert.equal(result.listedFromStage, true);
    assert.equal(result.dependsOnO2cForListing, false);
    assert.equal(result.o2c.present, true);
    assert.equal(result.o2c.usedForAllocationOnly, true);
    assert.equal(result.o2c.allocationLines.length, 1);
    assert.equal(result.o2c.allocationLines[0]!.allocatedValueByDocumentPrice, "50.00");
    assert.ok(result.orders.orders[0]!.sources.includes("order_to_cash_fact"));
    assert.ok(result.orders.orders[0]!.sources.includes("sales_order_nfe_link"));
  });

  it("marca conflito quando O2C aponta pedido diferente do link oficial", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        salesOrderNfeLinks: [
          {
            linkId: "l1",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            nfeExternalId: 7208,
          },
        ],
        salesOrders: [
          { id: ORDER_A, orderCode: "PD-A", status: "OPEN" },
          { id: ORDER_B, orderCode: "PD-B", status: "OPEN" },
        ],
        o2cFacts: [
          {
            runId: "run-1",
            salesOrderId: ORDER_B,
            orderCode: "PD-B",
            salesOrderItemId: null,
            nfeExternalId: 7208,
            stockDocumentExternalId: 8451,
            stockDocumentIdNfe: 7208,
            stockDocumentItemId: null,
            allocatedValueByDocumentPrice: null,
            quantityUsedForOrder: null,
            receivableIds: [],
          },
        ],
      })
    );
    assert.equal(result.orders.link.classification, "conflitante");
  });

  it("marca conflito de NF quando O2C discorda do idNfe persistido", () => {
    const result = resolveOutputDocument(
      emptyEvidence({
        o2cFacts: [
          {
            runId: "run-1",
            salesOrderId: ORDER_A,
            orderCode: "PD-A",
            salesOrderItemId: null,
            nfeExternalId: 1111,
            stockDocumentExternalId: 8451,
            stockDocumentIdNfe: 1111,
            stockDocumentItemId: null,
            allocatedValueByDocumentPrice: null,
            quantityUsedForOrder: null,
            receivableIds: [],
          },
        ],
      })
    );
    assert.equal(result.nfe.link.classification, "conflitante");
  });
});

describe("loadOutputDocument* (memory prisma)", () => {
  type DocRow = {
    id: string;
    externalId: number;
    idNfe: number | null;
    tipoDocumentoEstoque: string | null;
    dataDocumento: Date | null;
    documentNumber: string | null;
    statusRaw: string | null;
    isCancelled: boolean;
    totalValue: string | null;
    personExternalId: number | null;
    personName: string | null;
    companyExternalId: number | null;
    companyName: string | null;
    movementDate: Date | null;
    paymentTermsRaw: string | null;
  };

  function createMemoryPrisma(seed: {
    documents: DocRow[];
    items: Array<{
      id: string;
      stockDocumentId: string;
      externalItemId: number | null;
      externalProductId: number | null;
      quantity: string;
      unitValue: string;
      estimatedTotalValue: string;
      createdAt: Date;
    }>;
    nfes: Array<{
      id: string;
      externalId: number;
      numero: string | null;
      chave: string | null;
      status: number | null;
    }>;
    links: Array<{
      id: string;
      salesOrderId: string;
      orderCode: string | null;
      nfeExternalId: number;
    }>;
    orders: Array<{ id: string; orderCode: string; status: string }>;
    orderItems: Array<{
      id: string;
      salesOrderId: string;
      externalProductId: number | null;
      nomusItemExternalId: number | null;
    }>;
    o2c: Array<{
      runId: string;
      salesOrderId: string | null;
      orderCode: string | null;
      salesOrderItemId: string | null;
      nfeExternalId: number | null;
      stockDocumentExternalId: number | null;
      stockDocumentIdNfe: number | null;
      stockDocumentItemId: string | null;
      allocatedValueByDocumentPrice: string | null;
      quantityUsedForOrder: string | null;
      receivableIdsJson: unknown;
    }>;
    receivables: Array<{
      id: string;
      externalId: number;
      sourceInvoiceId: number | null;
      amountReceivable: string | null;
      balanceReceivable: string | null;
      status: boolean | null;
    }>;
  }) {
    return {
      nomusStockDocument: {
        findFirst: async (args: { where: Record<string, unknown> }) => {
          const externalId = args.where.externalId as number;
          const tipo = args.where.tipoDocumentoEstoque as string | undefined;
          return (
            seed.documents.find(
              (d) =>
                d.externalId === externalId &&
                (tipo == null || d.tipoDocumentoEstoque === tipo)
            ) ?? null
          );
        },
        findMany: async (args: { where: Record<string, unknown> }) => {
          let rows = [...seed.documents];
          if (typeof args.where.idNfe === "number") {
            rows = rows.filter((d) => d.idNfe === args.where.idNfe);
          }
          if (
            args.where.idNfe &&
            typeof args.where.idNfe === "object" &&
            "in" in (args.where.idNfe as object)
          ) {
            const ids = (args.where.idNfe as { in: number[] }).in;
            rows = rows.filter((d) => d.idNfe != null && ids.includes(d.idNfe));
          }
          if (
            args.where.externalId &&
            typeof args.where.externalId === "object" &&
            "in" in (args.where.externalId as object)
          ) {
            const ids = (args.where.externalId as { in: number[] }).in;
            rows = rows.filter((d) => ids.includes(d.externalId));
          }
          if (typeof args.where.tipoDocumentoEstoque === "string") {
            rows = rows.filter(
              (d) => d.tipoDocumentoEstoque === args.where.tipoDocumentoEstoque
            );
          }
          return rows.sort((a, b) => a.externalId - b.externalId);
        },
      },
      nomusStockDocumentItem: {
        findMany: async (args: { where: { stockDocumentId: string } }) =>
          seed.items
            .filter((i) => i.stockDocumentId === args.where.stockDocumentId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      },
      nomusNfe: {
        findUnique: async (args: { where: { externalId: number } }) =>
          seed.nfes.find((n) => n.externalId === args.where.externalId) ?? null,
      },
      salesOrderNfeLink: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          let rows = [...seed.links];
          if (typeof args.where.nfeExternalId === "number") {
            rows = rows.filter((l) => l.nfeExternalId === args.where.nfeExternalId);
          }
          if (typeof args.where.salesOrderId === "string") {
            rows = rows.filter((l) => l.salesOrderId === args.where.salesOrderId);
          }
          return rows;
        },
      },
      salesOrder: {
        findMany: async (args: { where: { id: { in: string[] } } }) =>
          seed.orders.filter((o) => args.where.id.in.includes(o.id)),
      },
      salesOrderItem: {
        findMany: async (args: { where: { salesOrderId: { in: string[] } } }) =>
          seed.orderItems.filter((i) =>
            args.where.salesOrderId.in.includes(i.salesOrderId)
          ),
      },
      orderToCashAuditFact: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          let rows = [...seed.o2c];
          if (typeof args.where.stockDocumentExternalId === "number") {
            rows = rows.filter(
              (f) => f.stockDocumentExternalId === args.where.stockDocumentExternalId
            );
          }
          if (typeof args.where.salesOrderId === "string") {
            rows = rows.filter((f) => f.salesOrderId === args.where.salesOrderId);
          }
          if (typeof args.where.runId === "string") {
            rows = rows.filter((f) => f.runId === args.where.runId);
          }
          return rows;
        },
      },
      nomusAccountsReceivable: {
        findMany: async (args: { where: { sourceInvoiceId: number } }) =>
          seed.receivables.filter(
            (r) => r.sourceInvoiceId === args.where.sourceInvoiceId
          ),
      },
    };
  }

  it("loadByExternalId lista stage sem O2C", async () => {
    const prisma = createMemoryPrisma({
      documents: [
        {
          ...baseDocument({ idNfe: null }),
          totalValue: "10.00",
        },
      ],
      items: [
        {
          id: ITEM_ID,
          stockDocumentId: DOC_ID,
          externalItemId: 1,
          externalProductId: 100,
          quantity: "1",
          unitValue: "10",
          estimatedTotalValue: "10",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      nfes: [],
      links: [],
      orders: [],
      orderItems: [],
      o2c: [],
      receivables: [],
    });

    const result = await loadOutputDocumentByExternalId(prisma as never, 8451);
    assert.ok(result);
    assert.equal(result!.listedFromStage, true);
    assert.equal(result!.o2c.present, false);
    assert.equal(result!.items.length, 1);
    assert.equal(result!.nfe.link.classification, "nao_resolvido");
  });

  it("loadForSalesOrder descobre documento pelo link NF sem O2C", async () => {
    const prisma = createMemoryPrisma({
      documents: [baseDocument()],
      items: [
        {
          id: ITEM_ID,
          stockDocumentId: DOC_ID,
          externalItemId: 1,
          externalProductId: 100,
          quantity: "1",
          unitValue: "100",
          estimatedTotalValue: "100",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      nfes: [
        {
          id: "nfe-1",
          externalId: 7208,
          numero: "7208",
          chave: "K",
          status: 1,
        },
      ],
      links: [
        {
          id: "link-1",
          salesOrderId: ORDER_A,
          orderCode: "PD02590",
          nfeExternalId: 7208,
        },
      ],
      orders: [{ id: ORDER_A, orderCode: "PD02590", status: "OPEN" }],
      orderItems: [],
      o2c: [],
      receivables: [],
    });

    const results = await loadOutputDocumentsForSalesOrder(prisma as never, ORDER_A);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.document.externalId, 8451);
    assert.equal(results[0]!.o2c.present, false);
    assert.equal(results[0]!.orders.link.classification, "derivado");
  });
});
