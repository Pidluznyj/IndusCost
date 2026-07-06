/**
 * Serviços server-side do motor Cost-to-Cash Trace.
 * Ponto único para scripts, APIs e exportações CSV.
 */
import type { PrismaClient } from "@prisma/client";
import { startOfCivilDate } from "../financeCivilDate.js";
import { buildCommissionTraceAudit } from "../commissions/commissionTraceAudit.server.js";
import { buildProductCostTraceAudit } from "../productCostTraceAudit.server.js";
import { buildPublishedPriceSourceTrace } from "../pricing/publishedPriceSourceTrace.server.js";
import { buildSalesOrderTraceAudit } from "../salesOrderTraceAudit.server.js";
import type { CommissionTrace, CommissionTraceQuery } from "./commissionTrace.js";
import type { ProductCostTrace, ProductCostTraceQuery } from "./productCostTrace.js";
import type { PublishedPriceTrace, PublishedPriceTraceQuery } from "./publishedPriceTrace.js";
import type { SalesOrderTrace, SalesOrderTraceQuery } from "./salesOrderTrace.js";
import {
  assembleCostToCashTrace,
  buildEmptyCostToCashTrace,
  type CostToCashTrace,
  type CostToCashTraceQuery,
} from "./costToCashTrace.js";

export {
  buildProductCostTraceAudit as buildProductCostTrace,
  parseProductCostTraceReferenceDate,
} from "../productCostTraceAudit.server.js";

export { buildPublishedPriceSourceTrace as buildPublishedPriceTrace } from "../pricing/publishedPriceSourceTrace.server.js";

export { buildSalesOrderTraceAudit as buildSalesOrderTrace } from "../salesOrderTraceAudit.server.js";

export { buildCommissionTraceAudit as buildCommissionTrace } from "../commissions/commissionTraceAudit.server.js";

function wantsSalesOrCommission(query: CostToCashTraceQuery): boolean {
  return Boolean(
    query.salesOrderId?.trim() ||
      query.orderNumber?.trim() ||
      query.nfeNumber?.trim() ||
      query.receivableCode?.trim() ||
      (query.customer?.trim() && query.year != null)
  );
}

function resolveProductSkuFromSales(
  salesOrder: Awaited<ReturnType<typeof buildSalesOrderTraceAudit>>,
  skuFilter: string | null | undefined
): string | null {
  if (skuFilter?.trim()) return skuFilter.trim();
  const first = salesOrder.items.find((item) => item.sku?.trim());
  return first?.sku?.trim() ?? null;
}

export async function buildCostToCashTrace(
  db: PrismaClient,
  query: CostToCashTraceQuery
): Promise<CostToCashTrace> {
  const includeProduct = query.includeProductCost !== false;
  const includePrice = query.includePublishedPrice !== false;
  const includeSales = query.includeSalesOrder !== false;
  const includeCommission = query.includeCommission !== false;

  const hasProductKey = Boolean(query.sku?.trim() || query.productId?.trim());
  const hasPriceKey = Boolean(query.priceItemId?.trim());
  const hasSalesKey = wantsSalesOrCommission(query);

  if (!hasProductKey && !hasPriceKey && !hasSalesKey) {
    return buildEmptyCostToCashTrace(
      "Informe --sku, --price-item-id ou identificador de pedido (--order-number, --sales-order-id, --nfe-number, --receivable-code)."
    );
  }

  let product: ProductCostTrace | null = null;
  let publishedPrice: PublishedPriceTrace | null = null;
  let salesOrder: SalesOrderTrace | null = null;
  let commission: CommissionTrace | null = null;
  let errorMessage: string | null = null;

  if (hasSalesKey && includeSales) {
    const salesQuery: SalesOrderTraceQuery = {
      salesOrderId: query.salesOrderId ?? null,
      orderNumber: query.orderNumber ?? null,
      nfeNumber: query.nfeNumber ?? null,
      customer: query.customer ?? null,
      year: query.year ?? null,
      month: query.month ?? null,
      includeItems: true,
    };
    salesOrder = await buildSalesOrderTraceAudit(db, salesQuery);
    if (salesOrder.status === "FAIL") {
      errorMessage = salesOrder.errorMessage ?? "Falha ao rastrear pedido.";
    }
  }

  if (hasSalesKey && includeCommission) {
    const commissionQuery: CommissionTraceQuery = {
      year: query.year ?? null,
      month: query.month ?? null,
      seller: query.seller ?? null,
      salesOrderId: query.salesOrderId ?? salesOrder?.order?.salesOrderId ?? null,
      orderNumber: query.orderNumber ?? salesOrder?.order?.orderNumber ?? null,
      nfeNumber: query.nfeNumber ?? null,
      receivableCode: query.receivableCode ?? null,
      customer: query.customer ?? null,
      sku: query.sku ?? null,
      includeLines: true,
      nomusBase: query.nomusBase ?? null,
      nomusCommission: query.nomusCommission ?? null,
    };
    commission = await buildCommissionTraceAudit(db, commissionQuery);
    if (commission.status === "FAIL" && !errorMessage) {
      errorMessage = commission.errorMessage ?? "Falha ao rastrear comissão.";
    }
  }

  if (hasPriceKey && includePrice) {
    try {
      const priceQuery: PublishedPriceTraceQuery = {
        priceItemId: query.priceItemId!.trim(),
        productId: query.productId ?? null,
      };
      publishedPrice = await buildPublishedPriceSourceTrace(db, priceQuery);
    } catch (error) {
      if (!errorMessage) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    }
  }

  const productSku =
    query.sku?.trim() ??
    (publishedPrice?.product.sku?.trim() || null) ??
    (salesOrder ? resolveProductSkuFromSales(salesOrder, query.sku) : null);

  if ((hasProductKey || productSku) && includeProduct) {
    const productQuery: ProductCostTraceQuery = {
      sku: query.sku?.trim() ?? productSku,
      productId: query.productId ?? publishedPrice?.product.productId ?? null,
      referenceDate: query.referenceDate ?? startOfCivilDate(new Date()),
      includeBom: true,
      includeProcess: true,
      includeMaterials: true,
    };
    product = await buildProductCostTraceAudit(db, productQuery);
    if (product.status === "FAIL" && !hasSalesKey && !hasPriceKey) {
      errorMessage = product.errorMessage ?? "Falha ao rastrear custo do produto.";
    }
  }

  return assembleCostToCashTrace({
    product,
    publishedPrice,
    salesOrder,
    commission,
    errorMessage,
  });
}
