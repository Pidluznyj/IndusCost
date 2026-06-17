/**
 * Mix de produtos e oportunidades — Inteligência do Cliente.
 * Fonte: SalesOrderItem em pedidos válidos (metricsOrders).
 */

import type {
  CustomerIntelligenceOrderInput,
  CustomerIntelligenceProductMix,
  CustomerIntelligenceProductOpportunity,
  CustomerIntelligenceProductRow,
  CustomerIntelligenceTopN,
} from "@/src/lib/customerIntelligenceTypes.js";
import {
  applyTopNLimit,
  CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS,
  CUSTOMER_INTELLIGENCE_NEW_PRODUCT_DAYS,
  daysBetweenDates,
  roundMoney,
  safeCommercialNumber,
  safeDivide,
  safeFiniteNumber,
  toIsoDateOnly,
} from "@/src/lib/customerIntelligenceUtils.js";

/** Mix com até N produtos distintos para sinalizar baixa diversificação. */
export const CUSTOMER_INTELLIGENCE_LOW_MIX_MAX_PRODUCTS = 3;

/** Concentração top 3 acima deste % gera oportunidade de risco. */
export const CUSTOMER_INTELLIGENCE_CONCENTRATION_TOP3_THRESHOLD_PERCENT = 70;

/** Recorrente sem recompra há N dias → oportunidade de contato. */
export const CUSTOMER_INTELLIGENCE_RECURRING_LATE_DAYS = 90;

/** Pedidos válidos mínimos para confiança alta em abandono/sazonalidade de produto. */
export const CUSTOMER_INTELLIGENCE_MIN_ORDERS_FOR_HIGH_PRODUCT_CONFIDENCE = 3;

type ProductAgg = {
  productId: string;
  productCode: string;
  productName: string;
  type: string | null;
  quantity: number;
  revenue: number;
  marginAmount: number;
  marginPercSamples: number[];
  orderIds: Set<string>;
  purchasePeriods: Set<string>;
  firstPurchaseDate: Date | null;
  lastPurchaseDate: Date | null;
  hasItemMargin: boolean;
};

function averageMarginPercent(samples: number[]): number | null {
  const valid = samples.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  if (valid.every((v) => v === 0)) return null;
  return roundMoney(valid.reduce((a, b) => a + b, 0) / valid.length);
}

function resolveProductConfidence(
  ordersCount: number,
  clientValidOrdersCount: number
): CustomerIntelligenceProductRow["confidence"] {
  if (clientValidOrdersCount >= CUSTOMER_INTELLIGENCE_MIN_ORDERS_FOR_HIGH_PRODUCT_CONFIDENCE) {
    return ordersCount >= 2 ? "high" : "medium";
  }
  if (clientValidOrdersCount >= 2) return "medium";
  return "low";
}

function isRecurringProduct(agg: ProductAgg): boolean {
  if (agg.orderIds.size >= 2) return true;
  return agg.purchasePeriods.size >= 2;
}

function finalizeProductRow(
  agg: ProductAgg,
  totalRevenue: number,
  now: Date,
  clientValidOrdersCount: number,
  confidenceOverride?: CustomerIntelligenceProductRow["confidence"]
): CustomerIntelligenceProductRow {
  const marginAmount =
    agg.hasItemMargin && agg.marginAmount !== 0
      ? roundMoney(agg.marginAmount)
      : agg.hasItemMargin
        ? roundMoney(agg.marginAmount)
        : null;

  const marginPercent = agg.hasItemMargin ? averageMarginPercent(agg.marginPercSamples) : null;

  const daysSinceLastPurchase =
    agg.lastPurchaseDate != null ? daysBetweenDates(agg.lastPurchaseDate, now) : null;

  const share =
    totalRevenue > 0 ? roundMoney(safeDivide(agg.revenue, totalRevenue)! * 100) : null;

  return {
    productId: agg.productId,
    productCode: agg.productCode,
    productName: agg.productName,
    type: agg.type,
    ordersCount: agg.orderIds.size,
    quantity: roundMoney(agg.quantity) ?? 0,
    revenue: roundMoney(agg.revenue) ?? 0,
    averageTicket: safeDivide(agg.revenue, agg.orderIds.size),
    marginAmount,
    marginPercent,
    firstPurchaseDate: toIsoDateOnly(agg.firstPurchaseDate),
    lastPurchaseDate: toIsoDateOnly(agg.lastPurchaseDate),
    daysSinceLastPurchase,
    shareOfCustomerRevenue: share,
    confidence:
      confidenceOverride ?? resolveProductConfidence(agg.orderIds.size, clientValidOrdersCount),
  };
}

function aggregateProducts(
  metricsOrders: CustomerIntelligenceOrderInput[]
): { byProduct: Map<string, ProductAgg>; missingItemMargin: boolean } {
  const byProduct = new Map<string, ProductAgg>();
  let missingItemMargin = false;

  for (const order of metricsOrders) {
    const periodKey = `${order.issueDate.getFullYear()}-${String(order.issueDate.getMonth() + 1).padStart(2, "0")}`;

    for (const item of order.items) {
      const productId = item.productId;
      const product = item.Product;
      const qty = safeCommercialNumber(item.quantity);
      const rev = safeCommercialNumber(item.totalNetValue);
      const itemMargin = safeFiniteNumber(item.marginValue);
      const itemMarginPerc = safeFiniteNumber(item.marginPerc);
      const hasItemMargin = itemMargin != null || itemMarginPerc != null;

      if (rev > 0 && !hasItemMargin) {
        missingItemMargin = true;
      }

      const prev = byProduct.get(productId);
      if (prev) {
        prev.quantity += qty;
        prev.revenue += rev;
        if (itemMargin != null) prev.marginAmount += itemMargin;
        if (itemMarginPerc != null) prev.marginPercSamples.push(itemMarginPerc);
        prev.hasItemMargin = prev.hasItemMargin || hasItemMargin;
        prev.orderIds.add(order.id);
        prev.purchasePeriods.add(periodKey);
        if (!prev.firstPurchaseDate || order.issueDate < prev.firstPurchaseDate) {
          prev.firstPurchaseDate = order.issueDate;
        }
        if (!prev.lastPurchaseDate || order.issueDate > prev.lastPurchaseDate) {
          prev.lastPurchaseDate = order.issueDate;
        }
      } else {
        byProduct.set(productId, {
          productId,
          productCode: product?.sku ?? "—",
          productName: product?.name ?? "Produto",
          type: product?.type ?? null,
          quantity: qty,
          revenue: rev,
          marginAmount: itemMargin ?? 0,
          marginPercSamples: itemMarginPerc != null ? [itemMarginPerc] : [],
          orderIds: new Set([order.id]),
          purchasePeriods: new Set([periodKey]),
          firstPurchaseDate: order.issueDate,
          lastPurchaseDate: order.issueDate,
          hasItemMargin,
        });
      }
    }
  }

  return { byProduct, missingItemMargin };
}

function buildConcentration(
  sortedByRevenue: CustomerIntelligenceProductRow[]
): CustomerIntelligenceProductMix["concentration"] {
  const totalRevenue = sortedByRevenue.reduce((acc, r) => acc + r.revenue, 0);
  const top1 = sortedByRevenue[0]?.revenue ?? 0;
  const top3 = sortedByRevenue.slice(0, 3).reduce((acc, r) => acc + r.revenue, 0);
  const top5 = sortedByRevenue.slice(0, 5).reduce((acc, r) => acc + r.revenue, 0);

  return {
    top1RevenueSharePercent:
      totalRevenue > 0 ? roundMoney(safeDivide(top1, totalRevenue)! * 100) : null,
    top3RevenueSharePercent:
      totalRevenue > 0 ? roundMoney(safeDivide(top3, totalRevenue)! * 100) : null,
    top5RevenueSharePercent:
      totalRevenue > 0 ? roundMoney(safeDivide(top5, totalRevenue)! * 100) : null,
    distinctProductsCount: sortedByRevenue.length,
  };
}

function buildProductOpportunities(
  allRows: CustomerIntelligenceProductRow[],
  abandoned: CustomerIntelligenceProductRow[],
  recurring: CustomerIntelligenceProductRow[],
  concentration: CustomerIntelligenceProductMix["concentration"],
  topByMargin: CustomerIntelligenceProductRow[]
): CustomerIntelligenceProductOpportunity[] {
  const opportunities: CustomerIntelligenceProductOpportunity[] = [];

  for (const product of abandoned.slice(0, 5)) {
    opportunities.push({
      kind: "offer_again",
      severity: product.confidence === "low" ? "LOW" : "MEDIUM",
      title: "Ofertar novamente",
      description: `${product.productName} (${product.productCode}) sem compra há ${product.daysSinceLastPurchase ?? "—"} dias — receita histórica ${product.revenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`,
      productId: product.productId,
      productCode: product.productCode,
      productName: product.productName,
      confidence: product.confidence,
    });
  }

  for (const product of recurring) {
    if (
      product.daysSinceLastPurchase != null &&
      product.daysSinceLastPurchase > CUSTOMER_INTELLIGENCE_RECURRING_LATE_DAYS
    ) {
      opportunities.push({
        kind: "recurring_late",
        severity: "MEDIUM",
        title: "Produto recorrente atrasado",
        description: `${product.productName} costuma voltar (${product.ordersCount} pedido(s)) — última compra há ${product.daysSinceLastPurchase} dias.`,
        productId: product.productId,
        productCode: product.productCode,
        productName: product.productName,
        confidence: product.confidence,
      });
    }
  }

  if (
    concentration.distinctProductsCount > 0 &&
    concentration.distinctProductsCount <= CUSTOMER_INTELLIGENCE_LOW_MIX_MAX_PRODUCTS
  ) {
    opportunities.push({
      kind: "low_mix",
      severity: "MEDIUM",
      title: "Mix baixo",
      description: `Apenas ${concentration.distinctProductsCount} produto(s) distinto(s) no histórico filtrado — oportunidade de ampliar portfólio.`,
      productId: null,
      productCode: null,
      productName: null,
      confidence: concentration.distinctProductsCount === 1 ? "low" : "medium",
    });
  }

  if (
    concentration.top3RevenueSharePercent != null &&
    concentration.top3RevenueSharePercent >= CUSTOMER_INTELLIGENCE_CONCENTRATION_TOP3_THRESHOLD_PERCENT
  ) {
    opportunities.push({
      kind: "concentrated_revenue",
      severity: "HIGH",
      title: "Receita concentrada",
      description: `Top 3 produtos concentram ${concentration.top3RevenueSharePercent.toFixed(1)}% da receita do cliente no filtro.`,
      productId: allRows[0]?.productId ?? null,
      productCode: allRows[0]?.productCode ?? null,
      productName: allRows[0]?.productName ?? null,
      confidence: "high",
    });
  }

  const topRevenue = allRows[0];
  const marginLeader = topByMargin[0];
  if (
    topRevenue &&
    marginLeader &&
    marginLeader.productId !== topRevenue.productId &&
    (marginLeader.marginPercent ?? 0) > (topRevenue.marginPercent ?? 0) &&
    (marginLeader.shareOfCustomerRevenue ?? 0) < (topRevenue.shareOfCustomerRevenue ?? 0)
  ) {
    opportunities.push({
      kind: "up_sell",
      severity: "LOW",
      title: "Potencial de up-sell",
      description: `${marginLeader.productName} apresenta margem superior (${marginLeader.marginPercent?.toFixed(1) ?? "—"}%) com participação ainda menor que o produto líder.`,
      productId: marginLeader.productId,
      productCode: marginLeader.productCode,
      productName: marginLeader.productName,
      confidence: "medium",
    });
  }

  const singlePurchaseRecent = allRows.filter(
    (p) =>
      p.ordersCount === 1 &&
      p.daysSinceLastPurchase != null &&
      p.daysSinceLastPurchase <= CUSTOMER_INTELLIGENCE_NEW_PRODUCT_DAYS &&
      p.productId !== topRevenue?.productId
  );
  if (singlePurchaseRecent.length > 0 && (concentration.distinctProductsCount ?? 0) >= 2) {
    const candidate = singlePurchaseRecent[0]!;
    opportunities.push({
      kind: "cross_sell",
      severity: "LOW",
      title: "Potencial de cross-sell",
      description: `${candidate.productName} entrou recentemente no mix — avaliar combinar com ${topRevenue?.productName ?? "produto líder"}.`,
      productId: candidate.productId,
      productCode: candidate.productCode,
      productName: candidate.productName,
      confidence: "low",
    });
  }

  return opportunities.slice(0, 12);
}

export type BuildCustomerIntelligenceProductsResult = {
  products: CustomerIntelligenceProductMix;
  warnings: string[];
};

export function buildCustomerIntelligenceProducts(
  metricsOrders: CustomerIntelligenceOrderInput[],
  topN: CustomerIntelligenceTopN,
  now: Date
): BuildCustomerIntelligenceProductsResult {
  const warnings: string[] = [];
  const clientValidOrdersCount = metricsOrders.length;

  if (metricsOrders.length === 0) {
    return {
      products: {
        topByRevenue: [],
        topByQuantity: [],
        topByMargin: [],
        abandonedProducts: [],
        recurringProducts: [],
        newProducts: [],
        concentration: {
          top1RevenueSharePercent: null,
          top3RevenueSharePercent: null,
          top5RevenueSharePercent: null,
          distinctProductsCount: 0,
        },
        productOpportunities: [],
      },
      warnings,
    };
  }

  const { byProduct, missingItemMargin } = aggregateProducts(metricsOrders);
  if (missingItemMargin) {
    warnings.push(
      "Margem por item indisponível em parte dos itens — margem de produto pode estar incompleta."
    );
  }

  const totalRevenue = [...byProduct.values()].reduce((acc, p) => acc + p.revenue, 0);

  const allRows = [...byProduct.values()].map((agg) =>
    finalizeProductRow(agg, totalRevenue, now, clientValidOrdersCount)
  );

  const sortedByRevenue = [...allRows].sort((a, b) => b.revenue - a.revenue);
  const sortedByQuantity = [...allRows].sort((a, b) => b.quantity - a.quantity);
  const sortedByMargin = [...allRows]
    .filter((r) => r.marginAmount != null && r.marginAmount > 0)
    .sort((a, b) => (b.marginAmount ?? 0) - (a.marginAmount ?? 0));

  const abandonedCutoff = new Date(now);
  abandonedCutoff.setDate(abandonedCutoff.getDate() - CUSTOMER_INTELLIGENCE_ABANDONED_PRODUCT_DAYS);

  const newProductCutoff = new Date(now);
  newProductCutoff.setDate(newProductCutoff.getDate() - CUSTOMER_INTELLIGENCE_NEW_PRODUCT_DAYS);

  const abandonedProducts = applyTopNLimit(
    [...byProduct.values()]
      .filter(
        (p) =>
          p.lastPurchaseDate != null &&
          p.lastPurchaseDate < abandonedCutoff &&
          p.firstPurchaseDate != null &&
          p.firstPurchaseDate < abandonedCutoff
      )
      .map((agg) =>
        finalizeProductRow(
          agg,
          totalRevenue,
          now,
          clientValidOrdersCount,
          clientValidOrdersCount < CUSTOMER_INTELLIGENCE_MIN_ORDERS_FOR_HIGH_PRODUCT_CONFIDENCE
            ? "low"
            : resolveProductConfidence(agg.orderIds.size, clientValidOrdersCount)
        )
      )
      .sort((a, b) => b.revenue - a.revenue),
    topN
  );

  const recurringProducts = applyTopNLimit(
    [...byProduct.values()]
      .filter(isRecurringProduct)
      .map((agg) => finalizeProductRow(agg, totalRevenue, now, clientValidOrdersCount))
      .sort((a, b) => b.ordersCount - a.ordersCount),
    topN
  );

  const newProducts = applyTopNLimit(
    [...byProduct.values()]
      .filter(
        (p) => p.firstPurchaseDate != null && p.firstPurchaseDate >= newProductCutoff
      )
      .map((agg) => finalizeProductRow(agg, totalRevenue, now, clientValidOrdersCount))
      .sort((a, b) => b.revenue - a.revenue),
    topN
  );

  const concentration = buildConcentration(sortedByRevenue);

  const topByRevenue = applyTopNLimit(sortedByRevenue, topN);
  const topByQuantity = applyTopNLimit(sortedByQuantity, topN);
  const topByMargin = applyTopNLimit(sortedByMargin, topN);

  const productOpportunities = buildProductOpportunities(
    sortedByRevenue,
    abandonedProducts,
    recurringProducts,
    concentration,
    sortedByMargin
  );

  return {
    products: {
      topByRevenue,
      topByQuantity,
      topByMargin,
      abandonedProducts,
      recurringProducts,
      newProducts,
      concentration,
      productOpportunities,
    },
    warnings,
  };
}
