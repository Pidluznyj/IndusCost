import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE } from "@/src/lib/fixtures/nomusProductionOrderOp05800.js";
import {
  buildProductionOrderDetailAuditSummary,
  classifyProductionOrderLinkState,
  isProductionOrderDetailId,
  sanitizeProductionOrderRawJson,
  serializeProductionOrderDetail,
  type ProductionOrderDetailDbRow,
} from "@/src/lib/productionOrdersDetail.js";
import { getProductionOrderDetailById } from "@/src/lib/productionOrdersDetail.server.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const OP_ID = "00000000-0000-4000-8000-000000000101";
const LINK_ID = "00000000-0000-4000-8000-000000000201";
const SO_ID = "00000000-0000-4000-8000-000000000301";
const ITEM_ID = "00000000-0000-4000-8000-000000000401";

function detailRow(overrides: Partial<ProductionOrderDetailDbRow> = {}): ProductionOrderDetailDbRow {
  const now = new Date("2026-07-16T12:00:00.000Z");
  return {
    id: OP_ID,
    externalId: 30347,
    name: "OP 05800 - 003",
    status: "Encerrada",
    tipo: "Injeção",
    priority: "Normal",
    externalProductId: 391,
    productCode: "311.32AA",
    productDescription: "Produto fixture OP 05800",
    productAdditionalInfo: "Info adicional",
    productConfigId: 12,
    productConfigCode: "CFG-311",
    quantity: new Prisma.Decimal("15400"),
    unit: "PC",
    stockSector: "PRODUCAO",
    externalCompanyId: 1,
    companyName: "KOPPETEL",
    openedAt: new Date("2026-03-10T11:15:00.000Z"),
    plannedAt: new Date("2026-03-12T21:00:00.000Z"),
    closedAt: new Date("2026-03-12T20:40:22.000Z"),
    nomusUpdatedAt: new Date("2026-03-12T20:40:22.000Z"),
    firstSeenAt: now,
    lastSeenAt: now,
    lastChangedAt: now,
    syncedAt: now,
    createdAt: now,
    updatedAt: now,
    rawJson: NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE,
    salesLinks: [],
    ...overrides,
  };
}

function resolvedLink(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    isCurrent: true,
    externalSalesOrderId: 2530,
    externalSalesOrderItemId: 11324,
    itemNumber: "00010",
    customerName: "Esmaltec S/A",
    linkedQuantity: new Prisma.Decimal("15000"),
    salesOrderId: SO_ID,
    salesOrderItemId: ITEM_ID,
    firstSeenAt: new Date("2026-03-10T11:15:00.000Z"),
    lastSeenAt: new Date("2026-07-16T12:00:00.000Z"),
    removedAt: null,
    rawJson: { id: 11324, idPedido: 2530, item: "00010" },
    SalesOrder: { orderCode: "PD 02534" },
    SalesOrderItem: {
      id: ITEM_ID,
      skuSnapshot: "311.32AA",
      productNameSnapshot: "Produto fixture",
      quantity: new Prisma.Decimal("15000"),
      unit: "PC",
      nomusItemExternalId: 11324,
      nomusItemSequence: "00010",
    },
    ...overrides,
  };
}

describe("isProductionOrderDetailId", () => {
  it("aceita uuid v4 válido", () => {
    assert.equal(isProductionOrderDetailId(OP_ID), true);
  });

  it("rejeita id inválido", () => {
    assert.equal(isProductionOrderDetailId("30347"), false);
    assert.equal(isProductionOrderDetailId("OP 05800 - 003"), false);
  });
});

describe("classifyProductionOrderLinkState", () => {
  it("vínculo atual resolvido", () => {
    assert.equal(
      classifyProductionOrderLinkState({
        isCurrent: true,
        salesOrderId: SO_ID,
        salesOrderItemId: ITEM_ID,
      }),
      "current_resolved"
    );
  });

  it("vínculo pendente", () => {
    assert.equal(
      classifyProductionOrderLinkState({
        isCurrent: true,
        salesOrderId: null,
        salesOrderItemId: null,
      }),
      "current_pending"
    );
  });

  it("vínculo removido", () => {
    assert.equal(
      classifyProductionOrderLinkState({
        isCurrent: false,
        salesOrderId: SO_ID,
        salesOrderItemId: ITEM_ID,
      }),
      "removed"
    );
  });

  it("vínculo reativado aparece como atual", () => {
    assert.equal(
      classifyProductionOrderLinkState({
        isCurrent: true,
        salesOrderId: SO_ID,
        salesOrderItemId: ITEM_ID,
      }),
      "current_resolved"
    );
  });
});

describe("buildProductionOrderDetailAuditSummary", () => {
  it("OP sem pedido", () => {
    assert.deepEqual(buildProductionOrderDetailAuditSummary([]), {
      currentLinkCount: 0,
      removedLinkCount: 0,
      resolvedLinkCount: 0,
      pendingLinkCount: 0,
    });
  });

  it("OP com um pedido resolvido", () => {
    const summary = buildProductionOrderDetailAuditSummary([
      { isCurrent: true, salesOrderId: SO_ID, salesOrderItemId: ITEM_ID },
    ]);
    assert.deepEqual(summary, {
      currentLinkCount: 1,
      removedLinkCount: 0,
      resolvedLinkCount: 1,
      pendingLinkCount: 0,
    });
  });

  it("vários pedidos, removido e pendente", () => {
    const summary = buildProductionOrderDetailAuditSummary([
      { isCurrent: true, salesOrderId: SO_ID, salesOrderItemId: ITEM_ID },
      { isCurrent: true, salesOrderId: null, salesOrderItemId: null },
      { isCurrent: false, salesOrderId: SO_ID, salesOrderItemId: ITEM_ID },
      { isCurrent: true, salesOrderId: SO_ID, salesOrderItemId: "item-2" },
    ]);
    assert.equal(summary.currentLinkCount, 3);
    assert.equal(summary.removedLinkCount, 1);
    assert.equal(summary.resolvedLinkCount, 3);
    assert.equal(summary.pendingLinkCount, 1);
  });
});

describe("sanitizeProductionOrderRawJson", () => {
  it("redige chaves sensíveis e preserva demais campos", () => {
    const sanitized = sanitizeProductionOrderRawJson({
      nome: "OP 05800 - 003",
      authorization: "Bearer secret-token",
      nested: { NOMUS_TOKEN: "abc" },
    }) as Record<string, unknown>;
    assert.equal(sanitized.nome, "OP 05800 - 003");
    assert.equal(sanitized.authorization, "[redigido]");
    assert.deepEqual(sanitized.nested, { NOMUS_TOKEN: "[redigido]" });
  });

  it("preserva fixture real sem segredos", () => {
    const sanitized = sanitizeProductionOrderRawJson(NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE);
    assert.equal(
      (sanitized as Record<string, unknown>).nome,
      NOMUS_PRODUCTION_ORDER_OP_05800_FIXTURE.nome
    );
  });
});

describe("serializeProductionOrderDetail", () => {
  it("OP sem vínculo — campos nulos preservados", () => {
    const detail = serializeProductionOrderDetail(
      detailRow({
        name: null,
        quantity: null,
        openedAt: null,
        salesLinks: [],
      })
    );
    assert.equal(detail.identification.name, null);
    assert.equal(detail.product.quantity, null);
    assert.equal(detail.dates.openedAt, null);
    assert.equal(detail.salesLinks.length, 0);
    assert.deepEqual(detail.auditSummary, {
      currentLinkCount: 0,
      removedLinkCount: 0,
      resolvedLinkCount: 0,
      pendingLinkCount: 0,
    });
    assert.ok(detail.rawJson);
  });

  it("OP com um vínculo resolvido e decimal brasileiro normalizado", () => {
    const detail = serializeProductionOrderDetail(
      detailRow({ salesLinks: [resolvedLink()] })
    );
    assert.equal(detail.identification.externalId, 30347);
    assert.equal(detail.product.quantity, "15400");
    assert.equal(detail.salesLinks.length, 1);
    const link = detail.salesLinks[0];
    assert.equal(link?.linkState, "current_resolved");
    assert.equal(link?.orderCode, "PD 02534");
    assert.equal(link?.linkedQuantity, "15000");
    assert.equal(link?.localItem?.nomusItemExternalId, 11324);
    assert.ok(link?.rawJson);
  });

  it("OP com vários vínculos incluindo removido e pendente", () => {
    const detail = serializeProductionOrderDetail(
      detailRow({
        salesLinks: [
          resolvedLink(),
          resolvedLink({
            id: "link-2",
            isCurrent: false,
            removedAt: new Date("2026-06-01T00:00:00.000Z"),
            externalSalesOrderId: 8888,
            SalesOrder: { orderCode: "PD 08888" },
            SalesOrderItem: null,
            salesOrderId: null,
            salesOrderItemId: null,
          }),
          resolvedLink({
            id: "link-3",
            isCurrent: true,
            salesOrderId: null,
            salesOrderItemId: null,
            SalesOrder: null,
            SalesOrderItem: null,
            externalSalesOrderId: 7777,
          }),
        ],
      })
    );
    assert.equal(detail.salesLinks.length, 3);
    assert.equal(detail.salesLinks[0]?.linkState, "current_resolved");
    assert.equal(detail.salesLinks[1]?.linkState, "removed");
    assert.equal(detail.salesLinks[2]?.linkState, "current_pending");
    assert.equal(detail.auditSummary.currentLinkCount, 2);
    assert.equal(detail.auditSummary.removedLinkCount, 1);
    assert.equal(detail.auditSummary.pendingLinkCount, 1);
  });

  it("várias OPs no mesmo item — vínculo expõe externalSalesOrderItemId oficial", () => {
    const detail = serializeProductionOrderDetail(
      detailRow({ salesLinks: [resolvedLink({ externalSalesOrderItemId: 11324 })] })
    );
    assert.equal(detail.salesLinks[0]?.externalSalesOrderItemId, 11324);
  });
});

describe("getProductionOrderDetailById", () => {
  it("retorna null para OP inexistente", async () => {
    const db = {
      nomusProductionOrder: {
        findUnique: async () => null,
      },
    };
    const result = await getProductionOrderDetailById(
      db as unknown as import("@prisma/client").PrismaClient,
      OP_ID
    );
    assert.equal(result, null);
  });

  it("consulta única com includes — sem N+1", async () => {
    let findUniqueCalls = 0;
    const db = {
      nomusProductionOrder: {
        findUnique: async (args: { where: { id: string }; include: unknown }) => {
          findUniqueCalls += 1;
          assert.equal(args.where.id, OP_ID);
          assert.ok(args.include);
          return detailRow({ salesLinks: [resolvedLink()] });
        },
      },
    };
    const detail = await getProductionOrderDetailById(
      db as unknown as import("@prisma/client").PrismaClient,
      OP_ID
    );
    assert.equal(findUniqueCalls, 1);
    assert.equal(detail?.identification.id, OP_ID);
  });
});

describe("productionOrdersRoutes detail", () => {
  it("registra GET /api/operations/production-orders/:id", () => {
    const routes = read("src/lib/productionOrdersRoutes.ts");
    assert.match(routes, /GET \/api\/operations\/production-orders\/:id/);
    assert.match(routes, /getProductionOrderDetailById/);
    assert.match(routes, /NOT_FOUND/);
    assert.match(routes, /INVALID_ID/);
    assert.doesNotMatch(routes, /\.update\(/);
    assert.doesNotMatch(routes, /\.create\(/);
    assert.doesNotMatch(routes, /\.delete\(/);
    assert.doesNotMatch(routes, /fetchNomusJson/);
  });

  it("permissão e endpoint catalogados", () => {
    assert.match(read("src/lib/operationsAccess.ts"), /production-orders\/:id/);
    assert.match(
      read("src/lib/security/permissionContract/resources.ts"),
      /production-orders\/:id/
    );
  });
});
