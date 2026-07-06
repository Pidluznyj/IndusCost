/**
 * Enquadramento de comissão por faixa da Formação de Preço (Atacado / Varejo 1–3).
 * Percentual interpolado linearmente entre faixas adjacentes (não degrau seco).
 */
import { roundMoney } from "./commission-money.js";
import {
  OUT_OF_TABLE_COMMISSION_PERCENT,
  OUT_OF_TABLE_TIER_CODE,
  OUT_OF_TABLE_TIER_LABEL,
} from "./commissionOutOfTable.js";

export const COMMERCIAL_PRICE_TIER_CODES = [
  "ATACADO",
  "VAREJO_1",
  "VAREJO_2",
  "VAREJO_3",
] as const;

export const COMMERCIAL_PRICE_TIER_INTERPOLATED = "COMMERCIAL_PRICE_TIER_INTERPOLATED" as const;

export type CommercialPriceTierCode = (typeof COMMERCIAL_PRICE_TIER_CODES)[number];

export type CommercialPriceTierCodeResolved =
  | CommercialPriceTierCode
  | typeof OUT_OF_TABLE_TIER_CODE;

export type CommercialPriceTierRow = {
  code: CommercialPriceTierCode;
  name: string;
  salePrice: number;
  commissionPercent: number;
};

export type CommercialTierInterpolation = {
  fromTierCode: CommercialPriceTierCode;
  fromTierName: string;
  toTierCode: CommercialPriceTierCode;
  toTierName: string;
  fromSalePrice: number;
  toSalePrice: number;
  fromRatePercent: number;
  toRatePercent: number;
  interpolationProgress: number;
  interpolatedRatePercent: number;
};

export type ResolveCommercialTierSuccess = {
  ok: true;
  tierCode: CommercialPriceTierCodeResolved;
  tierName: string;
  referenceSalePrice: number;
  ratePercent: number;
  soldUnitPrice: number;
  tiersUsed: CommercialPriceTierRow[];
  calculationType:
    | typeof COMMERCIAL_PRICE_TIER_INTERPOLATED
    | "COMMERCIAL_PRICE_TIER";
  interpolation?: CommercialTierInterpolation;
  ceilingTier?: boolean;
  outOfTablePrice?: boolean;
  warningCode?: "OUT_OF_TABLE_PRICE_COMMISSION";
  atacadoPrice?: number;
  differenceAmount?: number;
  differencePercent?: number;
  nextTierCode?: CommercialPriceTierCode;
  nextTierName?: string;
};

export type ResolveCommercialTierErrorCode =
  | "NO_COMMERCIAL_PRICE_TABLE"
  | "INVALID_COMMERCIAL_PRICE_RANGE"
  | "NO_COMMISSION_TABLE_RATE";

export type ResolveCommercialTierFailure = {
  ok: false;
  code: ResolveCommercialTierErrorCode;
  message: string;
  soldUnitPrice: number;
  tiers?: CommercialPriceTierRow[];
};

export type ResolveCommercialTierResult =
  | ResolveCommercialTierSuccess
  | ResolveCommercialTierFailure;

/** Precisão auditável para percentual interpolado (4 casas decimais). */
export function roundRatePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

export function resolveSoldUnitNetPrice(input: {
  quantity: number;
  itemNetAmount: number;
  unitPrice: number;
}): number {
  if (input.quantity > 0) {
    return roundMoney(input.itemNetAmount / input.quantity);
  }
  return roundMoney(input.unitPrice);
}

function isValidTierPrice(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidCommissionPercent(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** Valida ordem crescente estrita: Atacado < Varejo 1 < Varejo 2 < Varejo 3. */
export function validateCommercialTierPriceOrder(
  tiers: CommercialPriceTierRow[]
): boolean {
  if (tiers.length !== COMMERCIAL_PRICE_TIER_CODES.length) return false;
  for (let i = 0; i < tiers.length; i += 1) {
    if (tiers[i]?.code !== COMMERCIAL_PRICE_TIER_CODES[i]) return false;
    if (!isValidTierPrice(tiers[i]!.salePrice)) return false;
  }
  for (let i = 1; i < tiers.length; i += 1) {
    if (tiers[i]!.salePrice <= tiers[i - 1]!.salePrice) return false;
  }
  return true;
}

/**
 * Interpola percentual entre duas faixas adjacentes.
 * progress = (sold - fromPrice) / (toPrice - fromPrice)
 * rate = fromRate + progress * (toRate - fromRate)
 */
export function interpolateCommercialTierRate(input: {
  soldUnitPrice: number;
  fromTier: CommercialPriceTierRow;
  toTier: CommercialPriceTierRow;
}): { progress: number; ratePercent: number } {
  const fromPrice = input.fromTier.salePrice;
  const toPrice = input.toTier.salePrice;
  const fromRate = input.fromTier.commissionPercent;
  const toRate = input.toTier.commissionPercent;

  if (toPrice <= fromPrice) {
    return { progress: 0, ratePercent: roundRatePercent(fromRate) };
  }

  const rawProgress = (input.soldUnitPrice - fromPrice) / (toPrice - fromPrice);
  const progress = Math.max(0, Math.min(1, rawProgress));
  const rawRate = fromRate + progress * (toRate - fromRate);
  const clampedRate = Math.max(Math.min(fromRate, toRate), Math.min(Math.max(fromRate, toRate), rawRate));

  return {
    progress: Math.round(progress * 1000000) / 1000000,
    ratePercent: roundRatePercent(clampedRate),
  };
}

function buildInterpolationFields(
  fromTier: CommercialPriceTierRow,
  toTier: CommercialPriceTierRow,
  soldUnitPrice: number
): { interpolation: CommercialTierInterpolation; ratePercent: number } {
  const { progress, ratePercent } = interpolateCommercialTierRate({
    soldUnitPrice,
    fromTier,
    toTier,
  });
  return {
    ratePercent,
    interpolation: {
      fromTierCode: fromTier.code,
      fromTierName: fromTier.name,
      toTierCode: toTier.code,
      toTierName: toTier.name,
      fromSalePrice: fromTier.salePrice,
      toSalePrice: toTier.salePrice,
      fromRatePercent: fromTier.commissionPercent,
      toRatePercent: toTier.commissionPercent,
      interpolationProgress: progress,
      interpolatedRatePercent: ratePercent,
    },
  };
}

function successBase(
  tiers: CommercialPriceTierRow[],
  soldUnitPrice: number,
  partial: Omit<ResolveCommercialTierSuccess, "ok" | "soldUnitPrice" | "tiersUsed">
): ResolveCommercialTierSuccess {
  return {
    ok: true,
    soldUnitPrice,
    tiersUsed: tiers,
    ...partial,
  };
}

/**
 * Enquadra preço unitário vendido com comissão proporcional entre faixas.
 */
export function resolveCommercialPriceTier(input: {
  soldUnitPrice: number;
  tiers: CommercialPriceTierRow[];
}): ResolveCommercialTierResult {
  const soldUnitPrice = roundMoney(input.soldUnitPrice);
  const ordered = COMMERCIAL_PRICE_TIER_CODES.map((code) =>
    input.tiers.find((t) => t.code === code)
  );

  if (ordered.some((t) => !t)) {
    return {
      ok: false,
      code: "NO_COMMERCIAL_PRICE_TABLE",
      message: "Produto vendido sem tabela comercial gerada para todas as faixas.",
      soldUnitPrice,
      tiers: input.tiers,
    };
  }

  const tiers = ordered as CommercialPriceTierRow[];

  if (!validateCommercialTierPriceOrder(tiers)) {
    return {
      ok: false,
      code: "INVALID_COMMERCIAL_PRICE_RANGE",
      message:
        "Tabelas comerciais inconsistentes (preços devem crescer: Atacado < Varejo 1 < Varejo 2 < Varejo 3).",
      soldUnitPrice,
      tiers,
    };
  }

  const [atacado, varejo1, varejo2, varejo3] = tiers;

  for (const tier of tiers) {
    if (!isValidCommissionPercent(tier.commissionPercent)) {
      return {
        ok: false,
        code: "NO_COMMISSION_TABLE_RATE",
        message: `Tabela comercial ${tier.name} sem percentual de comissão configurado.`,
        soldUnitPrice,
        tiers,
      };
    }
  }

  if (soldUnitPrice < atacado.salePrice) {
    const differenceAmount = roundMoney(atacado.salePrice - soldUnitPrice);
    const differencePercent =
      atacado.salePrice > 0
        ? roundMoney((differenceAmount / atacado.salePrice) * 100)
        : 0;
    return successBase(tiers, soldUnitPrice, {
      tierCode: OUT_OF_TABLE_TIER_CODE,
      tierName: OUT_OF_TABLE_TIER_LABEL,
      referenceSalePrice: atacado.salePrice,
      ratePercent: OUT_OF_TABLE_COMMISSION_PERCENT,
      calculationType: "COMMERCIAL_PRICE_TIER",
      outOfTablePrice: true,
      warningCode: "OUT_OF_TABLE_PRICE_COMMISSION",
      atacadoPrice: atacado.salePrice,
      differenceAmount,
      differencePercent,
      nextTierCode: "ATACADO",
      nextTierName: atacado.name,
    });
  }

  if (soldUnitPrice >= varejo3.salePrice) {
    return successBase(tiers, soldUnitPrice, {
      tierCode: "VAREJO_3",
      tierName: varejo3.name,
      referenceSalePrice: varejo3.salePrice,
      ratePercent: roundRatePercent(varejo3.commissionPercent),
      calculationType: "COMMERCIAL_PRICE_TIER",
      ceilingTier: true,
    });
  }

  if (soldUnitPrice >= varejo2.salePrice) {
    const { interpolation, ratePercent } = buildInterpolationFields(
      varejo2,
      varejo3,
      soldUnitPrice
    );
    return successBase(tiers, soldUnitPrice, {
      tierCode: varejo2.code,
      tierName: varejo2.name,
      referenceSalePrice: varejo2.salePrice,
      ratePercent,
      calculationType: COMMERCIAL_PRICE_TIER_INTERPOLATED,
      interpolation,
      nextTierCode: varejo3.code,
      nextTierName: varejo3.name,
    });
  }

  if (soldUnitPrice >= varejo1.salePrice) {
    const { interpolation, ratePercent } = buildInterpolationFields(
      varejo1,
      varejo2,
      soldUnitPrice
    );
    return successBase(tiers, soldUnitPrice, {
      tierCode: varejo1.code,
      tierName: varejo1.name,
      referenceSalePrice: varejo1.salePrice,
      ratePercent,
      calculationType: COMMERCIAL_PRICE_TIER_INTERPOLATED,
      interpolation,
      nextTierCode: varejo2.code,
      nextTierName: varejo2.name,
    });
  }

  const { interpolation, ratePercent } = buildInterpolationFields(
    atacado,
    varejo1,
    soldUnitPrice
  );
  return successBase(tiers, soldUnitPrice, {
    tierCode: atacado.code,
    tierName: atacado.name,
    referenceSalePrice: atacado.salePrice,
    ratePercent,
    calculationType: COMMERCIAL_PRICE_TIER_INTERPOLATED,
    interpolation,
    nextTierCode: varejo1.code,
    nextTierName: varejo1.name,
  });
}

export function commercialTierAuditMessage(code: ResolveCommercialTierErrorCode): string {
  switch (code) {
    case "NO_COMMERCIAL_PRICE_TABLE":
      return "Produto vendido sem tabela comercial gerada.";
    case "INVALID_COMMERCIAL_PRICE_RANGE":
      return "Tabelas comerciais inconsistentes para o produto.";
    case "NO_COMMISSION_TABLE_RATE":
      return "Tabela comercial encontrada, mas sem percentual de comissão.";
    default:
      return code;
  }
}

/** Reconstrói faixas comerciais a partir de metadataJson.tiersCompared (recálculo/preview). */
export function commercialTiersFromMetadata(metadataJson: unknown): CommercialPriceTierRow[] | null {
  if (!metadataJson || typeof metadataJson !== "object") return null;
  const meta = metadataJson as Record<string, unknown>;
  const raw = meta.tiersCompared;
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const tiers: CommercialPriceTierRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const code = row.code;
    if (
      typeof code !== "string" ||
      !COMMERCIAL_PRICE_TIER_CODES.includes(code as CommercialPriceTierCode)
    ) {
      continue;
    }
    tiers.push({
      code: code as CommercialPriceTierCode,
      name: typeof row.name === "string" ? row.name : code,
      salePrice: Number(row.salePrice),
      commissionPercent: Number(row.commissionPercent),
    });
  }

  if (tiers.length !== COMMERCIAL_PRICE_TIER_CODES.length) return null;
  return tiers;
}

export function buildCommercialTierMetadata(tierResult: ResolveCommercialTierSuccess): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    calculationType: tierResult.calculationType,
    tierCode: tierResult.tierCode,
    tierName: tierResult.tierName,
    referenceSalePrice: tierResult.referenceSalePrice,
    soldUnitPrice: tierResult.soldUnitPrice,
    tiersCompared: tierResult.tiersUsed.map((t) => ({
      code: t.code,
      name: t.name,
      salePrice: t.salePrice,
      commissionPercent: t.commissionPercent,
    })),
  };

  if (tierResult.nextTierCode) metadata.nextTierCode = tierResult.nextTierCode;
  if (tierResult.nextTierName) metadata.nextTierName = tierResult.nextTierName;
  if (tierResult.ceilingTier) metadata.ceilingTier = true;

  if (tierResult.interpolation) {
    const i = tierResult.interpolation;
    metadata.fromTierCode = i.fromTierCode;
    metadata.fromTierName = i.fromTierName;
    metadata.nextTierCode = i.toTierCode;
    metadata.nextTierName = i.toTierName;
    metadata.fromSalePrice = i.fromSalePrice;
    metadata.toSalePrice = i.toSalePrice;
    metadata.fromRatePercent = i.fromRatePercent;
    metadata.toRatePercent = i.toRatePercent;
    metadata.interpolationProgress = i.interpolationProgress;
    metadata.interpolatedRatePercent = i.interpolatedRatePercent;
  }

  if (tierResult.outOfTablePrice) {
    metadata.outOfTablePrice = true;
    metadata.warningCode = tierResult.warningCode;
    metadata.atacadoPrice = tierResult.atacadoPrice;
    metadata.differenceAmount = tierResult.differenceAmount;
    metadata.differencePercent = tierResult.differencePercent;
    metadata.appliedCommissionPercent = tierResult.ratePercent;
    metadata.appliedTier = tierResult.tierCode;
  }

  return metadata;
}
