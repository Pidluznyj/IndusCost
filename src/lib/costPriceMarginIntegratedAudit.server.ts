/**
 * Auditoria integrada MP → produção → preço → margem (server-only).
 * Reutiliza resolvers publicados e motor de margem — não cria segundo motor.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "./financeCivilDate.js";
import { getEffectiveMaterialCost } from "./materialCostTables.server.js";
import { getEffectiveProductProductionCosts } from "./productionCostTables.server.js";
import { resolvePublishedPriceTableVersionForDate } from "./priceTablePublication.server.js";
import {
  buildCoverageMetrics,
  classifySoldItemForIntegratedAudit,
  computeCriticalPendingCount,
  isPublishedMaterialCostOk,
  isPublishedProductionCostOk,
  mergeVersionUsage,
  rankTopSoldPendingItems,
  type CostPriceMarginAuditPayload,
  type CostPriceMarginVersionUsed,
  type TopSoldPendingAccumulator,
} from "./costPriceMarginIntegratedAudit.js";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "./salesOrderMarginService.server.js";
import { registerOfficialServerResolversForAuditScripts } from "./registerServerResolvers.js";

export type CostPriceMarginIntegratedAuditFilters = {
  from: Date;
  to: Date;
  label: string;
  seller?: string;
  customer?: string;
  sku?: string;
  top?: number;
};

const MATERIAL_CHUNK = 80;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

function buildSalesOrderWhere(filters: CostPriceMarginIntegratedAuditFilters): Prisma.SalesOrderWhereInput {
  const where: Prisma.SalesOrderWhereInput = {
    issueDate: { gte: filters.from, lte: filters.to },
    status: { notIn: ["CANCELLED", "DRAFT"] },
  };

  if (filters.seller?.trim()) {
    const seller = filters.seller.trim();
    const sellerNum = Number(seller);
    where.OR = [
      { responsible: { contains: seller, mode: "insensitive" } },
      ...(Number.isFinite(sellerNum) ? [{ externalSellerId: sellerNum }] : []),
    ];
  }

  if (filters.customer?.trim()) {
    const customer = filters.customer.trim();
    if (isUuid(customer)) {
      where.customerId = customer;
    } else {
      where.Customer = { name: { contains: customer, mode: "insensitive" } };
    }
  }

  if (filters.sku?.trim()) {
    where.items = {
      some: {
        Product: { sku: { contains: filters.sku.trim(), mode: "insensitive" } },
      },
    };
  }

  return where;
}

async function auditMaterialCoverage(
  db: PrismaClient,
  referenceDate: Date
): Promise<CostPriceMarginAuditPayload["materials"]> {
  const activeMaterials = await db.material.findMany({
    where: { status: "ACTIVE" },
    select: { id: true },
    orderBy: { code: "asc" },
  });

  let withCoverage = 0;
  for (let i = 0; i < activeMaterials.length; i += MATERIAL_CHUNK) {
    const chunk = activeMaterials.slice(i, i + MATERIAL_CHUNK);
    const results = await Promise.all(
      chunk.map((row) => getEffectiveMaterialCost(db, row.id, referenceDate))
    );
    for (const result of results) {
      if (isPublishedMaterialCostOk(result)) withCoverage += 1;
    }
  }

  return buildCoverageMetrics(activeMaterials.length, withCoverage);
}

async function auditProductionCoverage(
  db: PrismaClient,
  referenceDate: Date
): Promise<CostPriceMarginAuditPayload["products"]> {
  const activeProducts = await db.product.findMany({
    where: { status: "ACTIVE", type: "PRODUCT" },
    select: { id: true },
  });
  const activeComponents = await db.product.findMany({
    where: { status: "ACTIVE", type: "COMPONENT" },
    select: { id: true },
  });

  const [productCosts, componentCosts] = await Promise.all([
    getEffectiveProductProductionCosts(
      db,
      activeProducts.map((p) => p.id),
      referenceDate
    ),
    getEffectiveProductProductionCosts(
      db,
      activeComponents.map((p) => p.id),
      referenceDate
    ),
  ]);

  let productsWithCost = 0;
  for (const product of activeProducts) {
    const result = productCosts.get(product.id);
    if (result && isPublishedProductionCostOk(result)) productsWithCost += 1;
  }

  let componentsWithCost = 0;
  for (const component of activeComponents) {
    const result = componentCosts.get(component.id);
    if (result && isPublishedProductionCostOk(result)) componentsWithCost += 1;
  }

  return {
    activeProducts: buildCoverageMetrics(activeProducts.length, productsWithCost),
    activeComponents: buildCoverageMetrics(activeComponents.length, componentsWithCost),
  };
}

async function auditOfficialPriceCoverage(
  db: PrismaClient,
  referenceDate: Date
): Promise<CostPriceMarginAuditPayload["officialPrice"]> {
  const [priceTables, activeProducts, activeComponents] = await Promise.all([
    db.priceTable.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    }),
    db.product.findMany({
      where: { status: "ACTIVE", type: "PRODUCT" },
      select: { id: true },
    }),
    db.product.findMany({
      where: { status: "ACTIVE", type: "COMPONENT" },
      select: { id: true },
    }),
  ]);

  const productIds = new Set(activeProducts.map((p) => p.id));
  const componentIds = new Set(activeComponents.map((p) => p.id));
  const productsWithPrice = new Set<string>();
  const componentsWithPrice = new Set<string>();

  for (const table of priceTables) {
    const version = await resolvePublishedPriceTableVersionForDate(db, table.id, referenceDate);
    if (!version) continue;

    const items = await db.priceTableItem.findMany({
      where: {
        priceTableVersionId: version.id,
        salePrice: { gt: 0 },
      },
      select: { productId: true },
    });

    for (const item of items) {
      if (productIds.has(item.productId)) productsWithPrice.add(item.productId);
      if (componentIds.has(item.productId)) componentsWithPrice.add(item.productId);
    }
  }

  return {
    priceTablesChecked: priceTables.length,
    productsWithOfficialPrice: productsWithPrice.size,
    componentsWithOfficialPrice: componentsWithPrice.size,
    activeProductsTotal: activeProducts.length,
    activeComponentsTotal: activeComponents.length,
  };
}

export async function buildCostPriceMarginIntegratedAudit(
  db: PrismaClient,
  filters: CostPriceMarginIntegratedAuditFilters
): Promise<CostPriceMarginAuditPayload> {
  const top = Math.max(1, Math.min(filters.top ?? 10, 100));
  const referenceDate = filters.to;
  const referenceDateKey = toCivilDateKey(referenceDate) ?? referenceDate.toISOString().slice(0, 10);

  const [materials, products, officialPrice, orders] = await Promise.all([
    auditMaterialCoverage(db, referenceDate),
    auditProductionCoverage(db, referenceDate),
    auditOfficialPriceCoverage(db, referenceDate),
    db.salesOrder.findMany({
      where: buildSalesOrderWhere(filters),
      select: {
        id: true,
        orderCode: true,
        proposalId: true,
        issueDate: true,
        nomusRawResponse: true,
        items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
      },
      orderBy: { issueDate: "asc" },
    }),
  ]);

  const productIdsForResolver = [
    ...new Set(
      orders.flatMap((order) =>
        (order.items ?? []).map((item) => item.productId).filter(Boolean)
      )
    ),
  ] as string[];

  await registerOfficialServerResolversForAuditScripts(db, productIdsForResolver);

  const marginOrders: SalesOrderForMargin[] = orders.map((order) => ({
    id: order.id,
    proposalId: order.proposalId,
    issueDate: order.issueDate,
    nomusRawResponse: order.nomusRawResponse,
    items: order.items,
  }));

  const marginByOrder = await calculateSalesOrderMarginsForOrders(db, marginOrders);

  const productMeta = await db.product.findMany({
    where: {
      id: {
        in: productIdsForResolver,
      },
    },
    select: { id: true, sku: true, name: true, type: true },
  });
  const productById = new Map(productMeta.map((p) => [p.id, p]));

  let itemsSold = 0;
  let marginOk = 0;
  let semCusto = 0;
  let semPrecoTabela = 0;
  let precoIndisponivel = 0;
  let otherMarginIssues = 0;

  const withoutCostMap = new Map<string, TopSoldPendingAccumulator>();
  const withoutPriceMap = new Map<string, TopSoldPendingAccumulator>();
  const versionUsage = new Map<string, CostPriceMarginVersionUsed>();

  for (const order of orders) {
    const marginResult = marginByOrder.get(order.id);
    if (!marginResult) continue;

    for (const itemResult of marginResult.itemResults) {
      itemsSold += 1;
      const itemMargin = marginResult.itemMargins.get(itemResult.salesOrderItemId);
      const referenceStatus = itemMargin?.commercialReference?.referenceStatus ?? null;
      const classification = classifySoldItemForIntegratedAudit({
        marginStatus: itemResult.status,
        referenceStatus,
      });

      switch (classification) {
        case "MARGIN_OK":
          marginOk += 1;
          break;
        case "SEM_CUSTO":
          semCusto += 1;
          break;
        case "SEM_PRECO_TABELA":
          semPrecoTabela += 1;
          break;
        case "PRECO_INDISPONIVEL":
          precoIndisponivel += 1;
          break;
        default:
          otherMarginIssues += 1;
          break;
      }

      const productId = itemResult.productId;
      if (!productId) continue;
      const product = productById.get(productId);
      const qty = Number.isFinite(itemResult.quantity) ? itemResult.quantity : 0;
      const revenue = Number.isFinite(itemResult.netRevenue) ? itemResult.netRevenue : 0;

      if (classification === "SEM_CUSTO") {
        const key = `${productId}:SEM_CUSTO`;
        const acc =
          withoutCostMap.get(key) ??
          ({
            productId,
            sku: product?.sku ?? itemResult.productSku ?? productId,
            name: product?.name ?? itemResult.productName ?? "—",
            productType: product?.type ?? itemMargin?.commercialReference?.productType ?? "—",
            quantitySold: 0,
            revenueSold: 0,
            orderIds: new Set<string>(),
            reason: "SEM_CUSTO",
          } satisfies TopSoldPendingAccumulator);
        acc.quantitySold += qty;
        acc.revenueSold += revenue;
        acc.orderIds.add(order.id);
        withoutCostMap.set(key, acc);
      }

      if (classification === "SEM_PRECO_TABELA" || classification === "PRECO_INDISPONIVEL") {
        const reason =
          classification === "SEM_PRECO_TABELA" ? "SEM_PRECO_TABELA" : "PRECO_INDISPONIVEL";
        const key = `${productId}:${reason}`;
        const acc =
          withoutPriceMap.get(key) ??
          ({
            productId,
            sku: product?.sku ?? itemResult.productSku ?? productId,
            name: product?.name ?? itemResult.productName ?? "—",
            productType: product?.type ?? itemMargin?.commercialReference?.productType ?? "—",
            quantitySold: 0,
            revenueSold: 0,
            orderIds: new Set<string>(),
            reason,
          } satisfies TopSoldPendingAccumulator);
        acc.quantitySold += qty;
        acc.revenueSold += revenue;
        acc.orderIds.add(order.id);
        withoutPriceMap.set(key, acc);
      }

      const productionMeta = itemMargin?.commercialReference?.productionCost;
      if (productionMeta?.versionCode) {
        mergeVersionUsage(versionUsage, {
          layer: "PRODUCTION",
          code: productionMeta.versionCode,
          revision: productionMeta.revision ?? null,
          versionNumber: null,
          effectiveDate: productionMeta.effectiveDate ?? null,
        });
      }

      const priceMeta = itemMargin?.commercialReference?.officialPrice;
      if (priceMeta?.priceTableCode) {
        mergeVersionUsage(versionUsage, {
          layer: "PRICE",
          code: priceMeta.priceTableCode,
          revision: null,
          versionNumber: priceMeta.versionNumber ?? null,
          effectiveDate: priceMeta.effectiveFrom ?? null,
        });
      }
    }
  }

  const payload: CostPriceMarginAuditPayload = {
    period: {
      from: toCivilDateKey(filters.from) ?? filters.from.toISOString().slice(0, 10),
      to: toCivilDateKey(filters.to) ?? filters.to.toISOString().slice(0, 10),
      label: filters.label,
    },
    filters: {
      seller: filters.seller,
      customer: filters.customer,
      sku: filters.sku,
      top,
    },
    referenceDate: referenceDateKey,
    materials,
    products,
    officialPrice,
    salesOrders: {
      ordersTotal: orders.length,
      itemsSold,
      marginOk,
      semCusto,
      semPrecoTabela,
      precoIndisponivel,
      otherMarginIssues,
    },
    topSoldWithoutCost: rankTopSoldPendingItems([...withoutCostMap.values()], top),
    topSoldWithoutOfficialPrice: rankTopSoldPendingItems([...withoutPriceMap.values()], top),
    versionsUsedInPeriod: [...versionUsage.values()].sort(
      (a, b) => b.usageCount - a.usageCount || a.layer.localeCompare(b.layer)
    ),
    criticalPendingCount: 0,
    generatedAt: new Date().toISOString(),
  };

  payload.criticalPendingCount = computeCriticalPendingCount(payload);
  return payload;
}
