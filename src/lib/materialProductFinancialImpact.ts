/**
 * Impacto financeiro de variação de preço de matéria-prima nos produtos que a consomem (BOM direta).
 * Cálculo puro — não persiste custos, preços ou margens oficiais.
 */
import { calculatePriceTableItemFromFrozenCost } from "./priceTablePublication.js";
import {
  sortMaterialMarketQuotesChronologically as sortQuotesForFinancialImpact,
  type MaterialMarketQuoteSourceRow,
} from "./materialMarketQuote.js";
import { roundPricingPercent } from "./pricingCalculations.js";

export const MATERIAL_MARKET_SIMULATION_DISCLAIMER =
  "Simulação temporária — não altera dados oficiais";

export const MATERIAL_MARKET_SIMULATION_CRITICAL_MARGIN_PERCENT = 5;

export type MaterialProductPricingRates = {
  taxRate: number;
  commissionRate: number;
  otherRate: number;
  marginRate: number;
  freight: number;
};

export type MaterialProductBomUsageInput = {
  productId: string;
  sku: string;
  name: string;
  bomLineId: string;
  bomQuantity: number;
  lossPercentage: number;
  costAnalysis: {
    totalIndustrialCost: number;
    materialLineCost: number | null;
  };
  pricingRates: MaterialProductPricingRates | null;
};

export type MaterialProductFinancialImpactInput = {
  materialId: string;
  currentMaterialPriceBRL: number;
  simulatedMaterialPriceBRL: number;
  products: MaterialProductBomUsageInput[];
  criticalMarginPercent?: number;
};

export type MaterialProductImpactDto = {
  productId: string;
  sku: string;
  name: string;
  bomLineId: string;
  materialConsumptionPerUnit: number;
  previousMaterialLineCost: number;
  simulatedMaterialLineCost: number;
  previousIndustrialCost: number;
  simulatedIndustrialCost: number;
  industrialCostDelta: number;
  salePrice: number | null;
  previousMarginPercent: number | null;
  simulatedMarginPercent: number | null;
  marginDeltaPercent: number | null;
  desiredMarginPercent: number | null;
  isCritical: boolean;
  criticalReason: string | null;
};

export type MaterialProductMarginSummary = {
  impactedProductCount: number;
  avgPreviousMargin: number | null;
  avgSimulatedMargin: number | null;
  avgMarginDelta: number | null;
  criticalProductCount: number;
};

export type MaterialProductFinancialImpactResult = {
  productImpacts: MaterialProductImpactDto[];
  criticalProducts: MaterialProductImpactDto[];
  marginSummary: MaterialProductMarginSummary;
};

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeRequiredMaterialQuantity(
  bomQuantity: number,
  lossPercentage: number
): number {
  const qty = Number(bomQuantity);
  const loss = Number(lossPercentage) / 100;
  if (!Number.isFinite(qty) || qty < 0) return 0;
  if (loss >= 1) return qty;
  return qty / (1 - loss);
}

export function computeMarginPercentFromFixedSalePrice(
  salePrice: number,
  industrialCost: number
): number | null {
  if (!Number.isFinite(salePrice) || salePrice <= 0) return null;
  if (!Number.isFinite(industrialCost)) return null;
  return roundPercent(((salePrice - industrialCost) / salePrice) * 100);
}

export function resolveSalePriceFromIndustrialCost(
  industrialCost: number,
  rates: MaterialProductPricingRates | null
): number | null {
  if (!rates) return null;
  const result = calculatePriceTableItemFromFrozenCost(industrialCost, {
    taxRate: rates.taxRate,
    commissionRate: rates.commissionRate,
    otherRate: rates.otherRate,
    marginRate: rates.marginRate,
    freight: rates.freight,
  });
  if (!result.ok) return null;
  return roundMoney(result.result.salePrice);
}

export function resolveMaterialLineCostForSimulation(input: {
  materialLineCostFromAnalysis: number | null;
  materialConsumptionPerUnit: number;
  materialPriceBRL: number;
}): number {
  if (
    input.materialLineCostFromAnalysis != null &&
    Number.isFinite(input.materialLineCostFromAnalysis) &&
    input.materialLineCostFromAnalysis >= 0
  ) {
    return roundMoney(input.materialLineCostFromAnalysis);
  }
  return roundMoney(input.materialConsumptionPerUnit * input.materialPriceBRL);
}

export function computeSingleProductFinancialImpact(input: {
  product: MaterialProductBomUsageInput;
  currentMaterialPriceBRL: number;
  simulatedMaterialPriceBRL: number;
  criticalMarginPercent: number;
}): MaterialProductImpactDto | null {
  const { product, currentMaterialPriceBRL, simulatedMaterialPriceBRL, criticalMarginPercent } =
    input;

  const previousIndustrialCost = roundMoney(product.costAnalysis.totalIndustrialCost);
  if (!Number.isFinite(previousIndustrialCost) || previousIndustrialCost <= 0) {
    return null;
  }

  const materialConsumptionPerUnit = roundMoney(
    computeRequiredMaterialQuantity(product.bomQuantity, product.lossPercentage)
  );

  const previousMaterialLineCost = resolveMaterialLineCostForSimulation({
    materialLineCostFromAnalysis: product.costAnalysis.materialLineCost,
    materialConsumptionPerUnit,
    materialPriceBRL: currentMaterialPriceBRL,
  });

  let simulatedMaterialLineCost: number;
  if (previousMaterialLineCost > 0 && currentMaterialPriceBRL > 0) {
    const ratio = simulatedMaterialPriceBRL / currentMaterialPriceBRL;
    simulatedMaterialLineCost = roundMoney(previousMaterialLineCost * ratio);
  } else {
    simulatedMaterialLineCost = resolveMaterialLineCostForSimulation({
      materialLineCostFromAnalysis: null,
      materialConsumptionPerUnit,
      materialPriceBRL: simulatedMaterialPriceBRL,
    });
  }

  const industrialCostDelta = roundMoney(simulatedMaterialLineCost - previousMaterialLineCost);
  const simulatedIndustrialCost = roundMoney(previousIndustrialCost + industrialCostDelta);

  const salePrice =
    resolveSalePriceFromIndustrialCost(previousIndustrialCost, product.pricingRates) ??
    null;

  const previousMarginPercent =
    salePrice != null
      ? computeMarginPercentFromFixedSalePrice(salePrice, previousIndustrialCost)
      : null;
  const simulatedMarginPercent =
    salePrice != null
      ? computeMarginPercentFromFixedSalePrice(salePrice, simulatedIndustrialCost)
      : null;
  const marginDeltaPercent =
    previousMarginPercent != null && simulatedMarginPercent != null
      ? roundPercent(simulatedMarginPercent - previousMarginPercent)
      : null;

  const desiredMarginPercent =
    product.pricingRates != null ? roundPercent(product.pricingRates.marginRate * 100) : null;

  let isCritical = false;
  let criticalReason: string | null = null;

  if (simulatedMarginPercent != null && simulatedMarginPercent < 0) {
    isCritical = true;
    criticalReason = "Margem simulada negativa";
  } else if (
    simulatedMarginPercent != null &&
    simulatedMarginPercent < criticalMarginPercent
  ) {
    isCritical = true;
    criticalReason = `Margem simulada abaixo de ${criticalMarginPercent}%`;
  } else if (
    desiredMarginPercent != null &&
    simulatedMarginPercent != null &&
    simulatedMarginPercent < desiredMarginPercent
  ) {
    isCritical = true;
    criticalReason = "Margem simulada abaixo da margem desejada";
  } else if (marginDeltaPercent != null && marginDeltaPercent <= -2) {
    isCritical = true;
    criticalReason = "Perda relevante de margem na simulação";
  }

  return {
    productId: product.productId,
    sku: product.sku,
    name: product.name,
    bomLineId: product.bomLineId,
    materialConsumptionPerUnit,
    previousMaterialLineCost,
    simulatedMaterialLineCost,
    previousIndustrialCost,
    simulatedIndustrialCost,
    industrialCostDelta,
    salePrice,
    previousMarginPercent,
    simulatedMarginPercent,
    marginDeltaPercent,
    desiredMarginPercent,
    isCritical,
    criticalReason,
  };
}

export function computeMaterialProductFinancialImpacts(
  input: MaterialProductFinancialImpactInput
): MaterialProductFinancialImpactResult {
  const criticalMarginPercent =
    input.criticalMarginPercent ?? MATERIAL_MARKET_SIMULATION_CRITICAL_MARGIN_PERCENT;

  const productImpacts = input.products
    .map((product) =>
      computeSingleProductFinancialImpact({
        product,
        currentMaterialPriceBRL: input.currentMaterialPriceBRL,
        simulatedMaterialPriceBRL: input.simulatedMaterialPriceBRL,
        criticalMarginPercent,
      })
    )
    .filter((row): row is MaterialProductImpactDto => row != null)
    .sort((a, b) => {
      const aDelta = a.marginDeltaPercent ?? a.industrialCostDelta;
      const bDelta = b.marginDeltaPercent ?? b.industrialCostDelta;
      return aDelta - bDelta;
    });

  const criticalProducts = productImpacts.filter((row) => row.isCritical);

  const marginsWithValues = productImpacts.filter(
    (row) => row.previousMarginPercent != null && row.simulatedMarginPercent != null
  );

  const avg = (values: number[]) =>
    values.length > 0 ? roundPercent(values.reduce((acc, v) => acc + v, 0) / values.length) : null;

  const marginSummary: MaterialProductMarginSummary = {
    impactedProductCount: productImpacts.length,
    avgPreviousMargin: avg(
      marginsWithValues.map((row) => row.previousMarginPercent as number)
    ),
    avgSimulatedMargin: avg(
      marginsWithValues.map((row) => row.simulatedMarginPercent as number)
    ),
    avgMarginDelta: avg(
      marginsWithValues
        .map((row) => row.marginDeltaPercent)
        .filter((v): v is number => v != null)
    ),
    criticalProductCount: criticalProducts.length,
  };

  return {
    productImpacts,
    criticalProducts,
    marginSummary,
  };
}

export function sumMaterialLineCostFromAnalysis(
  materials:
    | Array<{
        materialId?: string | null;
        bomLineId?: string | null;
        unitCost?: number | null;
        excludedFromCost?: boolean;
      }>
    | undefined,
  materialId: string,
  bomLineId?: string | null
): number | null {
  if (!materials?.length) return null;

  const rows = materials.filter((row) => {
    if (row.excludedFromCost) return false;
    if (bomLineId && row.bomLineId === bomLineId) return true;
    return row.materialId === materialId;
  });

  if (rows.length === 0) return null;

  const total = rows.reduce((acc, row) => acc + Number(row.unitCost ?? 0), 0);
  return Number.isFinite(total) ? roundMoney(total) : null;
}

// --- API 360º: impacto financeiro com preço comercial publicado ---

export const MATERIAL_FINANCIAL_IMPACT_DISCLAIMER =
  "Simulação — não altera custo padrão nem tabela comercial";

export const MATERIAL_FINANCIAL_IMPACT_DEFAULT_MARGIN_THRESHOLD_PCT = 10;

export type MaterialFinancialImpactPriceSource = "currentCost" | "latestQuote" | "previousQuote" | "user";

export type MaterialProductFinancialImpactMissingData = {
  bom: boolean;
  sellingPrice: boolean;
  cost: boolean;
};

export type MaterialProductFinancialImpactProductRow = {
  productId: string;
  sku: string;
  productName: string;
  bomQuantity: number;
  previousCost: number | null;
  simulatedCost: number | null;
  costDifferenceBRL: number | null;
  costDifferencePct: number | null;
  sellingPrice: number | null;
  sellingPriceTableCode: string | null;
  previousMargin: number | null;
  simulatedMargin: number | null;
  targetMarginPct: number | null;
  marginLoss: boolean;
  reajusteNecessario: boolean;
  missingData: MaterialProductFinancialImpactMissingData;
  costError: string | null;
};

export type MaterialProductFinancialImpactResponse = {
  materialId: string;
  disclaimer: string;
  baselineMaterialPriceBRL: number | null;
  simulatedMaterialPriceBRL: number | null;
  baselinePriceSource: MaterialFinancialImpactPriceSource | null;
  simulatedPriceSource: MaterialFinancialImpactPriceSource | null;
  marginThresholdPct: number;
  impactedProductCount: number;
  marginLossCount: number;
  reajusteCount: number;
  items: MaterialProductFinancialImpactProductRow[];
};

export type MaterialFinancialImpactQuoteInput = {
  quoteDate: string | Date;
  netPrice: number | string | { toString(): string };
  currency?: string;
  status?: string;
};

const COMPARABLE_FINANCIAL_QUOTE_STATUSES = new Set(["ACTIVE", "DRAFT"]);

function isComparableFinancialQuote(quote: MaterialFinancialImpactQuoteInput): boolean {
  if (quote.currency && quote.currency.toUpperCase() !== "BRL") return false;
  const status = quote.status?.toUpperCase() ?? "ACTIVE";
  return COMPARABLE_FINANCIAL_QUOTE_STATUSES.has(status);
}

export function parseMaterialFinancialImpactPrice(
  value: unknown
): { ok: true; value: number } | { ok: false; message: string } {
  if (value == null || value === "") {
    return { ok: false, message: "Preço não informado." };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, message: "Preço inválido — informe um número maior ou igual a zero." };
  }
  return { ok: true, value: roundMoney(n) };
}

export function resolveDefaultMaterialSimulationPrices(input: {
  currentCost: number | string | { toString(): string };
  quotes: MaterialFinancialImpactQuoteInput[];
  baselineMaterialPriceBRL?: number | null;
  simulatedMaterialPriceBRL?: number | null;
}): {
  baselineMaterialPriceBRL: number | null;
  simulatedMaterialPriceBRL: number | null;
  baselinePriceSource: MaterialFinancialImpactPriceSource | null;
  simulatedPriceSource: MaterialFinancialImpactPriceSource | null;
} {
  if (input.baselineMaterialPriceBRL != null && input.simulatedMaterialPriceBRL != null) {
    return {
      baselineMaterialPriceBRL: roundMoney(input.baselineMaterialPriceBRL),
      simulatedMaterialPriceBRL: roundMoney(input.simulatedMaterialPriceBRL),
      baselinePriceSource: "user",
      simulatedPriceSource: "user",
    };
  }

  const official = Number(input.currentCost);
  const sorted = sortQuotesForFinancialImpact(
    input.quotes.map((q, index) => ({
      id: String(index),
      materialId: "",
      quoteDate: q.quoteDate,
      price: Number(q.netPrice),
      currency: q.currency ?? "BRL",
      unit: "",
      netPrice: q.netPrice,
      status: q.status ?? "ACTIVE",
      createdAt: q.quoteDate,
      updatedAt: q.quoteDate,
    })) as MaterialMarketQuoteSourceRow[]
  ).filter(isComparableFinancialQuote);

  const latest = sorted[0] ?? null;
  const previous = sorted.length > 1 ? sorted[1] : null;

  let baseline: number | null = null;
  let baselineSource: MaterialFinancialImpactPriceSource | null = null;
  if (input.baselineMaterialPriceBRL != null) {
    baseline = roundMoney(input.baselineMaterialPriceBRL);
    baselineSource = "user";
  } else if (Number.isFinite(official) && official > 0) {
    baseline = roundMoney(official);
    baselineSource = "currentCost";
  } else if (previous) {
    baseline = roundMoney(Number(previous.netPrice));
    baselineSource = "previousQuote";
  } else if (latest) {
    baseline = roundMoney(Number(latest.netPrice));
    baselineSource = "latestQuote";
  }

  let simulated: number | null = null;
  let simulatedSource: MaterialFinancialImpactPriceSource | null = null;
  if (input.simulatedMaterialPriceBRL != null) {
    simulated = roundMoney(input.simulatedMaterialPriceBRL);
    simulatedSource = "user";
  } else if (latest) {
    simulated = roundMoney(Number(latest.netPrice));
    simulatedSource = "latestQuote";
  } else if (Number.isFinite(official) && official > 0) {
    simulated = roundMoney(official);
    simulatedSource = "currentCost";
  }

  return {
    baselineMaterialPriceBRL: baseline,
    simulatedMaterialPriceBRL: simulated,
    baselinePriceSource: baselineSource,
    simulatedPriceSource: simulatedSource,
  };
}

export function computeCostDifference(
  previousCost: number | null,
  simulatedCost: number | null
): { costDifferenceBRL: number | null; costDifferencePct: number | null } {
  if (previousCost == null || simulatedCost == null) {
    return { costDifferenceBRL: null, costDifferencePct: null };
  }
  const costDifferenceBRL = roundMoney(simulatedCost - previousCost);
  const costDifferencePct =
    previousCost > 0 ? roundPricingPercent((costDifferenceBRL / previousCost) * 100) : null;
  return { costDifferenceBRL, costDifferencePct };
}

export function resolveReajusteNecessario(input: {
  simulatedMargin: number | null;
  targetMarginPct: number | null;
  defaultThresholdPct?: number;
}): boolean {
  if (input.simulatedMargin == null) return false;
  if (input.simulatedMargin < 0) return true;
  const threshold =
    input.targetMarginPct != null
      ? input.targetMarginPct
      : (input.defaultThresholdPct ?? MATERIAL_FINANCIAL_IMPACT_DEFAULT_MARGIN_THRESHOLD_PCT);
  return input.simulatedMargin < threshold;
}

export function mapProductImpactToFinancialImpactRow(input: {
  impact: MaterialProductImpactDto;
  bomQuantity: number;
  sellingPrice: number | null;
  sellingPriceTableCode: string | null;
  targetMarginPct: number | null;
}): MaterialProductFinancialImpactProductRow {
  const previousCost = roundMoney(input.impact.previousIndustrialCost);
  const simulatedCost = roundMoney(input.impact.simulatedIndustrialCost);
  const { costDifferenceBRL, costDifferencePct } = computeCostDifference(
    previousCost,
    simulatedCost
  );

  const previousMargin =
    input.sellingPrice != null
      ? computeMarginPercentFromFixedSalePrice(input.sellingPrice, previousCost)
      : null;
  const simulatedMargin =
    input.sellingPrice != null
      ? computeMarginPercentFromFixedSalePrice(input.sellingPrice, simulatedCost)
      : null;

  const marginLoss =
    previousMargin != null && simulatedMargin != null ? simulatedMargin < previousMargin : false;
  const reajusteNecessario = resolveReajusteNecessario({
    simulatedMargin,
    targetMarginPct: input.targetMarginPct,
  });

  return {
    productId: input.impact.productId,
    sku: input.impact.sku,
    productName: input.impact.name,
    bomQuantity: input.bomQuantity,
    previousCost,
    simulatedCost,
    costDifferenceBRL,
    costDifferencePct,
    sellingPrice: input.sellingPrice,
    sellingPriceTableCode: input.sellingPriceTableCode,
    previousMargin,
    simulatedMargin,
    targetMarginPct: input.targetMarginPct,
    marginLoss,
    reajusteNecessario,
    missingData: {
      bom: false,
      sellingPrice: input.sellingPrice == null,
      cost: previousCost <= 0 && simulatedCost <= 0,
    },
    costError: previousCost <= 0 ? "Custo do produto indisponível." : null,
  };
}

export function buildMaterialProductFinancialImpactResponse(input: {
  materialId: string;
  prices: {
    baselineMaterialPriceBRL: number | null;
    simulatedMaterialPriceBRL: number | null;
    baselinePriceSource: MaterialFinancialImpactPriceSource | null;
    simulatedPriceSource: MaterialFinancialImpactPriceSource | null;
  };
  rows: MaterialProductFinancialImpactProductRow[];
}): MaterialProductFinancialImpactResponse {
  const sorted = [...input.rows].sort((a, b) => {
    if (a.marginLoss !== b.marginLoss) return a.marginLoss ? -1 : 1;
    if (a.reajusteNecessario !== b.reajusteNecessario) return a.reajusteNecessario ? -1 : 1;
    return a.sku.localeCompare(b.sku, "pt-BR");
  });

  return {
    materialId: input.materialId,
    disclaimer: MATERIAL_FINANCIAL_IMPACT_DISCLAIMER,
    baselineMaterialPriceBRL: input.prices.baselineMaterialPriceBRL,
    simulatedMaterialPriceBRL: input.prices.simulatedMaterialPriceBRL,
    baselinePriceSource: input.prices.baselinePriceSource,
    simulatedPriceSource: input.prices.simulatedPriceSource,
    marginThresholdPct: MATERIAL_FINANCIAL_IMPACT_DEFAULT_MARGIN_THRESHOLD_PCT,
    impactedProductCount: sorted.length,
    marginLossCount: sorted.filter((row) => row.marginLoss).length,
    reajusteCount: sorted.filter((row) => row.reajusteNecessario).length,
    items: sorted,
  };
}

export type MaterialFinancialImpactImpactedProduct = {
  productId: string;
  sku: string;
  productName: string;
  bomQuantity: number;
};

export type MaterialFinancialImpactSellingPriceResult = {
  salePrice: number | null;
  tableCode: string | null;
  targetMarginPct: number | null;
};

export type MaterialFinancialImpactDeps = {
  findImpactedProducts: (
    materialId: string
  ) => Promise<MaterialFinancialImpactImpactedProduct[]>;
  evaluateProductCost: (
    productId: string,
    materialPriceBRL: number | null
  ) => Promise<{ cost: number | null; error: string | null }>;
  resolveSellingPrice: (
    productId: string
  ) => Promise<MaterialFinancialImpactSellingPriceResult>;
};

export function computeMarginPercent(
  salePrice: number,
  industrialCost: number
): number | null {
  return computeMarginPercentFromFixedSalePrice(salePrice, industrialCost);
}

export function buildMaterialProductFinancialImpactRow(input: {
  product: MaterialFinancialImpactImpactedProduct;
  previousCost: number | null;
  simulatedCost: number | null;
  sellingPrice: number | null;
  sellingPriceTableCode: string | null;
  targetMarginPct: number | null;
  costError: string | null;
}): MaterialProductFinancialImpactProductRow {
  const { costDifferenceBRL, costDifferencePct } = computeCostDifference(
    input.previousCost,
    input.simulatedCost
  );

  const previousMargin =
    input.sellingPrice != null && input.previousCost != null
      ? computeMarginPercent(input.sellingPrice, input.previousCost)
      : null;
  const simulatedMargin =
    input.sellingPrice != null && input.simulatedCost != null
      ? computeMarginPercent(input.sellingPrice, input.simulatedCost)
      : null;

  const marginLoss =
    previousMargin != null && simulatedMargin != null
      ? simulatedMargin < previousMargin
      : false;
  const reajusteNecessario = resolveReajusteNecessario({
    simulatedMargin,
    targetMarginPct: input.targetMarginPct,
  });

  return {
    productId: input.product.productId,
    sku: input.product.sku,
    productName: input.product.productName,
    bomQuantity: input.product.bomQuantity,
    previousCost: input.previousCost,
    simulatedCost: input.simulatedCost,
    costDifferenceBRL,
    costDifferencePct,
    sellingPrice: input.sellingPrice,
    sellingPriceTableCode: input.sellingPriceTableCode,
    previousMargin,
    simulatedMargin,
    targetMarginPct: input.targetMarginPct,
    marginLoss,
    reajusteNecessario,
    missingData: {
      bom: false,
      sellingPrice: input.sellingPrice == null,
      cost: input.previousCost == null && input.simulatedCost == null,
    },
    costError: input.costError,
  };
}

export async function buildMaterialProductFinancialImpact(
  materialId: string,
  prices: {
    baselineMaterialPriceBRL: number | null;
    simulatedMaterialPriceBRL: number | null;
    baselinePriceSource: MaterialFinancialImpactPriceSource | null;
    simulatedPriceSource: MaterialFinancialImpactPriceSource | null;
  },
  deps: MaterialFinancialImpactDeps
): Promise<MaterialProductFinancialImpactResponse> {
  const products = await deps.findImpactedProducts(materialId);
  const rows: MaterialProductFinancialImpactProductRow[] = [];

  for (const product of products) {
    const previousEval = await deps.evaluateProductCost(
      product.productId,
      prices.baselineMaterialPriceBRL
    );
    const simulatedEval = await deps.evaluateProductCost(
      product.productId,
      prices.simulatedMaterialPriceBRL
    );
    const selling = await deps.resolveSellingPrice(product.productId);

    rows.push(
      buildMaterialProductFinancialImpactRow({
        product,
        previousCost: previousEval.cost,
        simulatedCost: simulatedEval.cost,
        sellingPrice: selling.salePrice,
        sellingPriceTableCode: selling.tableCode,
        targetMarginPct: selling.targetMarginPct,
        costError: previousEval.error ?? simulatedEval.error,
      })
    );
  }

  return buildMaterialProductFinancialImpactResponse({
    materialId,
    prices,
    rows,
  });
}

export function buildMaterialPriceOverrideCatalog(
  material: {
    id: string;
    code: string;
    unit: string;
    freight: unknown;
    standardLoss: unknown;
  },
  materialPriceBRL: number
): import("./materialCostEngineResolver.js").MaterialCostEngineCatalog {
  const freight = Number(material.freight ?? 0);
  const landedCost = roundMoney(materialPriceBRL);
  const currentCost = roundMoney(Math.max(0, landedCost - freight));
  const standardLoss =
    material.standardLoss != null ? Number(material.standardLoss) : null;

  return {
    materialCostTableVersionId: "simulation-override",
    materialCostTableVersionCode: "SIMULATION",
    revision: 0,
    effectiveDate: new Date().toISOString().slice(0, 10),
    officialProductionDraft: false,
    itemsByMaterialId: new Map([
      [
        material.id,
        {
          materialId: material.id,
          materialCode: material.code,
          currentCostSnapshot: currentCost,
          freightSnapshot: freight,
          landedCostSnapshot: landedCost,
          standardLossSnapshot:
            standardLoss != null && Number.isFinite(standardLoss) ? standardLoss : null,
          unitSnapshot: material.unit,
          costSource: "LIVE_MATERIAL",
        },
      ],
    ]),
  };
}
