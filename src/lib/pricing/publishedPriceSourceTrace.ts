export const PUBLISHED_TRACE_UNAVAILABLE_LABEL = "Não disponível nesta versão publicada";

export const PUBLISHED_TRACE_NEWER_COST_WARNING =
  "Existe versão de custo mais recente. Gere nova DRAFT para atualizar este preço.";

export type PublishedTraceStatus = "AVAILABLE" | "NOT_AVAILABLE" | "PARTIAL";

export type PublishedPriceSourceTraceQuery = {
  priceItemId: string;
  tableId?: string | null;
  versionId?: string | null;
  productId?: string | null;
};

export type PublishedPriceSourceTrace = {
  product: {
    productId: string;
    sku: string;
    name: string;
    type: string | null;
    status: PublishedTraceStatus;
  };
  commercialPrice: {
    tableId: string;
    tableName: string;
    tableCode: string;
    versionId: string;
    versionNumber: number;
    priceItemId: string;
    salePrice: number | null;
    publishedAt: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    versionStatus: string | null;
    status: PublishedTraceStatus;
  };
  costSource: {
    productionCostTableVersionId: string | null;
    productionCostTableCode: string | null;
    productionCostTableName: string | null;
    productionCostRevision: number | null;
    productionCostEffectiveFrom: string | null;
    productionCostItemId: string | null;
    industrialCost: number | null;
    factoryCost: number | null;
    managerialCost: number | null;
    materialCostInPrice: number | null;
    laborCostInPrice: number | null;
    machineCostInPrice: number | null;
    status: PublishedTraceStatus;
    newerPublishedVersionWarning: string | null;
  };
  materialSource: {
    materialCostTableVersionId: string | null;
    materialCostTableCode: string | null;
    materialCostTableName: string | null;
    materialCostRevision: number | null;
    materialCostEffectiveFrom: string | null;
    materialCostAmount: number | null;
    status: PublishedTraceStatus;
  };
  taxSource: {
    taxRuleId: string | null;
    taxRuleName: string | null;
    taxPercent: number | null;
    taxAmount: number | null;
    status: PublishedTraceStatus;
  };
  marginSource: {
    marginRuleId: string | null;
    marginName: string | null;
    targetMarginPercent: number | null;
    publishedMarginPercent: number | null;
    markup: number | null;
    status: PublishedTraceStatus;
  };
  commissionSource: {
    commissionPercent: number | null;
    commissionAmount: number | null;
    source: string | null;
    status: PublishedTraceStatus;
  };
  deductions: {
    freightAmount: number | null;
    otherVariablesAmount: number | null;
    roundingAmount: number | null;
    frozenOtherCostTotal: number | null;
    status: PublishedTraceStatus;
  };
  availability: {
    hasFullSnapshot: boolean;
    missingFields: string[];
  };
};

export function decTrace(value: unknown): number | null {
  if (value == null) return null;
  const n =
    typeof value === "object" && value !== null && "toNumber" in value
      ? (value as { toNumber: () => number }).toNumber()
      : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function toIsoTrace(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : String(value);
}

export function readCostSnapshotFields(snapshot: Record<string, unknown> | null | undefined) {
  if (!snapshot) {
    return {
      productionCostTableVersionId: null as string | null,
      productionCostTableVersionCode: null as string | null,
      revision: null as number | null,
      effectiveDate: null as string | null,
      productionCostTableItemId: null as string | null,
      unitProductionCost: null as number | null,
      breakdown: null as Record<string, unknown> | null,
    };
  }
  return {
    productionCostTableVersionId:
      typeof snapshot.productionCostTableVersionId === "string"
        ? snapshot.productionCostTableVersionId
        : null,
    productionCostTableVersionCode:
      typeof snapshot.productionCostTableVersionCode === "string"
        ? snapshot.productionCostTableVersionCode
        : null,
    revision: decTrace(snapshot.revision),
    effectiveDate:
      typeof snapshot.effectiveDate === "string" ? snapshot.effectiveDate : null,
    productionCostTableItemId:
      typeof snapshot.productionCostTableItemId === "string"
        ? snapshot.productionCostTableItemId
        : null,
    unitProductionCost: decTrace(snapshot.unitProductionCost),
    breakdown:
      snapshot.breakdown != null && typeof snapshot.breakdown === "object"
        ? (snapshot.breakdown as Record<string, unknown>)
        : null,
  };
}

export function readFormulaSnapshotFields(snapshot: Record<string, unknown> | null | undefined) {
  const rates =
    snapshot?.rates != null && typeof snapshot.rates === "object"
      ? (snapshot.rates as Record<string, unknown>)
      : {};
  const taxRate = decTrace(rates.taxRate);
  const commissionRate = decTrace(rates.commissionRate);
  const otherRate = decTrace(rates.otherRate);
  const marginPct = decTrace(snapshot?.marginPct);
  const freight = decTrace(snapshot?.freight);
  return {
    taxRuleId: typeof snapshot?.taxRuleId === "string" ? snapshot.taxRuleId : null,
    productionCostTableVersionId:
      typeof snapshot?.productionCostTableVersionId === "string"
        ? snapshot.productionCostTableVersionId
        : null,
    productionCostTableVersionCode:
      typeof snapshot?.productionCostTableVersionCode === "string"
        ? snapshot.productionCostTableVersionCode
        : null,
    productionCostRevision: decTrace(snapshot?.productionCostRevision),
    taxRate,
    commissionRate,
    otherRate,
    marginPct,
    freight,
    taxPercent: taxRate != null ? taxRate * 100 : null,
    commissionPercent: commissionRate != null ? commissionRate * 100 : null,
    otherPercent: otherRate != null ? otherRate * 100 : null,
  };
}

export function computePublishedMarkup(salePrice: number | null, industrialCost: number | null): number | null {
  if (salePrice == null || industrialCost == null || industrialCost <= 0) return null;
  return Math.round((salePrice / industrialCost) * 1_000_000) / 1_000_000;
}

export function deriveOtherVariablesAmount(input: {
  frozenOtherCost: number | null;
  freight: number | null;
  commissionValue: number | null;
  salePrice: number | null;
  otherRate: number | null;
}): number | null {
  if (input.salePrice != null && input.otherRate != null && input.otherRate > 0) {
    return Math.round(input.salePrice * input.otherRate * 1_000_000) / 1_000_000;
  }
  if (input.frozenOtherCost == null) return null;
  const freight = input.freight ?? 0;
  const commission = input.commissionValue ?? 0;
  const derived = input.frozenOtherCost - freight - commission;
  return derived > 0 ? derived : 0;
}
