/**
 * Núcleo matemático neutro — Margem comercial.
 *
 * Puro: sem Prisma, Express, React, Nomus, SalesOrder ou Proposal.
 * Reutilizável por Pedido, Proposta e documentos futuros.
 *
 * Taxas (`*Rate`) são frações (0.03 = 3%), salvo onde o nome diga Percent.
 * Ordenação de faixas: sempre por salePrice ascendente (não confiar na ordem recebida).
 */
import { roundPricingMoney } from "./pricingCalculations.js";

/** Faixa comercial genérica — quantidade e margens variáveis. */
export type CommercialMarginTier = {
  id: string;
  /** Margem-alvo da faixa (fração, ex.: 0.33). Pode ser decimal. */
  marginRate: number;
  salePrice: number;
  /** Comissão da faixa (fração, ex.: 0.02). */
  commissionRate: number;
  /** Ordem opcional de apresentação; não define ordenação econômica. */
  order?: number;
};

/**
 * Normaliza comissão para fração.
 * `commissionPerc` nas tabelas é percentual (1 = 1%, 6 = 6%).
 * Heurística antiga `> 1 ? /100 : keep` tratava 1% como 100% — margem profundamente negativa.
 * Valores já em fração (< 1) permanecem; percentuais (>= 1) dividem por 100.
 */
export function normalizeCommercialCommissionRateFraction(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return rate;
  return rate >= 1 ? rate / 100 : rate;
}

export type CommercialPricePositionKind =
  | "EXACT_TIER"
  | "BETWEEN_TIERS"
  | "BELOW_LOWEST"
  | "ABOVE_HIGHEST";

export type CommercialPricePosition = {
  position: CommercialPricePositionKind;
  lowerTier?: CommercialMarginTier;
  upperTier?: CommercialMarginTier;
  exactTier?: CommercialMarginTier;
  /** Progresso em [0, 1] quando BETWEEN_TIERS (ou EXACT no limite). */
  progress?: number;
};

export type ValidateCommercialMarginTiersFailure = {
  ok: false;
  code:
    | "EMPTY_TIERS"
    | "MIN_TIERS"
    | "INVALID_TIER_ID"
    | "INVALID_MARGIN_RATE"
    | "INVALID_SALE_PRICE"
    | "INVALID_COMMISSION_RATE"
    | "DUPLICATE_SALE_PRICE"
    | "NON_FINITE";
  message: string;
};

export type ValidateCommercialMarginTiersSuccess = {
  ok: true;
  /** Faixas ordenadas por salePrice ascendente. */
  tiers: CommercialMarginTier[];
};

export type ValidateCommercialMarginTiersResult =
  | ValidateCommercialMarginTiersSuccess
  | ValidateCommercialMarginTiersFailure;

/** Epsilon relativo/absoluto para igualdade de preço de faixa (antes de arredondar comissão). */
const PRICE_MATCH_EPS = 1e-9;

function toFinite(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function nearlyEqualPrice(a: number, b: number): boolean {
  return Math.abs(a - b) <= PRICE_MATCH_EPS * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * Valida e ordena faixas por salePrice ascendente.
 * Mínimo: 2 faixas. Não assume ATACADO/VAREJO nem 30/40/50/60.
 */
export function validateAndSortCommercialMarginTiers(
  tiersInput: ReadonlyArray<CommercialMarginTier>,
  options?: { minTiers?: number }
): ValidateCommercialMarginTiersResult {
  const minTiers = options?.minTiers ?? 2;
  if (!Array.isArray(tiersInput) || tiersInput.length === 0) {
    return { ok: false, code: "EMPTY_TIERS", message: "Conjunto de faixas vazio." };
  }
  if (tiersInput.length < minTiers) {
    return {
      ok: false,
      code: "MIN_TIERS",
      message: `São necessárias pelo menos ${minTiers} faixas comerciais.`,
    };
  }

  const normalized: CommercialMarginTier[] = [];
  for (const raw of tiersInput) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, code: "NON_FINITE", message: "Faixa comercial inválida." };
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      return { ok: false, code: "INVALID_TIER_ID", message: "Faixa sem id." };
    }
    const marginRate = toFinite(raw.marginRate);
    const salePrice = toFinite(raw.salePrice);
    const commissionRate = toFinite(raw.commissionRate);
    if (marginRate == null || !Number.isFinite(marginRate)) {
      return {
        ok: false,
        code: "INVALID_MARGIN_RATE",
        message: `Margem inválida na faixa ${id}.`,
      };
    }
    // Margem pode ser negativa (preço agressivo); não pode ser NaN/∞.
    if (salePrice == null || !(salePrice > 0)) {
      return {
        ok: false,
        code: "INVALID_SALE_PRICE",
        message: `Preço de faixa inválido em ${id}.`,
      };
    }
    if (commissionRate == null || commissionRate < 0 || !Number.isFinite(commissionRate)) {
      return {
        ok: false,
        code: "INVALID_COMMISSION_RATE",
        message: `Comissão inválida na faixa ${id}.`,
      };
    }
    const order = raw.order != null ? toFinite(raw.order) : null;
    normalized.push({
      id,
      marginRate,
      salePrice,
      // 1% legado/sujo como `1` (em vez de 0.01) virava 100% na margem.
      commissionRate: normalizeCommercialCommissionRateFraction(commissionRate),
      ...(order != null ? { order } : {}),
    });
  }

  const sorted = [...normalized].sort((a, b) => a.salePrice - b.salePrice);
  for (let i = 1; i < sorted.length; i += 1) {
    if (nearlyEqualPrice(sorted[i]!.salePrice, sorted[i - 1]!.salePrice)) {
      return {
        ok: false,
        code: "DUPLICATE_SALE_PRICE",
        message: "Preços de faixa duplicados — ordenação comercial ambígua.",
      };
    }
    if (!(sorted[i]!.salePrice > sorted[i - 1]!.salePrice)) {
      return {
        ok: false,
        code: "DUPLICATE_SALE_PRICE",
        message: "Preços de faixa devem ser estritamente crescentes após ordenação.",
      };
    }
  }

  return { ok: true, tiers: sorted };
}

/**
 * Localiza o preço líquido unitário nas faixas (ordenadas internamente).
 * Não interpola margem — apenas posição e progress para comissão.
 */
export function resolveCommercialPricePosition(input: {
  netUnitPrice: number;
  tiers: ReadonlyArray<CommercialMarginTier>;
}):
  | { ok: true; result: CommercialPricePosition; tiers: CommercialMarginTier[] }
  | ValidateCommercialMarginTiersFailure {
  const netUnitPrice = toFinite(input.netUnitPrice);
  if (netUnitPrice == null || !(netUnitPrice > 0)) {
    return {
      ok: false,
      code: "NON_FINITE",
      message: "Preço unitário líquido inválido.",
    };
  }

  const validated = validateAndSortCommercialMarginTiers(input.tiers);
  if (!validated.ok) return validated;
  const tiers = validated.tiers;
  const lowest = tiers[0]!;
  const highest = tiers[tiers.length - 1]!;

  if (netUnitPrice < lowest.salePrice && !nearlyEqualPrice(netUnitPrice, lowest.salePrice)) {
    return {
      ok: true,
      tiers,
      result: {
        position: "BELOW_LOWEST",
        lowerTier: undefined,
        upperTier: lowest,
      },
    };
  }

  if (netUnitPrice > highest.salePrice || nearlyEqualPrice(netUnitPrice, highest.salePrice)) {
    if (nearlyEqualPrice(netUnitPrice, highest.salePrice) || netUnitPrice > highest.salePrice) {
      // Igual ao teto ou acima → ABOVE_HIGHEST usa teto; igual exato também EXACT.
      if (nearlyEqualPrice(netUnitPrice, highest.salePrice)) {
        return {
          ok: true,
          tiers,
          result: {
            position: "EXACT_TIER",
            exactTier: highest,
            lowerTier: highest,
            upperTier: highest,
            progress: 1,
          },
        };
      }
      return {
        ok: true,
        tiers,
        result: {
          position: "ABOVE_HIGHEST",
          lowerTier: highest,
          upperTier: undefined,
          progress: 1,
        },
      };
    }
  }

  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i]!;
    if (nearlyEqualPrice(netUnitPrice, tier.salePrice)) {
      return {
        ok: true,
        tiers,
        result: {
          position: "EXACT_TIER",
          exactTier: tier,
          lowerTier: tier,
          upperTier: i + 1 < tiers.length ? tiers[i + 1] : tier,
          progress: 0,
        },
      };
    }
  }

  for (let i = 0; i < tiers.length - 1; i += 1) {
    const lower = tiers[i]!;
    const upper = tiers[i + 1]!;
    if (netUnitPrice > lower.salePrice && netUnitPrice < upper.salePrice) {
      const span = upper.salePrice - lower.salePrice;
      const rawProgress = span > 0 ? (netUnitPrice - lower.salePrice) / span : 0;
      const progress = Math.max(0, Math.min(1, rawProgress));
      return {
        ok: true,
        tiers,
        result: {
          position: "BETWEEN_TIERS",
          lowerTier: lower,
          upperTier: upper,
          progress,
        },
      };
    }
  }

  // Fallback defensivo (não deveria ocorrer após validação).
  return {
    ok: true,
    tiers,
    result: {
      position: "ABOVE_HIGHEST",
      lowerTier: highest,
    },
  };
}

/**
 * Comissão proporcional entre faixas adjacentes (nunca interpola margem).
 * progress e rate em fração; arredondamento de % só no retorno opcional percent.
 */
export function interpolateCommercialCommissionRate(input: {
  netUnitPrice: number;
  lowerTier: CommercialMarginTier;
  upperTier: CommercialMarginTier;
}): { progress: number; commissionRate: number } {
  const fromPrice = input.lowerTier.salePrice;
  const toPrice = input.upperTier.salePrice;
  const fromRate = input.lowerTier.commissionRate;
  const toRate = input.upperTier.commissionRate;

  if (!(toPrice > fromPrice)) {
    return { progress: 0, commissionRate: fromRate };
  }

  const rawProgress = (input.netUnitPrice - fromPrice) / (toPrice - fromPrice);
  const progress = Math.max(0, Math.min(1, rawProgress));
  const rawRate = fromRate + progress * (toRate - fromRate);
  const lo = Math.min(fromRate, toRate);
  const hi = Math.max(fromRate, toRate);
  const clampedRate = Math.max(lo, Math.min(hi, rawRate));

  return {
    progress: Math.round(progress * 1_000_000) / 1_000_000,
    commissionRate: clampedRate,
  };
}

export type ResolveCommercialCommissionFromTiersSuccess = {
  ok: true;
  position: CommercialPricePosition;
  tiers: CommercialMarginTier[];
  /** Comissão resolvida (fração). Null se BELOW sem política. */
  commissionRate: number | null;
  /** true quando aplicou teto da maior faixa. */
  ceilingTier: boolean;
  /** true quando abaixo da menor e usou belowLowestCommissionRate. */
  belowLowest: boolean;
};

/**
 * Resolve comissão a partir da posição do preço nas faixas.
 * - EXACT / BETWEEN: comissão da faixa ou interpolada
 * - ABOVE_HIGHEST: teto = comissão da maior faixa
 * - BELOW_LOWEST: usa `belowLowestCommissionRate` se informado; senão null
 */
export function resolveCommercialCommissionFromTiers(input: {
  netUnitPrice: number;
  tiers: ReadonlyArray<CommercialMarginTier>;
  /** Política opcional abaixo da menor faixa (fração). */
  belowLowestCommissionRate?: number | null;
}): ResolveCommercialCommissionFromTiersSuccess | ValidateCommercialMarginTiersFailure {
  const positioned = resolveCommercialPricePosition({
    netUnitPrice: input.netUnitPrice,
    tiers: input.tiers,
  });
  if (!positioned.ok) return positioned;

  const { result: position, tiers } = positioned;

  if (position.position === "BELOW_LOWEST") {
    const policy = input.belowLowestCommissionRate;
    const rate =
      policy != null && Number.isFinite(policy) && policy >= 0 ? Number(policy) : null;
    return {
      ok: true,
      position,
      tiers,
      commissionRate: rate,
      ceilingTier: false,
      belowLowest: true,
    };
  }

  if (position.position === "ABOVE_HIGHEST") {
    const highest = tiers[tiers.length - 1]!;
    return {
      ok: true,
      position,
      tiers,
      commissionRate: highest.commissionRate,
      ceilingTier: true,
      belowLowest: false,
    };
  }

  if (position.position === "EXACT_TIER" && position.exactTier) {
    return {
      ok: true,
      position,
      tiers,
      commissionRate: position.exactTier.commissionRate,
      ceilingTier: position.exactTier.id === tiers[tiers.length - 1]!.id,
      belowLowest: false,
    };
  }

  if (
    position.position === "BETWEEN_TIERS" &&
    position.lowerTier &&
    position.upperTier
  ) {
    const { progress, commissionRate } = interpolateCommercialCommissionRate({
      netUnitPrice: Number(input.netUnitPrice),
      lowerTier: position.lowerTier,
      upperTier: position.upperTier,
    });
    return {
      ok: true,
      position: { ...position, progress },
      tiers,
      commissionRate,
      ceilingTier: false,
      belowLowest: false,
    };
  }

  return {
    ok: true,
    position,
    tiers,
    commissionRate: null,
    ceilingTier: false,
    belowLowest: false,
  };
}

export type CalculateCommercialMarginFromNetUnitPriceInput = {
  netUnitPrice: number;
  quantity: number;
  frozenCostUnit: number;
  taxRate: number;
  commissionRate: number;
  freightRate: number;
  freightAbsoluteUnit: number;
  otherVariablesRate: number;
};

export type CalculateCommercialMarginFromNetUnitPriceSuccess = {
  ok: true;
  commercialMarginRate: number;
  commercialMarginPercent: number;
  commercialMarginUnitValue: number;
  commercialMarginValue: number;
  costValue: number;
  taxValue: number;
  commissionValue: number;
  freightRateValue: number;
  freightAbsoluteValue: number;
  otherVariablesValue: number;
  /** Componentes unitários (compatível com inversa legada). */
  taxValueUnit: number;
  commissionValueUnit: number;
  otherValueUnit: number;
  freightRateValueUnit: number;
  freightAbsoluteUnit: number;
  costUnit: number;
};

export type CalculateCommercialMarginFromNetUnitPriceResult =
  | CalculateCommercialMarginFromNetUnitPriceSuccess
  | { ok: false; code: string; message: string };

/**
 * Fórmula inversa canônica:
 *   m = 1 − i − c − o − f% − (custo + freteR$) / PV_líquido
 *
 * Não arredonda antes do cálculo da taxa. Valores monetários saem com
 * roundPricingMoney; % com roundPricingPercent no campo percent.
 */
export function calculateCommercialMarginFromNetUnitPrice(
  input: CalculateCommercialMarginFromNetUnitPriceInput
): CalculateCommercialMarginFromNetUnitPriceResult {
  const netUnitPrice = toFinite(input.netUnitPrice);
  const quantity = toFinite(input.quantity);
  const cost = toFinite(input.frozenCostUnit);
  const taxRate = toFinite(input.taxRate);
  const commissionRate = toFinite(input.commissionRate);
  const freightRate = toFinite(input.freightRate) ?? 0;
  const freightAbs = toFinite(input.freightAbsoluteUnit) ?? 0;
  const otherRate = toFinite(input.otherVariablesRate);

  if (netUnitPrice == null || !(netUnitPrice > 0)) {
    return { ok: false, code: "INVALID_PRICE", message: "Preço unitário líquido inválido." };
  }
  if (quantity == null || !(quantity >= 0) || !Number.isFinite(quantity)) {
    return { ok: false, code: "INVALID_QUANTITY", message: "Quantidade inválida." };
  }
  if (cost == null || cost < 0) {
    return { ok: false, code: "INVALID_COST", message: "Custo de formação inválido." };
  }
  if (
    taxRate == null ||
    commissionRate == null ||
    otherRate == null ||
    taxRate < 0 ||
    commissionRate < 0 ||
    otherRate < 0 ||
    freightRate < 0 ||
    freightAbs < 0
  ) {
    return {
      ok: false,
      code: "INVALID_PRICING_RATE",
      message: "Percentuais/valores de formação inválidos.",
    };
  }

  const commercialMarginRate =
    1 -
    taxRate -
    commissionRate -
    otherRate -
    freightRate -
    (cost + freightAbs) / netUnitPrice;

  if (!Number.isFinite(commercialMarginRate)) {
    return {
      ok: false,
      code: "INVALID_MARGIN_RESULT",
      message: "Margem comercial calculada inválida.",
    };
  }

  const taxValueUnit = netUnitPrice * taxRate;
  const commissionValueUnit = netUnitPrice * commissionRate;
  const otherValueUnit = netUnitPrice * otherRate;
  const freightRateValueUnit = netUnitPrice * freightRate;
  const commercialMarginUnitValue = netUnitPrice * commercialMarginRate;

  return {
    ok: true,
    commercialMarginRate,
    // Percentual bruto (fração×100) — sem arredondar; consumidores aplicam roundPricingPercent.
    commercialMarginPercent: commercialMarginRate * 100,
    // Valor unitário bruto — compatível com a inversa legada do Pedido.
    commercialMarginUnitValue,
    commercialMarginValue: roundPricingMoney(quantity * commercialMarginUnitValue),
    costValue: roundPricingMoney(quantity * cost),
    taxValue: roundPricingMoney(quantity * taxValueUnit),
    commissionValue: roundPricingMoney(quantity * commissionValueUnit),
    freightRateValue: roundPricingMoney(quantity * freightRateValueUnit),
    freightAbsoluteValue: roundPricingMoney(quantity * freightAbs),
    otherVariablesValue: roundPricingMoney(quantity * otherValueUnit),
    taxValueUnit,
    commissionValueUnit,
    otherValueUnit,
    freightRateValueUnit,
    freightAbsoluteUnit: freightAbs,
    costUnit: cost,
  };
}

/**
 * Identidade direta/inversa (núcleo):
 * PV = (custo + freteR$) / (1 − i − c − o − f% − m)
 * Depois a inversa recupera m.
 */
export function calculateSalePriceFromCommercialMarginRates(input: {
  frozenCostUnit: number;
  taxRate: number;
  commissionRate: number;
  freightRate: number;
  freightAbsoluteUnit: number;
  otherVariablesRate: number;
  marginRate: number;
}): { ok: true; salePrice: number; divisor: number } | { ok: false; code: string; message: string } {
  const cost = toFinite(input.frozenCostUnit);
  const taxRate = toFinite(input.taxRate);
  const commissionRate = toFinite(input.commissionRate);
  const freightRate = toFinite(input.freightRate) ?? 0;
  const freightAbs = toFinite(input.freightAbsoluteUnit) ?? 0;
  const otherRate = toFinite(input.otherVariablesRate);
  const marginRate = toFinite(input.marginRate);

  if (cost == null || !(cost > 0)) {
    return { ok: false, code: "NO_COST_AVAILABLE", message: "Custo inválido." };
  }
  if (
    taxRate == null ||
    commissionRate == null ||
    otherRate == null ||
    marginRate == null ||
    taxRate < 0 ||
    commissionRate < 0 ||
    otherRate < 0 ||
    marginRate < 0 ||
    freightRate < 0 ||
    freightAbs < 0
  ) {
    return { ok: false, code: "INVALID_PRICING_RATE", message: "Taxas inválidas." };
  }

  const divisor =
    1 - taxRate - commissionRate - otherRate - freightRate - marginRate;
  if (divisor <= 0) {
    return {
      ok: false,
      code: "INVALID_PRICING_DIVISOR",
      message: "Soma de taxas/margem >= 100%.",
    };
  }
  const salePrice = (cost + freightAbs) / divisor;
  if (!Number.isFinite(salePrice) || !(salePrice > 0)) {
    return { ok: false, code: "INVALID_PRICE_RESULT", message: "Preço inválido." };
  }
  return { ok: true, salePrice, divisor };
}
