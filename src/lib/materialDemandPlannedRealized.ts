import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import { isCancelledSalesOrderStatus, isOpenPortfolioOrder } from "./salesOrderDashboardRules.js";
import type {
  MaterialDemandInvoicingScope,
  MaterialUsageContribution,
  MaterialUsageNfeSummary,
  MaterialUsagePlannedRealizedDataQuality,
  MaterialUsagePlannedRealizedSummary,
  MaterialUsagePlannedRealizedRow,
  MaterialUsageVarianceStatus,
} from "./materialDemandPlannedRealizedTypes.js";

export const PLANNED_REALIZED_REALIZED_BASIS_NOTE =
  "Realizado considera pedidos com nota fiscal emitida.";

export const PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE =
  "Realizado é baseado em pedidos com nota fiscal emitida, não em baixa real de estoque.";

export const PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING =
  "Alguns pedidos não possuem quantidade faturada por item; foi usado o total do pedido.";

export const PLANNED_REALIZED_MISSING_BOM_WARNING =
  "Produto sem estrutura/BOM não entrou no cálculo.";

export const PLANNED_REALIZED_MISSING_COST_WARNING =
  "Custo ausente em algumas matérias-primas.";

export const PLANNED_REALIZED_COMPARISON_INTRO =
  "Compara a necessidade prevista de matéria-prima com o que foi efetivamente faturado.";

const STATUS_TOLERANCE_PERCENT = 0.01;

export function safeMaterialUsageRatio(
  numerator: number,
  denominator: number
): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator === 0) return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

export function resolveRealizedOrderItemQuantity(params: {
  orderQuantity: number;
  invoicedQuantityPerItem?: number | null;
  hasInvoicing: boolean;
}): { realizedQuantity: number; usedPartialInvoiceFallback: boolean } {
  const orderQty = Math.max(0, params.orderQuantity);
  if (!params.hasInvoicing) {
    return { realizedQuantity: 0, usedPartialInvoiceFallback: false };
  }
  const invoiced = params.invoicedQuantityPerItem;
  if (invoiced != null && Number.isFinite(invoiced) && invoiced >= 0) {
    return {
      realizedQuantity: Math.min(invoiced, orderQty),
      usedPartialInvoiceFallback: false,
    };
  }
  return { realizedQuantity: orderQty, usedPartialInvoiceFallback: true };
}

export function mapMaterialUsageVarianceStatus(
  plannedQuantity: number,
  realizedQuantity: number,
  hasIncompleteData = false
): MaterialUsageVarianceStatus {
  if (hasIncompleteData) return "incomplete_data";
  const planned = Math.max(0, plannedQuantity);
  const realized = Math.max(0, realizedQuantity);
  if (planned === 0 && realized > 0) return "no_planned_base";
  if (planned > 0 && realized === 0) return "no_realized";
  if (planned === 0 && realized === 0) return "within_planned";
  const variancePercent = safeMaterialUsageRatio(realized - planned, planned);
  if (variancePercent == null) return "incomplete_data";
  if (Math.abs(variancePercent * 100) <= STATUS_TOLERANCE_PERCENT) return "within_planned";
  if (realized > planned) return "above_planned";
  return "below_planned";
}

export function computeMaterialUsageMetrics(
  plannedQuantity: number,
  realizedQuantity: number,
  hasIncompleteData = false
): {
  remainingQuantity: number;
  varianceQuantity: number;
  variancePercent: number | null;
  accuracyPercent: number | null;
  status: MaterialUsageVarianceStatus;
} {
  const planned = Math.max(0, plannedQuantity);
  const realized = Math.max(0, realizedQuantity);
  const remainingQuantity = planned - realized;
  const varianceQuantity = realized - planned;
  const status = mapMaterialUsageVarianceStatus(planned, realized, hasIncompleteData);

  if (planned === 0 && realized > 0) {
    return {
      remainingQuantity,
      varianceQuantity,
      variancePercent: null,
      accuracyPercent: null,
      status,
    };
  }
  if (planned === 0) {
    return {
      remainingQuantity,
      varianceQuantity,
      variancePercent: null,
      accuracyPercent: null,
      status,
    };
  }

  const ratio = safeMaterialUsageRatio(realized, planned);
  const accuracyPercent = ratio == null ? null : ratio * 100;
  const varianceRatio = safeMaterialUsageRatio(varianceQuantity, planned);
  const variancePercent = varianceRatio == null ? null : varianceRatio * 100;

  return {
    remainingQuantity,
    varianceQuantity,
    variancePercent,
    accuracyPercent,
    status,
  };
}

export function salesOrderMatchesInvoicingScope(
  hasInvoicing: boolean,
  orderStatus: string,
  scope: MaterialDemandInvoicingScope
): boolean {
  if (isCancelledSalesOrderStatus(orderStatus) || orderStatus === "ERROR") return false;
  if (scope === "all") return true;
  if (scope === "invoiced") return hasInvoicing;
  return isOpenPortfolioOrder({
    status: orderStatus as "DRAFT" | "READY_TO_SEND" | "SENT_TO_NOMUS" | "CANCELLED" | "ERROR",
    hasNfeDataProcessamento: hasInvoicing,
  });
}

export function extractProcessedNfeSummaries(nomusRawResponse: unknown): MaterialUsageNfeSummary[] {
  if (!nomusRawResponse || typeof nomusRawResponse !== "object") return [];
  const nfes = (nomusRawResponse as { nfes?: unknown }).nfes;
  if (!Array.isArray(nfes)) return [];
  const out: MaterialUsageNfeSummary[] = [];
  for (const nfe of nfes) {
    if (!nfe || typeof nfe !== "object") continue;
    const dataProcessamento = String(
      (nfe as { dataProcessamento?: unknown }).dataProcessamento ?? ""
    ).trim();
    if (!dataProcessamento) continue;
    out.push({
      dataProcessamento,
      numero:
        typeof (nfe as { numero?: unknown }).numero === "string"
          ? (nfe as { numero: string }).numero
          : typeof (nfe as { nNF?: unknown }).nNF === "string"
            ? (nfe as { nNF: string }).nNF
            : null,
      serie:
        typeof (nfe as { serie?: unknown }).serie === "string"
          ? (nfe as { serie: string }).serie
          : null,
    });
  }
  return out;
}

export function orderHasProcessedInvoicing(nomusRawResponse: unknown): boolean {
  return salesOrderHasInvoicing(nomusRawResponse);
}

type MaterialAgg = {
  materialId: string;
  materialCode: string | null;
  materialDescription: string;
  unit: string | null;
  unitKey: string;
  unitLabel: string;
  plannedQuantity: number;
  realizedQuantity: number;
  plannedCost: number;
  realizedCost: number;
  unitCost: number | null;
  plannedOrderIds: Set<string>;
  realizedOrderIds: Set<string>;
  orderStats: Map<string, { plannedProductQty: number; realizedProductQty: number }>;
  productIds: Set<string>;
  rowWarnings: Set<string>;
  hasIncompleteData: boolean;
};

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function aggregateMaterialUsageContributions(
  contributions: MaterialUsageContribution[]
): MaterialUsagePlannedRealizedRow[] {
  const byMaterial = new Map<string, MaterialAgg>();

  for (const c of contributions) {
    const current =
      byMaterial.get(c.materialId) ??
      {
        materialId: c.materialId,
        materialCode: c.materialCode,
        materialDescription: c.materialDescription,
        unit: c.unit,
        unitKey: c.unitKey,
        unitLabel: c.unitLabel,
        plannedQuantity: 0,
        realizedQuantity: 0,
        plannedCost: 0,
        realizedCost: 0,
        unitCost: c.unitCost,
        plannedOrderIds: new Set<string>(),
        realizedOrderIds: new Set<string>(),
        orderStats: new Map<string, { plannedProductQty: number; realizedProductQty: number }>(),
        productIds: new Set<string>(),
        rowWarnings: new Set<string>(),
        hasIncompleteData: false,
      };

    const plannedQty = round6(c.materialQtyPerUnit * c.plannedOrderQty);
    const realizedQty = round6(c.materialQtyPerUnit * c.realizedOrderQty);
    const valuePerUnit = c.valuePerUnit ?? (c.unitCost != null ? c.unitCost * c.materialQtyPerUnit : null);

    current.plannedQuantity += plannedQty;
    current.realizedQuantity += realizedQty;
    if (valuePerUnit != null) {
      current.plannedCost += valuePerUnit * c.plannedOrderQty;
      current.realizedCost += valuePerUnit * c.realizedOrderQty;
    }
    if (current.unitCost == null && c.unitCost != null) current.unitCost = c.unitCost;
    current.plannedOrderIds.add(c.orderId);
    if (c.realizedOrderQty > 0) current.realizedOrderIds.add(c.orderId);
    const orderKey = `${c.orderId}:${c.productId}`;
    const orderStat =
      current.orderStats.get(orderKey) ?? { plannedProductQty: 0, realizedProductQty: 0 };
    orderStat.plannedProductQty += c.plannedOrderQty;
    orderStat.realizedProductQty += c.realizedOrderQty;
    current.orderStats.set(orderKey, orderStat);
    current.productIds.add(c.productId);
    if (c.usedPartialInvoiceFallback) {
      current.rowWarnings.add(PLANNED_REALIZED_PARTIAL_INVOICE_FALLBACK_WARNING);
    }
    if (c.missingCost) current.rowWarnings.add(PLANNED_REALIZED_MISSING_COST_WARNING);
    if (c.incompleteData) current.hasIncompleteData = true;
    byMaterial.set(c.materialId, current);
  }

  return [...byMaterial.values()]
    .map((m) => {
      const metrics = computeMaterialUsageMetrics(
        m.plannedQuantity,
        m.realizedQuantity,
        m.hasIncompleteData
      );
      const unitCost =
        m.unitCost ??
        (m.plannedQuantity > 0 ? m.plannedCost / m.plannedQuantity : null);
      let partiallyInvoicedOrdersCount = 0;
      const partialOrderIds = new Set<string>();
      for (const [key, stat] of m.orderStats) {
        if (
          stat.realizedProductQty > 0 &&
          stat.realizedProductQty + 1e-6 < stat.plannedProductQty
        ) {
          partialOrderIds.add(key.split(":")[0] ?? key);
        }
      }
      partiallyInvoicedOrdersCount = partialOrderIds.size;
      const notInvoicedOrdersCount = Math.max(
        0,
        m.plannedOrderIds.size - m.realizedOrderIds.size
      );
      const invoicedRatio = safeMaterialUsageRatio(
        m.realizedOrderIds.size,
        m.plannedOrderIds.size
      );
      return {
        materialId: m.materialId,
        materialCode: m.materialCode,
        materialName: m.materialDescription,
        unit: m.unit,
        unitKey: m.unitKey,
        unitLabel: m.unitLabel,
        plannedQuantity: round6(m.plannedQuantity),
        realizedQuantity: round6(m.realizedQuantity),
        remainingQuantity: round6(metrics.remainingQuantity),
        accuracyPercent: metrics.accuracyPercent,
        varianceQuantity: round6(metrics.varianceQuantity),
        variancePercent: metrics.variancePercent,
        unitCost: unitCost != null && Number.isFinite(unitCost) ? unitCost : null,
        plannedCost: round6(m.plannedCost),
        realizedCost: round6(m.realizedCost),
        costVariance: round6(m.realizedCost - m.plannedCost),
        plannedOrdersCount: m.plannedOrderIds.size,
        realizedOrdersCount: m.realizedOrderIds.size,
        notInvoicedOrdersCount,
        partiallyInvoicedOrdersCount,
        invoicedPercent:
          invoicedRatio == null ? null : round6(invoicedRatio * 100),
        relatedProductsCount: m.productIds.size,
        status: metrics.status,
        dataQuality: [...m.rowWarnings],
      } satisfies MaterialUsagePlannedRealizedRow;
    })
    .sort((a, b) => b.plannedCost - a.plannedCost || b.plannedQuantity - a.plannedQuantity);
}

export function buildMaterialUsagePlannedRealizedSummary(
  rows: MaterialUsagePlannedRealizedRow[],
  options?: {
    activeUnitKey?: string | null;
    quantityTotalsComparable?: boolean;
    activeUnitLabel?: string | null;
    plannedOrdersCount?: number;
    realizedOrdersCount?: number;
  }
): MaterialUsagePlannedRealizedSummary {
  let plannedQuantityTotal = 0;
  let realizedQuantityTotal = 0;
  let plannedCostTotal = 0;
  let realizedCostTotal = 0;

  for (const row of rows) {
    if (options?.activeUnitKey && row.unitKey !== options.activeUnitKey) continue;
    plannedQuantityTotal += row.plannedQuantity;
    realizedQuantityTotal += row.realizedQuantity;
    plannedCostTotal += row.plannedCost;
    realizedCostTotal += row.realizedCost;
  }

  const comparable = options?.quantityTotalsComparable ?? true;
  const overallRatio = safeMaterialUsageRatio(realizedQuantityTotal, plannedQuantityTotal);

  return {
    materialsCount: rows.length,
    plannedQuantityTotal: round6(plannedQuantityTotal),
    realizedQuantityTotal: round6(realizedQuantityTotal),
    remainingQuantityTotal: round6(plannedQuantityTotal - realizedQuantityTotal),
    plannedCostTotal: round6(plannedCostTotal),
    realizedCostTotal: round6(realizedCostTotal),
    costVarianceTotal: round6(realizedCostTotal - plannedCostTotal),
    accuracyPercent:
      comparable && plannedQuantityTotal > 0 && overallRatio != null
        ? round6(overallRatio * 100)
        : null,
    plannedOrdersCount: options?.plannedOrdersCount ?? 0,
    realizedOrdersCount: options?.realizedOrdersCount ?? 0,
    quantityTotalsComparable: comparable,
    activeUnitLabel: options?.activeUnitLabel ?? null,
  };
}

export function createMaterialUsagePlannedRealizedDataQuality(
  partial: Partial<MaterialUsagePlannedRealizedDataQuality> = {}
): MaterialUsagePlannedRealizedDataQuality {
  return {
    warnings: partial.warnings ?? [PLANNED_REALIZED_REALIZED_BASIS_NOTE],
    sources: partial.sources ?? [
      "Previsto: SalesOrder + SalesOrderItem + BOM (ProductBOM)",
      "Realizado: pedidos com NF vinculada (motor salesOrderMetricsEngine)",
    ],
    partialInvoiceFallbacks: partial.partialInvoiceFallbacks ?? 0,
    missingBomItems: partial.missingBomItems ?? 0,
    missingCosts: partial.missingCosts ?? 0,
    unitConversionWarnings: partial.unitConversionWarnings ?? 0,
    excludedCancelledOrError: partial.excludedCancelledOrError ?? 0,
  };
}

export function parseMaterialDemandInvoicingScope(raw: unknown): MaterialDemandInvoicingScope {
  if (raw === "invoiced" || raw === "portfolio") return raw;
  return "all";
}

export {
  type MaterialDemandInvoicingScope,
  type MaterialUsageContribution,
  type MaterialUsagePlannedRealizedDataQuality,
  type MaterialUsagePlannedRealizedRow,
  type MaterialUsagePlannedRealizedSummary,
  type MaterialUsageVarianceStatus,
  MATERIAL_USAGE_VARIANCE_STATUS_LABELS,
} from "./materialDemandPlannedRealizedTypes.js";
