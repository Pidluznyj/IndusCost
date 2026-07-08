/**
 * Simulação what-if de preço de matéria-prima — cálculo stateless (sem persistência).
 */
import {
  MATERIAL_FINANCIAL_IMPACT_DISCLAIMER,
  type MaterialProductFinancialImpactProductRow,
  type MaterialProductFinancialImpactResponse,
} from "./materialProductFinancialImpact.js";
import {
  buildMaterialSimulationComparison,
  type MaterialSimulationComparison,
} from "./materialMarketSimulationComparison.js";
import { computeMaterialQuotePriceBRL } from "./materialMarketPriceHistory.js";
import {
  sortMaterialMarketQuotesChronologically,
  type MaterialMarketQuoteSourceRow,
} from "./materialMarketQuote.js";

export const MATERIAL_MARKET_SIMULATION_DISCLAIMER =
  "Simulação temporária — não altera dados oficiais";

export const MATERIAL_MARKET_SIMULATION_MODES = [
  "PCT_INCREASE",
  "PCT_DECREASE",
  "MANUAL_PRICE",
  "MANUAL_USD",
  "MANUAL_BRENT",
] as const;

export type MaterialMarketSimulationMode = (typeof MATERIAL_MARKET_SIMULATION_MODES)[number];

export type MaterialMarketSimulationRequest = {
  mode: MaterialMarketSimulationMode;
  value: number;
  manualUsd?: number | null;
  manualBrent?: number | null;
};

export type MaterialMarketSimulationProductImpact = {
  productId: string;
  sku: string;
  productName: string;
  bomQuantity: number;
  previousCost: number | null;
  simulatedCost: number | null;
  costDifferenceBRL: number | null;
  costDifferencePct: number | null;
  sellingPrice: number | null;
  previousMargin: number | null;
  simulatedMargin: number | null;
  marginDelta: number | null;
  isCritical: boolean;
  criticalReason: string | null;
};

export type MaterialMarketSimulationMarginSummary = {
  impactedProductCount: number;
  avgPreviousMargin: number | null;
  avgSimulatedMargin: number | null;
  avgMarginDelta: number | null;
  criticalProductCount: number;
  marginLossCount: number;
  reajusteCount: number;
};

export type MaterialMarketSimulationResponse = {
  currentPrice: number;
  simulatedPrice: number;
  simulationLabel: string;
  brentContextNote: string | null;
  comparison: MaterialSimulationComparison;
  productImpacts: MaterialMarketSimulationProductImpact[];
  criticalProducts: MaterialMarketSimulationProductImpact[];
  marginSummary: MaterialMarketSimulationMarginSummary;
  disclaimer: string;
};

export type { MaterialSimulationComparison };

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

function toNumber(value: number | string | { toString(): string }): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function resolveLatestComparableQuote(
  quotes: MaterialMarketQuoteSourceRow[]
): MaterialMarketQuoteSourceRow | null {
  const sorted = sortMaterialMarketQuotesChronologically(quotes);
  return sorted.find((q) => q.status !== "CANCELLED") ?? null;
}

export function resolveCurrentMaterialPriceBRL(input: {
  currentCost: number | string | { toString(): string };
  quotes: MaterialMarketQuoteSourceRow[];
  manualUsd?: number | null;
}): number | null {
  const official = toNumber(input.currentCost);
  const latest = resolveLatestComparableQuote(input.quotes);

  let baseBrl: number | null = null;

  if (latest) {
    const currency = latest.currency.trim().toUpperCase();
    const netPrice = toNumber(latest.netPrice);
    if (currency === "USD" && input.manualUsd != null && input.manualUsd > 0) {
      baseBrl = roundMoney(netPrice * input.manualUsd);
    } else if (latest.netPriceBrl != null && Number.isFinite(Number(latest.netPriceBrl))) {
      baseBrl = roundMoney(toNumber(latest.netPriceBrl));
    } else {
      const converted = computeMaterialQuotePriceBRL({
        netPrice,
        currency,
        exchangeRateUsed:
          latest.ptaxVenda != null ? toNumber(latest.ptaxVenda) : null,
      });
      baseBrl = roundMoney(converted.priceBRL);
    }
  }

  if (official > 0) {
    return roundMoney(official);
  }

  return baseBrl;
}

export function resolveSimulatedMaterialPriceBRL(input: {
  mode: MaterialMarketSimulationMode;
  value: number;
  currentPriceBRL: number;
  quotes: MaterialMarketQuoteSourceRow[];
  manualUsd?: number | null;
}): { price: number; label: string } {
  const { mode, value, currentPriceBRL, quotes, manualUsd } = input;

  let basePrice = currentPriceBRL;

  if (manualUsd != null && manualUsd > 0) {
    const latest = resolveLatestComparableQuote(quotes);
    if (latest?.currency.trim().toUpperCase() === "USD") {
      basePrice = roundMoney(toNumber(latest.netPrice) * manualUsd);
    }
  }

  switch (mode) {
    case "PCT_INCREASE":
      return {
        price: roundMoney(basePrice * (1 + value / 100)),
        label: `Aumento de ${value}%`,
      };
    case "PCT_DECREASE":
      return {
        price: roundMoney(basePrice * (1 - value / 100)),
        label: `Redução de ${value}%`,
      };
    case "MANUAL_PRICE":
      return {
        price: roundMoney(value),
        label: "Preço manual (BRL)",
      };
    case "MANUAL_USD": {
      const latest = resolveLatestComparableQuote(quotes);
      if (latest?.currency.trim().toUpperCase() === "USD" && value > 0) {
        return {
          price: roundMoney(toNumber(latest.netPrice) * value),
          label: `Dólar manual: ${value}`,
        };
      }
      return {
        price: roundMoney(basePrice),
        label: "Dólar manual (sem cotação USD — preço base mantido)",
      };
    }
    case "MANUAL_BRENT":
      return {
        price: roundMoney(basePrice),
        label: `Brent informado: ${value} (contextual — sem correlação automática)`,
      };
    default:
      return {
        price: roundMoney(basePrice),
        label: "Simulação",
      };
  }
}

export function parseMaterialMarketSimulationRequest(
  body: unknown
):
  | { ok: true; value: MaterialMarketSimulationRequest }
  | { ok: false; message: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, message: "Corpo da requisição inválido." };
  }

  const raw = body as Record<string, unknown>;
  const mode = typeof raw.mode === "string" ? raw.mode.trim().toUpperCase() : "";
  if (!(MATERIAL_MARKET_SIMULATION_MODES as readonly string[]).includes(mode)) {
    return { ok: false, message: "Modo de simulação inválido." };
  }

  const value = toNumber(raw.value);
  if (!Number.isFinite(value)) {
    return { ok: false, message: "Valor numérico inválido." };
  }

  if (mode === "PCT_INCREASE" || mode === "PCT_DECREASE") {
    if (value < 0 || value > 1000) {
      return { ok: false, message: "Percentual deve estar entre 0 e 1000." };
    }
  }

  if (mode === "MANUAL_PRICE" && value < 0) {
    return { ok: false, message: "Preço manual deve ser não negativo." };
  }

  const manualUsd =
    raw.manualUsd == null || raw.manualUsd === "" ? null : toNumber(raw.manualUsd);
  const manualBrent =
    raw.manualBrent == null || raw.manualBrent === "" ? null : toNumber(raw.manualBrent);

  if (manualUsd != null && manualUsd <= 0) {
    return { ok: false, message: "Câmbio manual deve ser maior que zero." };
  }

  return {
    ok: true,
    value: {
      mode: mode as MaterialMarketSimulationMode,
      value,
      manualUsd,
      manualBrent,
    },
  };
}

function mapFinancialRowToSimulationImpact(
  row: MaterialProductFinancialImpactProductRow
): MaterialMarketSimulationProductImpact {
  const marginDelta =
    row.previousMargin != null && row.simulatedMargin != null
      ? roundPercent(row.simulatedMargin - row.previousMargin)
      : null;

  let criticalReason: string | null = null;
  if (row.reajusteNecessario) {
    criticalReason = "Reajuste necessário";
  } else if (row.marginLoss) {
    criticalReason = "Perda de margem";
  }

  return {
    productId: row.productId,
    sku: row.sku,
    productName: row.productName,
    bomQuantity: row.bomQuantity,
    previousCost: row.previousCost,
    simulatedCost: row.simulatedCost,
    costDifferenceBRL: row.costDifferenceBRL,
    costDifferencePct: row.costDifferencePct,
    sellingPrice: row.sellingPrice,
    previousMargin: row.previousMargin,
    simulatedMargin: row.simulatedMargin,
    marginDelta,
    isCritical: row.reajusteNecessario || row.marginLoss,
    criticalReason,
  };
}

function buildMarginSummary(
  productImpacts: MaterialMarketSimulationProductImpact[],
  financial: MaterialProductFinancialImpactResponse
): MaterialMarketSimulationMarginSummary {
  const withMargins = productImpacts.filter(
    (row) => row.previousMargin != null && row.simulatedMargin != null
  );
  const avg = (values: number[]) =>
    values.length > 0 ? roundPercent(values.reduce((acc, v) => acc + v, 0) / values.length) : null;

  return {
    impactedProductCount: productImpacts.length,
    avgPreviousMargin: avg(withMargins.map((row) => row.previousMargin as number)),
    avgSimulatedMargin: avg(withMargins.map((row) => row.simulatedMargin as number)),
    avgMarginDelta: avg(
      withMargins
        .map((row) => row.marginDelta)
        .filter((v): v is number => v != null)
    ),
    criticalProductCount: productImpacts.filter((row) => row.isCritical).length,
    marginLossCount: financial.marginLossCount,
    reajusteCount: financial.reajusteCount,
  };
}

export function buildMaterialMarketSimulationResponse(input: {
  currentPrice: number;
  simulatedPrice: number;
  simulationLabel: string;
  brentContextNote: string | null;
  financial: MaterialProductFinancialImpactResponse;
}): MaterialMarketSimulationResponse {
  const productImpacts = input.financial.items.map(mapFinancialRowToSimulationImpact);
  const criticalProducts = productImpacts.filter((row) => row.isCritical);
  const marginSummary = buildMarginSummary(productImpacts, input.financial);

  return {
    currentPrice: input.currentPrice,
    simulatedPrice: input.simulatedPrice,
    simulationLabel: input.simulationLabel,
    brentContextNote: input.brentContextNote,
    comparison: buildMaterialSimulationComparison({
      currentPrice: input.currentPrice,
      simulatedPrice: input.simulatedPrice,
      productImpacts,
      marginSummary,
      financial: input.financial,
    }),
    productImpacts,
    criticalProducts,
    marginSummary,
    disclaimer: MATERIAL_MARKET_SIMULATION_DISCLAIMER,
  };
}

export function mapProductPricingRates(input: {
  desiredMargin?: unknown;
  commission?: unknown;
  freightOut?: unknown;
  otherVariables?: unknown;
  TaxRule?: { TaxComponent?: Array<{ percentage?: unknown }> } | null;
}): import("./materialProductFinancialImpact.js").MaterialProductPricingRates | null {
  const marginPct = toNumber(input.desiredMargin ?? 0);
  const commissionPct = toNumber(input.commission ?? 0);
  const otherPct = toNumber(input.otherVariables ?? 0);
  const freight = toNumber(input.freightOut ?? 0);
  const taxPct = (input.TaxRule?.TaxComponent ?? []).reduce(
    (acc, component) => acc + toNumber(component.percentage ?? 0),
    0
  );

  if (marginPct <= 0 && taxPct <= 0) return null;

  return {
    taxRate: taxPct / 100,
    commissionRate: commissionPct / 100,
    otherRate: otherPct / 100,
    marginRate: marginPct / 100,
    freight,
  };
}
