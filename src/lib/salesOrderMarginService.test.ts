import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, before, after } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  setSalesOrderMarginProductCostResolver,
} from "./salesOrderMarginProductCostResolver.js";
import {
  attachMarginToSalesOrderDetail,
  attachMarginsToSalesOrders,
  buildSalesOrderMarginContext,
  calculateSalesOrderMarginsForOrders,
} from "./salesOrderMarginService.server.js";
import { refineSalesOrderMarginSummaryStatus } from "./salesOrderMarginStatus.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

const PRODUCT = {
  id: "prod-1",
  sku: "100.01AA",
  name: "Produto Teste",
  sourceExternalId: null,
};

function createMockPrisma(options?: {
  products?: typeof PRODUCT[];
  salesOrderItems?: Array<{
    id: string;
    salesOrderId: string;
    productId: string;
    externalProductId?: number | null;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: number;
    negotiatedPrice: number;
    totalNetValue: number;
    unitCost?: number;
  }>;
  nomusConfigJson?: Record<string, unknown> | null;
}): PrismaClient {
  const products = options?.products ?? [PRODUCT];
  const salesOrderItems = options?.salesOrderItems ?? [];

  return {
    product: {
      findMany: async (args: { where?: { id?: { in: string[] }; sku?: { in: string[] } } }) => {
        const where = args.where ?? {};
        if (where.id?.in) {
          return products.filter((p) => where.id!.in!.includes(p.id));
        }
        if (where.sku?.in) {
          return products.filter((p) => where.sku!.in!.includes(p.sku));
        }
        return [];
      },
    },
    nomusProductCatalog: { findMany: async () => [] },
    proposalItem: { findMany: async () => [] },
    costCalculationLog: { findMany: async () => [] },
    indirectCost: {
      findFirst: async () =>
        options?.nomusConfigJson
          ? {
              id: "nomus-config-1",
              allocationCriteria: JSON.stringify(options.nomusConfigJson),
            }
          : null,
    },
    taxRule: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
    },
    productPricing: { findMany: async () => [] },
    salesOrderItem: {
      findMany: async (args: { where?: { salesOrderId?: { in: string[] } } }) => {
        const ids = args.where?.salesOrderId?.in ?? [];
        return salesOrderItems.filter((item) => ids.includes(item.salesOrderId));
      },
    },
  } as unknown as PrismaClient;
}

function itemResult(
  partial: Partial<SalesOrderMarginItemResult> & Pick<SalesOrderMarginItemResult, "status">
): SalesOrderMarginItemResult {
  return {
    salesOrderItemId: partial.salesOrderItemId,
    productId: partial.productId ?? "prod-1",
    productSku: partial.productSku ?? "SKU",
    productName: partial.productName ?? "Produto",
    quantity: partial.quantity ?? 1,
    netUnitRevenue: partial.netUnitRevenue ?? 100,
    netRevenue: partial.netRevenue ?? 100,
    unitCost: partial.unitCost ?? 40,
    totalCost: partial.totalCost ?? 40,
    marginValue: partial.marginValue ?? 60,
    marginPercent: partial.marginPercent ?? 60,
    markup: partial.markup ?? 2.5,
    status: partial.status,
    statusLabel: partial.statusLabel ?? "",
    statusSeverity: partial.statusSeverity ?? "success",
    costSource: partial.costSource ?? "OFFICIAL_FINAL_COST",
    costConfidence: partial.costConfidence ?? "HIGH",
    notes: partial.notes ?? [],
  };
}

describe("salesOrderMarginService", () => {
  before(() => {
    setSalesOrderMarginProductCostResolver(async () => ({
      summary: { totalIndustrialCost: 40 },
    }));
  });

  after(() => {
    setSalesOrderMarginProductCostResolver(null);
  });

  it("1. lista de pedidos retorna marginSummary", async () => {
    const prisma = createMockPrisma({
      salesOrderItems: [
        {
          id: "item-1",
          salesOrderId: "order-1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "Produto Teste",
          quantity: 10,
          negotiatedPrice: 100,
          totalNetValue: 1000,
        },
      ],
    });
    const rows = await attachMarginsToSalesOrders(prisma, [
      { id: "order-1", nomusRawResponse: null },
    ]);
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.marginSummary);
    assert.equal(rows[0]?.marginSummary?.netRevenue, 1000);
  });

  it("2. detalhe do pedido retorna margem por item", async () => {
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      nomusRawResponse: null,
      items: [
        {
          id: "item-1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "Produto Teste",
          quantity: 5,
          negotiatedPrice: 200,
          totalNetValue: 1000,
          unitCost: 0,
        },
      ],
    };
    const enriched = await attachMarginToSalesOrderDetail(prisma, order);
    assert.ok(enriched.marginSummary);
    assert.ok(enriched.items[0]?.margin);
    assert.equal(enriched.items[0]?.margin?.netRevenue, 1000);
    assert.equal(enriched.items[0]?.margin?.unitCost, 40);
  });

  it("3. pedido com dois itens calcula margem ponderada", async () => {
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      nomusRawResponse: null,
      items: [
        {
          id: "i1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "A",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
        {
          id: "i2",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "B",
          quantity: 1,
          negotiatedPrice: 300,
          totalNetValue: 300,
          unitCost: 0,
        },
      ],
    };
    const margins = await calculateSalesOrderMarginsForOrders(prisma, [order]);
    const summary = margins.get("order-1")?.marginSummary;
    assert.equal(summary?.netRevenue, 400);
    assert.equal(summary?.totalCost, 80);
    assert.equal(summary?.marginValue, 320);
    assert.equal(summary?.marginPercent, 80);
  });

  it("4. pedido com item sem custo retorna status parcial", async () => {
    setSalesOrderMarginProductCostResolver(async (productId) => {
      if (productId === "prod-1") return { summary: { totalIndustrialCost: 40 } };
      return { error: "BOM_CYCLE" };
    });
    const prisma = createMockPrisma({
      products: [
        PRODUCT,
        { id: "prod-2", sku: "200.02BB", name: "Produto B", sourceExternalId: null },
      ],
    });
    const order = {
      id: "order-1",
      nomusRawResponse: null,
      items: [
        {
          id: "i1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "A",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
        {
          id: "i2",
          productId: "prod-2",
          skuSnapshot: "200.02BB",
          productNameSnapshot: "B",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
      ],
    };
    const margins = await calculateSalesOrderMarginsForOrders(prisma, [order]);
    const summary = margins.get("order-1")?.marginSummary;
    assert.equal(summary?.status, "PARTIAL");
    assert.equal(summary?.hasMissingCost, true);
    assert.equal(summary?.validItemsCount, 1);
    setSalesOrderMarginProductCostResolver(async () => ({
      summary: { totalIndustrialCost: 40 },
    }));
  });

  it("5. pedido com item sem produto retorna alerta", async () => {
    const prisma = createMockPrisma({ products: [] });
    const order = {
      id: "order-1",
      nomusRawResponse: null,
      items: [
        {
          id: "i1",
          productId: "missing",
          skuSnapshot: "ZZZ",
          productNameSnapshot: "X",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
      ],
    };
    const margins = await calculateSalesOrderMarginsForOrders(prisma, [order]);
    const summary = margins.get("order-1")?.marginSummary;
    assert.equal(summary?.status, "SEM_PRODUTO_VINCULADO");
    assert.equal(summary?.hasMissingProduct, true);
  });

  it("6. item cancelado não distorce margem consolidada", async () => {
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      nomusRawResponse: {
        itensPedido: [
          { item: 1, status: 6, quantidade: 1, idProduto: 1 },
          { item: 2, status: 1, quantidade: 1, idProduto: 2, codigoProduto: "100.01AA" },
        ],
      },
      items: [
        {
          id: "i1",
          productId: "prod-1",
          externalProductId: 1,
          skuSnapshot: "100.01AA",
          productNameSnapshot: "Cancelado",
          quantity: 1,
          negotiatedPrice: 50,
          totalNetValue: 50,
          unitCost: 0,
        },
        {
          id: "i2",
          productId: "prod-1",
          externalProductId: 2,
          skuSnapshot: "100.01AA",
          productNameSnapshot: "Ativo",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
      ],
    };
    const margins = await calculateSalesOrderMarginsForOrders(prisma, [order]);
    const result = margins.get("order-1");
    assert.equal(result?.itemResults.find((i) => i.salesOrderItemId === "i1")?.status, "ITEM_CANCELADO");
    assert.equal(result?.marginSummary.validItemsCount, 1);
    assert.equal(result?.marginSummary.netRevenue, 100);
  });

  it("7. margem negativa aparece no status", async () => {
    setSalesOrderMarginProductCostResolver(async () => ({
      summary: { totalIndustrialCost: 200 },
    }));
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      nomusRawResponse: null,
      items: [
        {
          id: "i1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "A",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
      ],
    };
    const margins = await calculateSalesOrderMarginsForOrders(prisma, [order]);
    assert.equal(margins.get("order-1")?.marginSummary.status, "MARGEM_NEGATIVA");
    setSalesOrderMarginProductCostResolver(async () => ({
      summary: { totalIndustrialCost: 40 },
    }));
  });

  it("8. deductFromGross com TaxRule deduz imposto da margem gerencial", async () => {
    const taxRuleId = "tax-rule-avg";
    const prisma = createMockPrisma({
      nomusConfigJson: {
        defaultTaxRuleId: taxRuleId,
        taxMode: "deductFromGross",
        useFrozenUnitCostFirst: true,
        allowLiveCostFallback: true,
        showPartialCoverageWarning: true,
      },
      salesOrderItems: [
        {
          id: "item-394",
          salesOrderId: "order-394",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "Produto Teste",
          quantity: 1,
          negotiatedPrice: 394,
          totalNetValue: 394,
          unitCost: 193.49,
        },
      ],
    }) as PrismaClient & {
      taxRule: { findUnique: (args: unknown) => Promise<unknown> };
    };
    prisma.taxRule.findUnique = async () => ({
      id: taxRuleId,
      name: "Imposto médio sobre venda",
      status: "ACTIVE",
      operation: "SALE",
      TaxComponent: [{ id: "c1", name: "Total", percentage: 27.25, isRecoverable: false, baseType: "GROSS" }],
    });

    const margins = await calculateSalesOrderMarginsForOrders(prisma, [
      { id: "order-394", nomusRawResponse: null },
    ]);
    const summary = margins.get("order-394")?.marginSummary;
    assert.ok(summary);
    assert.ok(Math.abs(summary.netRevenue - 286.63) < 0.02);
    assert.ok(Math.abs(summary.marginValue - 93.14) < 0.02);
    assert.ok(summary.marginPercent != null && Math.abs(summary.marginPercent - 32.5) < 0.05);
  });

  it("9. taxMode none na config Nomus não deduz imposto", async () => {
    const prisma = createMockPrisma({
      nomusConfigJson: {
        defaultTaxRuleId: null,
        taxMode: "none",
        useFrozenUnitCostFirst: true,
        allowLiveCostFallback: true,
        showPartialCoverageWarning: true,
      },
      salesOrderItems: [
        {
          id: "item-1",
          salesOrderId: "order-1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "Produto Teste",
          quantity: 1,
          negotiatedPrice: 394,
          totalNetValue: 394,
          unitCost: 193.49,
        },
      ],
    });
    const margins = await calculateSalesOrderMarginsForOrders(prisma, [
      { id: "order-1", nomusRawResponse: null },
    ]);
    const summary = margins.get("order-1")?.marginSummary;
    assert.equal(summary?.netRevenue, 394);
    assert.ok(Math.abs((summary?.marginValue ?? 0) - 200.51) < 0.02);
  });

  it("10. não há N+1 evidente no cálculo de custo", async () => {
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      nomusRawResponse: null,
      items: [
        {
          id: "i1",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "A",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
        {
          id: "i2",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "B",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
        {
          id: "i3",
          productId: "prod-1",
          skuSnapshot: "100.01AA",
          productNameSnapshot: "C",
          quantity: 1,
          negotiatedPrice: 100,
          totalNetValue: 100,
          unitCost: 0,
        },
      ],
    };
    const context = await buildSalesOrderMarginContext(prisma, [order], {
      itemsByOrderId: new Map([[order.id, order.items]]),
    });
    assert.equal(context.costAnalysisCalls, 1);
  });

  it("refineSalesOrderMarginSummaryStatus prioriza alertas sem itens válidos", () => {
    const status = refineSalesOrderMarginSummaryStatus(
      {
        itemsCount: 1,
        validItemsCount: 0,
        ignoredItemsCount: 1,
        netRevenue: 0,
        totalCost: 0,
        marginValue: 0,
        marginPercent: null,
        markup: null,
        hasMissingCost: false,
        hasMissingProduct: true,
        hasNegativeMargin: false,
        hasInvalidRevenue: false,
        status: "PARTIAL",
      },
      [itemResult({ status: "SEM_PRODUTO_VINCULADO", netRevenue: 0, marginValue: null })]
    );
    assert.equal(status, "SEM_PRODUTO_VINCULADO");
  });
});

describe("salesOrderMarginService — rotas e segurança", () => {
  it("8. query/paginação da lista permanece no endpoint", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /attachMarginsToSalesOrders\(prisma, rows\)/);
    assert.match(server, /pageSize = Math\.min\(parsePositiveIntQuery\(req\.query\.pageSize, 20\), 100\)/);
    assert.match(server, /buildSalesOrderListWhere/);
  });

  it("9. busca inteligente permanece no endpoint", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.match(server, /const q = String\(req\.query\.q/);
    assert.match(server, /q: q \|\| undefined/);
  });

  it("11. relatório cliente não renderiza custo/margem", () => {
    const doc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderClientDocument.tsx"),
      "utf8"
    );
    assert.doesNotMatch(doc, /marginSummary/);
    assert.doesNotMatch(doc, /unitCost/);
    assert.doesNotMatch(doc, /marginValue/);
    assert.doesNotMatch(doc, /marginPerc/);
  });

  it("12. serviço é server-only e não importa React", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderMarginService.server.ts"),
      "utf8"
    );
    assert.match(src, /@prisma\/client/);
    assert.match(src, /salesOrderMarginResolver\.server\.js/);
    assert.doesNotMatch(src, /from "react"/);
    const resolver = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderMarginResolver.ts"),
      "utf8"
    );
    assert.doesNotMatch(resolver, /@prisma\/client/);
  });

  it("endpoints internos usam salesOrderMarginService", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const mgmt = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderIntelligenceRoutes.ts"),
      "utf8"
    );
    const finance = readFileSync(
      join(process.cwd(), "src", "lib", "financeSalesOrdersDashboard.ts"),
      "utf8"
    );
    assert.match(server, /attachMarginToSalesOrderDetail/);
    assert.match(mgmt, /calculateOfficialSalesOrderMarginsForOrders|calculateSalesOrderMarginsForOrders/);
    assert.match(finance, /marginPortfolio/);
  });
});
