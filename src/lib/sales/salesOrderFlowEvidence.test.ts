import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assembleSalesOrderFlowEvidenceBatch,
  type AssembleSalesOrderFlowEvidenceBatchInput,
} from "./salesOrderFlowEvidence.js";
import {
  loadSalesOrderFlowEvidenceBatch,
  type SalesOrderFlowEvidencePrisma,
} from "./salesOrderFlowEvidence.server.js";
import { SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS } from "./salesOrderFlowPerformance.js";

const ORDER_A = "11111111-1111-1111-1111-111111111111";
const ORDER_B = "22222222-2222-2222-2222-222222222222";
const ITEM_A1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1";
const ITEM_A2 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2";
const ITEM_B1 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1";
const PRODUCT_1 = "p1111111-1111-1111-1111-111111111111";
const PRODUCT_2 = "p2222222-2222-2222-2222-222222222222";
const CUSTOMER = "c1111111-1111-1111-1111-111111111111";
const DOC_1 = "d1111111-1111-1111-1111-111111111111";
const DOC_2 = "d2222222-2222-2222-2222-222222222222";
const OP_1 = "o1111111-1111-1111-1111-111111111111";
const OP_2 = "o2222222-2222-2222-2222-222222222222";
const NFE_ID = "n1111111-1111-1111-1111-111111111111";

function baseOrder(
  id: string,
  items: AssembleSalesOrderFlowEvidenceBatchInput["orders"][0]["items"]
): AssembleSalesOrderFlowEvidenceBatchInput["orders"][0] {
  return {
    id,
    orderCode: id === ORDER_A ? "PD-A" : "PD-B",
    status: "SENT_TO_NOMUS",
    externalSalesOrderId: id === ORDER_A ? 100 : 200,
    issueDate: "2026-06-01T00:00:00.000Z",
    expectedDeliveryDate: "2026-07-15T00:00:00.000Z",
    totalNetValue: 1000,
    customerId: CUSTOMER,
    externalSellerId: 7,
    nomusSellerName: "Vendedor X",
    companyIssuer: "Lazarios",
    externalCompanyId: 1,
    notes: "nota manual",
    responsible: "resp",
    Customer: {
      id: CUSTOMER,
      companyName: "Cliente SA",
      tradeName: "Cliente",
      taxId: "00.000.000/0001-00",
    },
    items,
  };
}

describe("salesOrderFlowEvidence (assembler)", () => {
  it("pedido simples: header, cliente, vendedor, empresa, datas e FIN-03", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "Produto 1",
            quantity: 10,
            nomusQuantityFulfilled: 0,
            nomusItemStatusRaw: "2",
            nomusItemStatusNormalized: "RELEASED",
            nomusIsCanceled: false,
            nomusIsStale: false,
            nomusIsCut: false,
            nomusItemExternalId: 501,
          },
        ]),
      ],
      products: [
        {
          id: PRODUCT_1,
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          hasProductRouting: true,
          hasProductBom: true,
        },
      ],
      loadedAt: "2026-07-17T12:00:00.000Z",
    });

    const pack = map.get(ORDER_A);
    assert.ok(pack);
    assert.equal(pack.order.orderCode, "PD-A");
    assert.equal(pack.order.customer?.tradeName, "Cliente");
    assert.equal(pack.order.seller.sellerName, "Vendedor X");
    assert.equal(pack.order.company.companyIssuer, "Lazarios");
    assert.equal(pack.order.expectedDeliveryDate, "2026-07-15T00:00:00.000Z");
    assert.equal(pack.order.manualMetadata.notes, "nota manual");
    assert.equal(pack.items.length, 1);
    assert.equal(pack.items[0]!.fulfillment.classification, "NOT_FULFILLED");
    assert.equal(pack.items[0]!.productCostingMode, "OWN_PROCESS");
    assert.equal(pack.meta.source, "LOCAL_STAGE");
    assert.equal(pack.meta.queryMode, "BATCH");
  });

  it("vários itens no mesmo pedido", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 5,
            nomusItemStatusNormalized: "PENDING",
            nomusItemStatusRaw: "1",
          },
          {
            id: ITEM_A2,
            salesOrderId: ORDER_A,
            productId: PRODUCT_2,
            skuSnapshot: "SKU-2",
            productNameSnapshot: "P2",
            quantity: 3,
            nomusItemStatusNormalized: "FULFILLED",
            nomusItemStatusRaw: "4",
            nomusQuantityFulfilled: 3,
          },
        ]),
      ],
    });
    const pack = map.get(ORDER_A)!;
    assert.equal(pack.items.length, 2);
    assert.equal(pack.items[0]!.fulfillment.classification, "NOT_FULFILLED");
    assert.equal(pack.items[1]!.fulfillment.classification, "FULLY_FULFILLED");
  });

  it("vários documentos e alocações O2C", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 10,
            nomusItemStatusNormalized: "PARTIAL",
            nomusItemStatusRaw: "3",
            nomusQuantityFulfilled: 4,
          },
        ]),
      ],
      allocations: [
        {
          auditKey: "a1",
          runId: "run-new",
          lineType: "ALLOCATION",
          salesOrderId: ORDER_A,
          salesOrderItemId: ITEM_A1,
          stockDocumentExternalId: 9001,
          stockDocumentItemId: "si1",
          quantityUsedForOrder: 4,
          orderedQuantity: 10,
          createdAt: "2026-07-10T00:00:00.000Z",
        },
        {
          auditKey: "a2",
          runId: "run-new",
          lineType: "ALLOCATION",
          salesOrderId: ORDER_A,
          salesOrderItemId: ITEM_A1,
          stockDocumentExternalId: 9002,
          stockDocumentItemId: "si2",
          quantityUsedForOrder: 2,
          orderedQuantity: 10,
          createdAt: "2026-07-10T00:00:00.000Z",
        },
        {
          auditKey: "stale",
          runId: "run-old",
          lineType: "ALLOCATION",
          salesOrderId: ORDER_A,
          stockDocumentExternalId: 9999,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      stockDocuments: [
        {
          id: DOC_1,
          externalId: 9001,
          idNfe: 7001,
          tipoDocumentoEstoque: "SAIDA",
          totalValue: 100,
        },
        {
          id: DOC_2,
          externalId: 9002,
          idNfe: null,
          tipoDocumentoEstoque: "SAIDA",
          totalValue: 50,
        },
      ],
      stockDocumentItems: [
        {
          id: "si1",
          stockDocumentId: DOC_1,
          externalProductId: 1,
          quantity: 4,
        },
        {
          id: "si2",
          stockDocumentId: DOC_2,
          externalProductId: 1,
          quantity: 2,
        },
      ],
      nomusNfes: [{ id: NFE_ID, externalId: 7001, numero: "100", status: 4 }],
    });

    const pack = map.get(ORDER_A)!;
    assert.equal(pack.allocations.length, 2);
    assert.ok(pack.allocations.every((a) => a.runId === "run-new"));
    assert.equal(pack.stockDocuments.length, 2);
    assert.equal(pack.stockDocumentItems.length, 2);
    assert.equal(pack.nfes.length, 1);
    assert.equal(pack.validNfes.length, 1);
  });

  it("várias OPs com linkedQuantity e producedQuantity null", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 10,
            nomusItemExternalId: 501,
            nomusItemStatusNormalized: "RELEASED",
            nomusItemStatusRaw: "2",
          },
        ]),
      ],
      productionLinks: [
        {
          id: "l1",
          productionOrderId: OP_1,
          productionOrderExternalId: 8001,
          salesOrderId: ORDER_A,
          salesOrderItemId: ITEM_A1,
          externalSalesOrderId: 100,
          externalSalesOrderItemId: 501,
          linkedQuantity: 6,
          isCurrent: true,
        },
        {
          id: "l2",
          productionOrderId: OP_2,
          productionOrderExternalId: 8002,
          salesOrderId: ORDER_A,
          salesOrderItemId: ITEM_A1,
          externalSalesOrderId: 100,
          externalSalesOrderItemId: 501,
          linkedQuantity: 4,
          isCurrent: true,
        },
      ],
      productionOrders: [
        {
          id: OP_1,
          externalId: 8001,
          status: "Liberada",
          quantity: 6,
          productCode: "SKU-1",
        },
        {
          id: OP_2,
          externalId: 8002,
          status: "Em produção",
          quantity: 4,
          productCode: "SKU-1",
        },
      ],
    });

    const pack = map.get(ORDER_A)!;
    assert.equal(pack.productionLinks.length, 2);
    assert.equal(pack.productionOrders.length, 2);
    assert.ok(pack.productionOrders.every((o) => o.producedQuantity === null));
    assert.equal(pack.productionOrders[0]!.plannedQuantity, 6);
  });

  it("NF duplicada por fontes diferentes é deduplicada preservando origins", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 1,
            nomusItemStatusNormalized: "FULFILLED",
            nomusItemStatusRaw: "4",
          },
        ]),
      ],
      nfeLinks: [
        {
          id: "link1",
          salesOrderId: ORDER_A,
          nfeExternalId: 7001,
          nfeStatus: 4,
          nomusNfeId: NFE_ID,
        },
      ],
      allocations: [
        {
          auditKey: "a1",
          runId: "run1",
          lineType: "ALLOCATION",
          salesOrderId: ORDER_A,
          nfeExternalId: 7001,
          stockDocumentExternalId: 9001,
          createdAt: "2026-07-10T00:00:00.000Z",
        },
      ],
      stockDocuments: [
        { id: DOC_1, externalId: 9001, idNfe: 7001, totalValue: 10 },
      ],
      nomusNfes: [
        { id: NFE_ID, externalId: 7001, numero: "123", status: 4 },
      ],
    });

    const pack = map.get(ORDER_A)!;
    assert.equal(pack.nfes.length, 1);
    assert.equal(pack.nfes[0]!.externalId, 7001);
    assert.ok(pack.nfes[0]!.sources.includes("SALES_ORDER_NFE_LINK"));
    assert.ok(pack.nfes[0]!.sources.includes("O2C_AUDIT_FACT"));
    assert.ok(pack.nfes[0]!.sources.includes("STOCK_DOCUMENT_ID_NFE"));
    assert.ok(
      pack.linkConflicts.some((c) => c.code === "DUPLICATE_NFE_EXTERNAL_ID")
    );
  });

  it("vínculos conflitantes: OP item mismatch e NF multi-pedido", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 1,
            nomusItemExternalId: 501,
            nomusItemStatusNormalized: "RELEASED",
            nomusItemStatusRaw: "2",
          },
        ]),
        baseOrder(ORDER_B, [
          {
            id: ITEM_B1,
            salesOrderId: ORDER_B,
            productId: PRODUCT_2,
            skuSnapshot: "SKU-2",
            productNameSnapshot: "P2",
            quantity: 1,
            nomusItemStatusNormalized: "RELEASED",
            nomusItemStatusRaw: "2",
          },
        ]),
      ],
      nfeLinks: [
        {
          id: "la",
          salesOrderId: ORDER_A,
          nfeExternalId: 7001,
          nfeStatus: 4,
        },
        {
          id: "lb",
          salesOrderId: ORDER_B,
          nfeExternalId: 7001,
          nfeStatus: 7,
        },
      ],
      nomusNfes: [{ id: NFE_ID, externalId: 7001, status: 4 }],
      productionLinks: [
        {
          id: "bad-link",
          productionOrderId: OP_1,
          productionOrderExternalId: 8001,
          salesOrderId: ORDER_A,
          salesOrderItemId: "deadbeef-dead-dead-dead-deadbeefdead",
          externalSalesOrderId: 100,
          externalSalesOrderItemId: 999,
          linkedQuantity: 1,
          isCurrent: true,
        },
      ],
      productionOrders: [
        { id: OP_1, externalId: 8001, quantity: 1, status: "Aberta" },
      ],
    });

    const packA = map.get(ORDER_A)!;
    assert.ok(
      packA.linkConflicts.some((c) => c.code === "PRODUCTION_LINK_ITEM_MISMATCH")
    );
    assert.ok(
      packA.linkConflicts.some(
        (c) => c.code === "NFE_LINKED_TO_MULTIPLE_ORDERS_IN_BATCH"
      )
    );
    assert.ok(
      packA.linkConflicts.some(
        (c) => c.code === "NFE_STATUS_MISMATCH_ACROSS_SOURCES"
      )
    );

    const packB = map.get(ORDER_B)!;
    assert.ok(
      packB.linkConflicts.some(
        (c) => c.code === "NFE_LINKED_TO_MULTIPLE_ORDERS_IN_BATCH"
      )
    );
  });

  it("NF cancelada (status 7) vai para canceledNfes", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 1,
            nomusItemStatusNormalized: "FULFILLED",
            nomusItemStatusRaw: "4",
          },
        ]),
      ],
      nfeLinks: [
        {
          id: "link",
          salesOrderId: ORDER_A,
          nfeExternalId: 7007,
          nfeStatus: 7,
        },
      ],
      nomusNfes: [{ id: NFE_ID, externalId: 7007, status: 7 }],
    });
    const pack = map.get(ORDER_A)!;
    assert.equal(pack.canceledNfes.length, 1);
    assert.equal(pack.validNfes.length, 0);
    assert.equal(pack.nfes[0]!.isCanceled, true);
  });

  it("DS com idNfe + ref do pedido vincula NF autorizada mesmo sem SalesOrderNfeLink", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "P1",
            quantity: 1,
            nomusItemStatusNormalized: "FULFILLED",
            nomusItemStatusRaw: "4",
            nomusQuantityFulfilled: 1,
            nomusItemExternalId: 501,
          },
        ]),
      ],
      stockDocuments: [
        {
          id: DOC_1,
          externalId: 4220,
          idNfe: 7142,
          totalValue: 2850,
          externalSalesOrderId: 100,
          orderCodeNormalized: "PD02586",
        },
      ],
      nomusNfes: [
        {
          id: NFE_ID,
          externalId: 7142,
          numero: "7142",
          serie: "2",
          status: 4,
        },
      ],
    });
    const pack = map.get(ORDER_A)!;
    assert.equal(pack.validNfes.length, 1);
    assert.equal(pack.validNfes[0]!.externalId, 7142);
    assert.ok(pack.validNfes[0]!.linkedSalesOrderIds.includes(ORDER_A));
    assert.ok(pack.validNfes[0]!.sources.includes("STOCK_DOCUMENT_ID_NFE"));
  });

  it("status NomusNfe (autorizada) prevalece sobre link stale cancelado", () => {
    const map = assembleSalesOrderFlowEvidenceBatch({
      orders: [
        baseOrder(ORDER_A, [
          {
            id: ITEM_A1,
            salesOrderId: ORDER_A,
            productId: PRODUCT_1,
            skuSnapshot: "SKU",
            productNameSnapshot: "P",
            quantity: 1,
            nomusItemStatusNormalized: "FULFILLED",
            nomusItemStatusRaw: "4",
          },
        ]),
      ],
      nfeLinks: [
        {
          id: "stale",
          salesOrderId: ORDER_A,
          nfeExternalId: 7142,
          nfeStatus: 7,
        },
      ],
      nomusNfes: [{ id: NFE_ID, externalId: 7142, status: 4 }],
    });
    const pack = map.get(ORDER_A)!;
    assert.equal(pack.nfes[0]!.statusRaw, 4);
    assert.equal(pack.nfes[0]!.isCanceled, false);
    assert.equal(pack.nfes[0]!.isValidForBilling, true);
    assert.equal(pack.validNfes.length, 1);
  });
});

describe("salesOrderFlowEvidence.server (batch loader)", () => {
  function createMemoryPrisma(
    seed: {
      orders: Array<Record<string, unknown>>;
      products?: Array<Record<string, unknown>>;
      nfeLinks?: Array<Record<string, unknown>>;
      nomusNfes?: Array<Record<string, unknown>>;
      productionLinks?: Array<Record<string, unknown>>;
      productionOrders?: Array<Record<string, unknown>>;
      allocations?: Array<Record<string, unknown>>;
      stockDocuments?: Array<Record<string, unknown>>;
      stockDocumentItems?: Array<Record<string, unknown>>;
    },
    trackCalls?: string[]
  ): SalesOrderFlowEvidencePrisma {
    const track = (name: string) => {
      trackCalls?.push(name);
    };
    const inFilter = (where: Record<string, unknown>, field: string) => {
      const clause = where[field];
      if (clause && typeof clause === "object" && "in" in (clause as object)) {
        return (clause as { in: unknown[] }).in;
      }
      return null;
    };

    const matchOr = (
      rows: Array<Record<string, unknown>>,
      where: Record<string, unknown>
    ) => {
      const or = where.OR as Array<Record<string, unknown>> | undefined;
      if (!or) {
        const ids = inFilter(where, "id");
        if (ids) return rows.filter((r) => ids.includes(r.id));
        const salesOrderIds = inFilter(where, "salesOrderId");
        if (salesOrderIds) {
          return rows.filter((r) => salesOrderIds.includes(r.salesOrderId));
        }
        const externalIds = inFilter(where, "externalId");
        if (externalIds) {
          return rows.filter((r) => externalIds.includes(r.externalId));
        }
        return rows;
      }
      const matched = new Map<string, Record<string, unknown>>();
      for (const clause of or) {
        for (const row of matchOr(rows, clause)) {
          matched.set(String(row.id ?? row.externalId), row);
        }
      }
      return [...matched.values()];
    };

    return {
      salesOrder: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          track("salesOrder.findMany");
          return seed.orders.filter((o) => args.where.id.in.includes(String(o.id)));
        },
      },
      product: {
        findMany: async (args: { where: { id: { in: string[] } } }) => {
          track("product.findMany");
          return (seed.products ?? []).filter((p) =>
            args.where.id.in.includes(String(p.id))
          );
        },
      },
      salesOrderNfeLink: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("salesOrderNfeLink.findMany");
          const ids = inFilter(args.where, "salesOrderId") as string[] | null;
          return (seed.nfeLinks ?? []).filter(
            (l) => !ids || ids.includes(String(l.salesOrderId))
          );
        },
      },
      nomusNfe: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("nomusNfe.findMany");
          const ids = inFilter(args.where, "externalId") as number[] | null;
          return (seed.nomusNfes ?? []).filter(
            (n) => !ids || ids.includes(Number(n.externalId))
          );
        },
      },
      nomusProductionOrderSalesLink: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("nomusProductionOrderSalesLink.findMany");
          let rows = [...(seed.productionLinks ?? [])];
          const ids = inFilter(args.where, "salesOrderId") as string[] | null;
          if (ids) rows = rows.filter((r) => ids.includes(String(r.salesOrderId)));
          if (args.where.isCurrent === true) {
            rows = rows.filter((r) => r.isCurrent === true);
          }
          return rows;
        },
      },
      nomusProductionOrder: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("nomusProductionOrder.findMany");
          return matchOr(seed.productionOrders ?? [], args.where);
        },
      },
      orderToCashAuditFact: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("orderToCashAuditFact.findMany");
          const ids = inFilter(args.where, "salesOrderId") as string[] | null;
          return (seed.allocations ?? []).filter(
            (a) => !ids || ids.includes(String(a.salesOrderId))
          );
        },
      },
      nomusStockDocument: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("nomusStockDocument.findMany");
          return matchOr(seed.stockDocuments ?? [], args.where);
        },
      },
      nomusStockDocumentItem: {
        findMany: async (args: { where: Record<string, unknown> }) => {
          track("nomusStockDocumentItem.findMany");
          const ids = inFilter(args.where, "stockDocumentId") as string[] | null;
          return (seed.stockDocumentItems ?? []).filter(
            (i) => !ids || ids.includes(String(i.stockDocumentId))
          );
        },
      },
    } as unknown as SalesOrderFlowEvidencePrisma;
  }

  it("carrega lote sem N+1 semântico (um pack por orderId)", async () => {
    const prisma = createMemoryPrisma({
      orders: [
        {
          id: ORDER_A,
          orderCode: "PD-A",
          status: "SENT_TO_NOMUS",
          customerId: CUSTOMER,
          issueDate: new Date("2026-06-01"),
          expectedDeliveryDate: new Date("2026-07-15"),
          totalNetValue: 100,
          totalGrossValue: 100,
          Customer: {
            id: CUSTOMER,
            companyName: "Cliente SA",
            tradeName: "Cliente",
            taxId: "1",
          },
          items: [
            {
              id: ITEM_A1,
              salesOrderId: ORDER_A,
              productId: PRODUCT_1,
              skuSnapshot: "SKU-1",
              productNameSnapshot: "P1",
              quantity: 2,
              nomusItemStatusNormalized: "RELEASED",
              nomusItemStatusRaw: "2",
              nomusIsCanceled: false,
              nomusIsStale: false,
              nomusIsCut: false,
              nomusItemExternalId: 501,
            },
          ],
        },
        {
          id: ORDER_B,
          orderCode: "PD-B",
          status: "SENT_TO_NOMUS",
          customerId: CUSTOMER,
          issueDate: new Date("2026-06-02"),
          expectedDeliveryDate: null,
          totalNetValue: 50,
          totalGrossValue: 50,
          Customer: {
            id: CUSTOMER,
            companyName: "Cliente SA",
            tradeName: "Cliente",
            taxId: "1",
          },
          items: [
            {
              id: ITEM_B1,
              salesOrderId: ORDER_B,
              productId: PRODUCT_2,
              skuSnapshot: "SKU-2",
              productNameSnapshot: "P2",
              quantity: 1,
              nomusItemStatusNormalized: "PENDING",
              nomusItemStatusRaw: "1",
              nomusIsCanceled: false,
              nomusIsStale: false,
              nomusIsCut: false,
            },
          ],
        },
      ],
      products: [
        {
          id: PRODUCT_1,
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          _count: { ProductRouting: 1, ProductBOM: 2 },
        },
        {
          id: PRODUCT_2,
          type: "PRODUCT",
          costingMode: "BOM_ONLY",
          _count: { ProductRouting: 0, ProductBOM: 1 },
        },
      ],
      nfeLinks: [
        {
          id: "l1",
          salesOrderId: ORDER_A,
          nfeExternalId: 7001,
          nfeStatus: 4,
          nomusNfeId: NFE_ID,
        },
      ],
      nomusNfes: [
        { id: NFE_ID, externalId: 7001, numero: "55", status: 4 },
      ],
      productionLinks: [
        {
          id: "pl1",
          productionOrderId: OP_1,
          productionOrderExternalId: 8001,
          salesOrderId: ORDER_A,
          salesOrderItemId: ITEM_A1,
          externalSalesOrderId: 100,
          externalSalesOrderItemId: 501,
          linkedQuantity: 2,
          isCurrent: true,
        },
      ],
      productionOrders: [
        {
          id: OP_1,
          externalId: 8001,
          status: "Liberada",
          quantity: 2,
          productCode: "SKU-1",
        },
      ],
      allocations: [],
      stockDocuments: [],
      stockDocumentItems: [],
    });

    const map = await loadSalesOrderFlowEvidenceBatch(prisma, [ORDER_A, ORDER_B]);
    assert.equal(map.size, 2);
    assert.equal(map.get(ORDER_A)!.items[0]!.hasProductRouting, true);
    assert.equal(map.get(ORDER_A)!.productionOrders[0]!.producedQuantity, null);
    assert.equal(map.get(ORDER_A)!.validNfes.length, 1);
    assert.equal(map.get(ORDER_B)!.items[0]!.fulfillment.classification, "NOT_FULFILLED");
  });

  it("orderIds vazio retorna mapa vazio", async () => {
    const prisma = createMemoryPrisma({ orders: [] });
    const map = await loadSalesOrderFlowEvidenceBatch(prisma, []);
    assert.equal(map.size, 0);
  });

  it("OP-75: pipeline em lote respeita orçamento e omite superfícies sem permissão", async () => {
    const minimalSeed = {
      orders: [
        {
          id: ORDER_A,
          orderCode: "PD-A",
          status: "SENT_TO_NOMUS",
          customerId: CUSTOMER,
          issueDate: new Date("2026-06-01"),
          Customer: {
            id: CUSTOMER,
            companyName: "Cliente SA",
            tradeName: "Cliente",
            taxId: "1",
          },
          items: [
            {
              id: ITEM_A1,
              salesOrderId: ORDER_A,
              productId: PRODUCT_1,
              skuSnapshot: "SKU-1",
              productNameSnapshot: "P1",
              quantity: 1,
              nomusItemStatusNormalized: "RELEASED",
              nomusItemStatusRaw: "2",
              nomusIsCanceled: false,
              nomusIsStale: false,
              nomusIsCut: false,
            },
          ],
        },
      ],
      products: [
        {
          id: PRODUCT_1,
          type: "PRODUCT",
          costingMode: "OWN_PROCESS",
          _count: { ProductRouting: 0, ProductBOM: 0 },
        },
      ],
      nfeLinks: [
        {
          id: "link-1",
          salesOrderId: ORDER_A,
          nfeExternalId: 99,
          nfeNumber: "1",
          nfeKey: null,
          nfeStatus: "AUTHORIZED",
          nomusNfeId: NFE_ID,
        },
      ],
      nomusNfes: [
        {
          id: NFE_ID,
          externalId: 99,
          numero: "1",
          serie: "1",
          chave: null,
          status: "AUTHORIZED",
          xmlDhEmi: null,
        },
      ],
      productionLinks: [
        {
          id: "oplink-1",
          productionOrderId: OP_1,
          productionOrderExternalId: 8001,
          salesOrderId: ORDER_A,
          salesOrderItemId: ITEM_A1,
          linkedQuantity: 1,
          isCurrent: true,
        },
      ],
      productionOrders: [
        {
          id: OP_1,
          externalId: 8001,
          status: "Liberada",
          quantity: 1,
          productCode: "SKU-1",
        },
      ],
      allocations: [],
      stockDocuments: [],
      stockDocumentItems: [],
    };

    const fullCalls: string[] = [];
    const fullPrisma = createMemoryPrisma(minimalSeed, fullCalls);
    await loadSalesOrderFlowEvidenceBatch(fullPrisma, [ORDER_A]);
    assert.ok(fullCalls.length <= SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS);
    assert.ok(fullCalls.includes("salesOrder.findMany"));
    assert.ok(fullCalls.includes("salesOrderNfeLink.findMany"));
    assert.ok(fullCalls.includes("nomusProductionOrderSalesLink.findMany"));
    assert.equal(fullCalls.filter((c) => c === "salesOrder.findMany").length, 1);

    const slimCalls: string[] = [];
    const slimPrisma = createMemoryPrisma(minimalSeed, slimCalls);
    await loadSalesOrderFlowEvidenceBatch(slimPrisma, [ORDER_A], {
      includeFiscalEvidence: false,
      includeProductionEvidence: false,
    });
    assert.equal(slimCalls.includes("salesOrderNfeLink.findMany"), false);
    assert.equal(slimCalls.includes("nomusNfe.findMany"), false);
    assert.equal(slimCalls.includes("nomusStockDocument.findMany"), false);
    assert.equal(
      slimCalls.includes("nomusProductionOrderSalesLink.findMany"),
      false
    );
    assert.equal(slimCalls.includes("nomusProductionOrder.findMany"), false);
    assert.ok(slimCalls.includes("orderToCashAuditFact.findMany"));
  });
});
