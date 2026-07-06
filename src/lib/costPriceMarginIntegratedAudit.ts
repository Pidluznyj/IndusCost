/**
 * Tipos e classificação pura — auditoria integrada MP / produção / preço / margem.
 * Sem Prisma; reutilizada pelo script, API e testes.
 */
import type { EffectiveMaterialCostResult } from "./materialCostVersioning.js";
import type { EffectiveProductProductionCostResult } from "./productionCostVersioning.js";
import type {
  SalesOrderMarginCommercialReferenceStatus,
  SalesOrderMarginStatus,
} from "./salesOrderMarginTypes.js";

export type CostPriceMarginCoverageMetrics = {
  total: number;
  withCoverage: number;
  withoutCoverage: number;
  coveragePercent: number | null;
};

export type SoldItemAuditClassification =
  | "MARGIN_OK"
  | "SEM_CUSTO"
  | "SEM_PRECO_TABELA"
  | "PRECO_INDISPONIVEL"
  | "OTHER_MARGIN_ISSUE";

export type CostPriceMarginAuditTopItem = {
  productId: string;
  sku: string;
  name: string;
  productType: string;
  quantitySold: number;
  revenueSold: number;
  orderCount: number;
  reason: "SEM_CUSTO" | "SEM_PRECO_TABELA" | "PRECO_INDISPONIVEL";
};

export type CostPriceMarginVersionUsed = {
  layer: "MATERIAL" | "PRODUCTION" | "PRICE";
  code: string;
  revision: number | null;
  versionNumber: number | null;
  effectiveDate: string | null;
  usageCount: number;
};

export type CostPriceMarginAuditPayload = {
  period: { from: string; to: string; label: string };
  filters: {
    seller?: string;
    customer?: string;
    sku?: string;
    top: number;
  };
  referenceDate: string;
  materials: CostPriceMarginCoverageMetrics;
  products: {
    activeProducts: CostPriceMarginCoverageMetrics;
    activeComponents: CostPriceMarginCoverageMetrics;
  };
  officialPrice: {
    priceTablesChecked: number;
    productsWithOfficialPrice: number;
    componentsWithOfficialPrice: number;
    activeProductsTotal: number;
    activeComponentsTotal: number;
  };
  salesOrders: {
    ordersTotal: number;
    itemsSold: number;
    marginOk: number;
    semCusto: number;
    semPrecoTabela: number;
    precoIndisponivel: number;
    otherMarginIssues: number;
  };
  topSoldWithoutCost: CostPriceMarginAuditTopItem[];
  topSoldWithoutOfficialPrice: CostPriceMarginAuditTopItem[];
  versionsUsedInPeriod: CostPriceMarginVersionUsed[];
  criticalPendingCount: number;
  generatedAt: string;
};

export const COST_PRICE_MARGIN_AUDIT_PENDENCY_CODES = [
  "MATERIAL_SEM_CUSTO_PUBLICADO",
  "PRODUTO_SEM_CUSTO_PUBLICADO",
  "COMPONENTE_SEM_CUSTO_PUBLICADO",
  "PRODUTO_SEM_PRECO_OFICIAL",
  "COMPONENTE_SEM_PRECO_OFICIAL",
  "ITEM_VENDIDO_SEM_CUSTO",
  "ITEM_VENDIDO_SEM_PRECO_TABELA",
  "ITEM_VENDIDO_PRECO_INDISPONIVEL",
  "MARGEM_OUTROS_PROBLEMAS",
] as const;

export type CostPriceMarginAuditPendencyCode =
  (typeof COST_PRICE_MARGIN_AUDIT_PENDENCY_CODES)[number];

export function isPublishedMaterialCostOk(result: EffectiveMaterialCostResult): boolean {
  return result.status === "OK" && Number.isFinite(result.landedCostSnapshot) && result.landedCostSnapshot > 0;
}

export function isPublishedProductionCostOk(
  result: EffectiveProductProductionCostResult
): boolean {
  return (
    result.status === "OK" &&
    Number.isFinite(result.unitProductionCost) &&
    result.unitProductionCost > 0
  );
}

export function buildCoverageMetrics(total: number, withCoverage: number): CostPriceMarginCoverageMetrics {
  const safeTotal = Math.max(0, total);
  const safeWith = Math.min(Math.max(0, withCoverage), safeTotal);
  const withoutCoverage = safeTotal - safeWith;
  const coveragePercent =
    safeTotal > 0 ? Math.round((safeWith / safeTotal) * 10000) / 100 : null;
  return {
    total: safeTotal,
    withCoverage: safeWith,
    withoutCoverage,
    coveragePercent,
  };
}

export function classifySoldItemForIntegratedAudit(input: {
  marginStatus: SalesOrderMarginStatus;
  referenceStatus?: SalesOrderMarginCommercialReferenceStatus | null;
}): SoldItemAuditClassification {
  if (input.marginStatus === "SEM_CUSTO" || input.marginStatus === "CUSTO_ZERO") {
    return "SEM_CUSTO";
  }
  if (input.referenceStatus === "SEM_PRECO_TABELA") return "SEM_PRECO_TABELA";
  if (input.referenceStatus === "PRECO_INDISPONIVEL") return "PRECO_INDISPONIVEL";
  if (input.marginStatus === "OK") return "MARGIN_OK";
  return "OTHER_MARGIN_ISSUE";
}

export function computeCriticalPendingCount(payload: Pick<
  CostPriceMarginAuditPayload,
  "materials" | "products" | "salesOrders"
>): number {
  return (
    payload.materials.withoutCoverage +
    payload.products.activeProducts.withoutCoverage +
    payload.products.activeComponents.withoutCoverage +
    payload.salesOrders.semCusto +
    payload.salesOrders.semPrecoTabela +
    payload.salesOrders.precoIndisponivel
  );
}

export type TopSoldPendingAccumulator = {
  productId: string;
  sku: string;
  name: string;
  productType: string;
  quantitySold: number;
  revenueSold: number;
  orderIds: Set<string>;
  reason: CostPriceMarginAuditTopItem["reason"];
};

export function rankTopSoldPendingItems(
  items: TopSoldPendingAccumulator[],
  top: number
): CostPriceMarginAuditTopItem[] {
  const limit = Math.max(1, Math.min(top, 100));
  return [...items]
    .sort((a, b) => b.revenueSold - a.revenueSold || b.quantitySold - a.quantitySold)
    .slice(0, limit)
    .map((row) => ({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      productType: row.productType,
      quantitySold: roundMoney(row.quantitySold),
      revenueSold: roundMoney(row.revenueSold),
      orderCount: row.orderIds.size,
      reason: row.reason,
    }));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function mergeVersionUsage(
  map: Map<string, CostPriceMarginVersionUsed>,
  row: Omit<CostPriceMarginVersionUsed, "usageCount">
): void {
  const key = `${row.layer}:${row.code}:${row.revision ?? ""}:${row.versionNumber ?? ""}:${row.effectiveDate ?? ""}`;
  const existing = map.get(key);
  if (existing) {
    existing.usageCount += 1;
    return;
  }
  map.set(key, { ...row, usageCount: 1 });
}
