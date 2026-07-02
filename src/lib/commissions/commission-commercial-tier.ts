/**
 * Enquadramento de comissão por faixa da Formação de Preço (Atacado / Varejo 1–3).
 * Lógica pura — percentuais e preços vêm de PriceTableItem publicado, nunca hardcoded.
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

export type ResolveCommercialTierSuccess = {
  ok: true;
  tierCode: CommercialPriceTierCodeResolved;
  tierName: string;
  referenceSalePrice: number;
  ratePercent: number;
  soldUnitPrice: number;
  tiersUsed: CommercialPriceTierRow[];
  outOfTablePrice?: boolean;
  warningCode?: "OUT_OF_TABLE_PRICE_COMMISSION";
  atacadoPrice?: number;
  differenceAmount?: number;
  differencePercent?: number;
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
 * Enquadra preço unitário vendido nas faixas comerciais publicadas.
 *
 * Regras:
 * - [Atacado, Varejo 1) → Atacado
 * - [Varejo 1, Varejo 2) → Varejo 1
 * - [Varejo 2, Varejo 3) → Varejo 2
 * - >= Varejo 3 → Varejo 3
 * - < Atacado → comissão mínima ({@link OUT_OF_TABLE_COMMISSION_PERCENT}%) com alerta
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

  if (soldUnitPrice < atacado.salePrice) {
    const differenceAmount = roundMoney(atacado.salePrice - soldUnitPrice);
    const differencePercent =
      atacado.salePrice > 0
        ? roundMoney((differenceAmount / atacado.salePrice) * 100)
        : 0;
    return {
      ok: true,
      tierCode: OUT_OF_TABLE_TIER_CODE,
      tierName: OUT_OF_TABLE_TIER_LABEL,
      referenceSalePrice: atacado.salePrice,
      ratePercent: OUT_OF_TABLE_COMMISSION_PERCENT,
      soldUnitPrice,
      tiersUsed: tiers,
      outOfTablePrice: true,
      warningCode: "OUT_OF_TABLE_PRICE_COMMISSION",
      atacadoPrice: atacado.salePrice,
      differenceAmount,
      differencePercent,
    };
  }

  let matched: CommercialPriceTierRow;
  if (soldUnitPrice >= varejo3.salePrice) {
    matched = varejo3;
  } else if (soldUnitPrice >= varejo2.salePrice) {
    matched = varejo2;
  } else if (soldUnitPrice >= varejo1.salePrice) {
    matched = varejo1;
  } else {
    matched = atacado;
  }

  if (!isValidCommissionPercent(matched.commissionPercent)) {
    return {
      ok: false,
      code: "NO_COMMISSION_TABLE_RATE",
      message: `Tabela comercial ${matched.name} sem percentual de comissão configurado.`,
      soldUnitPrice,
      tiers,
    };
  }

  return {
    ok: true,
    tierCode: matched.code,
    tierName: matched.name,
    referenceSalePrice: matched.salePrice,
    ratePercent: matched.commissionPercent,
    soldUnitPrice,
    tiersUsed: tiers,
  };
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
