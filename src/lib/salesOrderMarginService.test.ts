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
  /** Custo de produção vigente por productId na tabela versionada (mock). */
  productionUnitCostByProductId?: Record<string, number>;
}): PrismaClient {
  const products = options?.products ?? [PRODUCT];
  const salesOrderItems = options?.salesOrderItems ?? [];
  const productionUnitCostByProductId = options?.productionUnitCostByProductId ?? {
    "prod-1": 40,
  };

  const publishedVersions = [
    {
      id: "mock-pct-ver",
      code: "2026-01",
      name: "Mock custo",
      effectiveDate: new Date("2026-01-01"),
      status: "PUBLISHED" as const,
      revision: 1,
      publishedAt: new Date("2026-01-02"),
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
      items: Object.entries(productionUnitCostByProductId).map(([productId, unitProductionCost]) => {
        const product = products.find((p) => p.id === productId);
        return {
          id: `mock-item-${productId}`,
          costTableVersionId: "mock-pct-ver",
          productId,
          productCodeSnapshot: product?.sku ?? productId,
          productNameSnapshot: product?.name ?? productId,
          unitProductionCost,
          materialCost: unitProductionCost * 0.5,
          processCost: 0,
          laborCost: unitProductionCost * 0.2,
          machineCost: unitProductionCost * 0.15,
          overheadCost: unitProductionCost * 0.15,
          otherCost: 0,
          currency: "BRL",
          calculationHash: "mock",
          calculationSnapshot: { costAnalysisPartial: false },
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    },
  ];

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
      findUnique: async ({ where }: { where: { id: string } }) =>
        products.find((p) => p.id === where.id) ?? null,
    },
    nomusProductCatalog: { findMany: async () => [] },
    proposalItem: { findMany: async () => [] },
    costCalculationLog: { findMany: async () => [] },
    productionCostTableVersion: {
      findMany: async () => publishedVersions,
    },
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
      { id: "order-1", issueDate: new Date("2026-06-15"), nomusRawResponse: null },
    ]);
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.marginSummary);
    assert.equal(rows[0]?.marginSummary?.netRevenue, 1000);
  });

  it("2. detalhe do pedido retorna margem por item", async () => {
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      issueDate: new Date("2026-06-15"),
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
      issueDate: new Date("2026-06-15"),
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
    const prisma = createMockPrisma({
      products: [
        PRODUCT,
        { id: "prod-2", sku: "200.02BB", name: "Produto B", sourceExternalId: null },
      ],
    });
    const order = {
      id: "order-1",
      issueDate: new Date("2026-06-15"),
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
  });

  it("5. pedido com item sem produto retorna alerta", async () => {
    const prisma = createMockPrisma({ products: [] });
    const order = {
      id: "order-1",
      issueDate: new Date("2026-06-15"),
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
      issueDate: new Date("2026-06-15"),
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
    const prisma = createMockPrisma({
      productionUnitCostByProductId: { "prod-1": 200 },
    });
    const order = {
      id: "order-1",
      issueDate: new Date("2026-06-15"),
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
      { id: "order-394", issueDate: new Date("2026-06-15"), nomusRawResponse: null },
    ]);
    const summary = margins.get("order-394")?.marginSummary;
    assert.ok(summary);
    assert.ok(Math.abs(summary.netRevenue - 286.63) < 0.02);
    assert.ok(Math.abs(summary.marginValue - 246.63) < 0.02);
    assert.ok(summary.marginPercent != null && Math.abs(summary.marginPercent - 86.05) < 0.5);
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
      { id: "order-1", issueDate: new Date("2026-06-15"), nomusRawResponse: null },
    ]);
    const summary = margins.get("order-1")?.marginSummary;
    assert.equal(summary?.netRevenue, 394);
    assert.ok(Math.abs((summary?.marginValue ?? 0) - 354) < 0.02);
  });

  it("10. margem oficial usa lote de custo versionado (sem motor vivo)", async () => {
    const prisma = createMockPrisma();
    const order = {
      id: "order-1",
      issueDate: new Date("2026-06-15"),
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
    assert.equal(context.costAnalysisCalls, 0);
    assert.equal(context.byOrderId.get("order-1")?.itemResults.length, 3);
    assert.equal(context.byOrderId.get("order-1")?.itemResults[0]?.costSource, "VERSIONED_PRODUCTION_COST");
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
    const listQuery = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderListQuery.server.ts"),
      "utf8"
    );
    assert.doesNotMatch(server, /attachMarginsToSalesOrders\(prisma, rows\)/);
    assert.match(server, /parseSalesOrderListQuery/);
    assert.match(server, /listQuery\.pageSize/);
    assert.match(server, /resolveSalesOrderListWhere/);
    assert.match(
      listQuery,
      /pageSize: Math\.min\(parsePositiveIntQuery\(query\.pageSize, 20\), 100\)/
    );
    const pageMargins = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderListPageMargins.server.ts"),
      "utf8"
    );
    assert.match(pageMargins, /attachMarginsToSalesOrders/);
  });

  it("9. busca inteligente permanece no endpoint", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const listQuery = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderListQuery.server.ts"),
      "utf8"
    );
    assert.match(server, /parseSalesOrderListQuery/);
    assert.match(listQuery, /q: String\(query\.q \?\? ""\)\.trim\(\)/);
    assert.match(listQuery, /q: query\.q \|\| undefined/);
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
    const metrics = readFileSync(
      join(process.cwd(), "src", "lib", "salesOrderManagementMetrics.server.ts"),
      "utf8"
    );
    const finance = readFileSync(
      join(process.cwd(), "src", "lib", "financeSalesOrdersDashboard.ts"),
      "utf8"
    );
    assert.match(server, /attachMarginToSalesOrderDetail/);
    assert.match(
      readFileSync(
        join(process.cwd(), "src", "lib", "salesOrderListReportExportRoutes.ts"),
        "utf8"
      ),
      /SALES_ORDER_LIST_PAGE_MARGINS_PATH/
    );
    assert.match(
      metrics,
      /calculateOfficialSalesOrderMarginsForOrders|calculateSalesOrderMarginsForOrders|attachMarginsToSalesOrders|marginEconomics/
    );
    assert.match(finance, /marginPortfolio/);
  });
});
