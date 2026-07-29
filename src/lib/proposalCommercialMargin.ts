/**
 * Motor de domínio — Margem comercial da Proposta.
 *
 * Independente do Pedido de Venda.
 * Importa apenas: núcleo matemático neutro, tipos neutros, domínio próprio da Proposta.
 */
import {
  calculateCommercialMarginFromNetUnitPrice,
  normalizeCommercialCommissionRateFraction,
  resolveCommercialCommissionFromTiers,
  validateAndSortCommercialMarginTiers,
  type CommercialMarginTier,
  type CommercialPricePositionKind,
} from "./commercialMarginCore.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import { resolveProposalItemCommercialValues } from "./proposalItemCommercialValues.js";

/** Comissão mínima fora da tabela (mesma política de `OUT_OF_TABLE_COMMISSION_PERCENT`). */
const PROPOSAL_OUT_OF_TABLE_COMMISSION_PERCENT = 1;

export type ProposalCommercialMarginSource =
  | "PROPOSAL_PRICE_FORMATION"
  | "UNAVAILABLE";

export type ProposalCommercialMarginReasonCode =
  | "PRODUCT_WITHOUT_PRICE_FORMATION"
  | "PRICE_TABLE_NOT_SELECTED"
  | "PRICE_TABLE_VERSION_NOT_FOUND"
  | "HISTORICAL_FORMATION_NOT_FOUND"
  | "HISTORICAL_FORMATION_AMBIGUOUS"
  | "INCOMPLETE_MARGIN_TIERS"
  | "COST_NOT_FOUND"
  | "TAX_NOT_FOUND"
  | "FREIGHT_NOT_DEFINED"
  | "COMMISSION_NOT_DEFINED"
  | "OTHER_VARIABLES_NOT_DEFINED"
  | "FINAL_NET_PRICE_NOT_FOUND"
  | "INVALID_FINAL_NET_PRICE"
  | "INVALID_QUANTITY"
  | "INCONSISTENT_PRICE_FORMATION_SET";

export const PROPOSAL_COMMERCIAL_MARGIN_REASON_LABEL: Record<
  ProposalCommercialMarginReasonCode,
  string
> = {
  PRODUCT_WITHOUT_PRICE_FORMATION: "Produto sem formação de preço cadastrada.",
  PRICE_TABLE_NOT_SELECTED: "Tabela de preço não selecionada na Proposta.",
  PRICE_TABLE_VERSION_NOT_FOUND: "Versão da tabela de preço não encontrada.",
  HISTORICAL_FORMATION_NOT_FOUND:
    "Não encontramos formação de preço válida para a data da Proposta.",
  HISTORICAL_FORMATION_AMBIGUOUS:
    "Existem duas formações possíveis para essa data.",
  INCOMPLETE_MARGIN_TIERS: "A formação de preço está incompleta (faixas).",
  COST_NOT_FOUND: "Não encontramos custo válido para a formação.",
  TAX_NOT_FOUND: "Não encontramos o imposto da formação de preço.",
  FREIGHT_NOT_DEFINED: "O frete da formação de preço não está definido.",
  COMMISSION_NOT_DEFINED: "Não encontramos a regra de comissão.",
  OTHER_VARIABLES_NOT_DEFINED:
    "As outras variáveis da formação de preço não estão definidas.",
  FINAL_NET_PRICE_NOT_FOUND: "Não encontramos o preço líquido final do item.",
  INVALID_FINAL_NET_PRICE: "O preço líquido final do item é inválido.",
  INVALID_QUANTITY: "Quantidade do item inválida.",
  INCONSISTENT_PRICE_FORMATION_SET:
    "As faixas comerciais da formação estão inconsistentes.",
};

export type ProposalCommercialMarginItemPayload = {
  quantity: number;
  referenceTableUnitPrice: number | null;
  negotiatedGrossUnitPrice: number | null;
  finalNetUnitPrice: number | null;
  finalNetLineValue: number | null;

  manualPriceReduction: number | null;
  explicitDiscount: number | null;
  totalCommercialConcession: number | null;

  costUnit: number | null;
  costValue: number | null;
  taxRate: number | null;
  taxValue: number | null;
  freightRate: number | null;
  freightRateValue: number | null;
  freightAbsoluteUnit: number | null;
  freightAbsoluteValue: number | null;
  otherVariablesRate: number | null;
  otherVariablesValue: number | null;
  commissionRate: number | null;
  commissionValue: number | null;

  lowerTier: CommercialMarginTier | null;
  upperTier: CommercialMarginTier | null;
  exactTier: CommercialMarginTier | null;
  tierPosition: CommercialPricePositionKind | null;

  commercialMarginRate: number | null;
  commercialMarginPercent: number | null;
  commercialMarginUnitValue: number | null;
  commercialMarginValue: number | null;

  calculationSource: ProposalCommercialMarginSource;
  formationContextId: string | null;
  referenceDate: string | null;
  reasonCode: ProposalCommercialMarginReasonCode | null;
  warnings: string[];
  isComplete: boolean;
};

export type ProposalCommercialMarginSummaryPayload = {
  proposalCommercialMarginTotalValue: number | null;
  proposalCommercialMarginTotalPercent: number | null;
  proposalCalculatedNetValue: number;
  proposalTotalNetValue: number;
  proposalMarginCoveragePercent: number | null;
  itemsCalculated: number;
  itemsUnavailable: number;
  itemsActive: number;
  isComplete: boolean;
  reasonCodes: ProposalCommercialMarginReasonCode[];
  warnings: string[];
};

export type CalculateProposalItemCommercialMarginInput = {
  quantity: number;

  referenceTableUnitPrice?: number | null;
  negotiatedGrossUnitPrice?: number | null;
  finalNetUnitPrice?: number | null;
  finalNetLineValue?: number | null;

  informedDiscountRate?: number | null;
  informedDiscountValue?: number | null;

  /**
   * Custo e taxas: ausência ≠ zero.
   * Passe `null`/`undefined` quando não definidos; `0` é zero explícito válido.
   */
  frozenCostUnit?: number | null;
  taxRate?: number | null;
  freightRate?: number | null;
  freightAbsoluteUnit?: number | null;
  otherVariablesRate?: number | null;

  /** Faixas dinâmicas (qualquer quantidade válida). */
  tiers?: ReadonlyArray<CommercialMarginTier> | null;

  /** Comissão já resolvida (opcional — senão deriva das faixas pelo líquido). */
  commissionRate?: number | null;

  formationContextId?: string | null;
  referenceDate?: string | null;

  /** Força reasonCode sem calcular (ex.: tabela não selecionada no adapter). */
  forceReasonCode?: ProposalCommercialMarginReasonCode | null;
  warnings?: string[];
};

/** Lê fração explícita: ausente ≠ zero. Aceita percentuais > 1 convertendo /100.
 * Atenção: valor exatamente `1` permanece 1.0 (=100%) — para comissão use
 * `normalizeCommercialCommissionRateFraction` (1 = 1%).
 */
export function readExplicitRate(
  value: unknown
): { present: true; value: number } | { present: false } {
  if (value == null || value === "") return { present: false };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return { present: false };
  return { present: true, value: n > 1 ? n / 100 : n };
}

/** Lê valor absoluto explícito (inclui 0). */
export function readExplicitAbsolute(
  value: unknown
): { present: true; value: number } | { present: false } {
  if (value == null || value === "") return { present: false };
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    if (!Number.isFinite(n) || n < 0) return { present: false };
    return { present: true, value: n };
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return { present: false };
  return { present: true, value: n };
}

export function unavailableProposalCommercialMarginItem(input: {
  quantity?: number;
  referenceTableUnitPrice?: number | null;
  negotiatedGrossUnitPrice?: number | null;
  finalNetUnitPrice?: number | null;
  finalNetLineValue?: number | null;
  manualPriceReduction?: number | null;
  explicitDiscount?: number | null;
  totalCommercialConcession?: number | null;
  formationContextId?: string | null;
  referenceDate?: string | null;
  reasonCode: ProposalCommercialMarginReasonCode;
  warnings?: string[];
}): ProposalCommercialMarginItemPayload {
  const reasonLabel = PROPOSAL_COMMERCIAL_MARGIN_REASON_LABEL[input.reasonCode];
  return {
    quantity: input.quantity ?? 0,
    referenceTableUnitPrice: input.referenceTableUnitPrice ?? null,
    negotiatedGrossUnitPrice: input.negotiatedGrossUnitPrice ?? null,
    finalNetUnitPrice: input.finalNetUnitPrice ?? null,
    finalNetLineValue: input.finalNetLineValue ?? null,
    manualPriceReduction: input.manualPriceReduction ?? null,
    explicitDiscount: input.explicitDiscount ?? null,
    totalCommercialConcession: input.totalCommercialConcession ?? null,
    costUnit: null,
    costValue: null,
    taxRate: null,
    taxValue: null,
    freightRate: null,
    freightRateValue: null,
    freightAbsoluteUnit: null,
    freightAbsoluteValue: null,
    otherVariablesRate: null,
    otherVariablesValue: null,
    commissionRate: null,
    commissionValue: null,
    lowerTier: null,
    upperTier: null,
    exactTier: null,
    tierPosition: null,
    commercialMarginRate: null,
    commercialMarginPercent: null,
    commercialMarginUnitValue: null,
    commercialMarginValue: null,
    calculationSource: "UNAVAILABLE",
    formationContextId: input.formationContextId ?? null,
    referenceDate: input.referenceDate ?? null,
    reasonCode: input.reasonCode,
    warnings: input.warnings?.length ? input.warnings : [reasonLabel],
    isComplete: false,
  };
}

function mapTierValidationFailure(
  code: string
): ProposalCommercialMarginReasonCode {
  if (code === "DUPLICATE_SALE_PRICE") return "INCONSISTENT_PRICE_FORMATION_SET";
  if (code === "EMPTY_TIERS" || code === "MIN_TIERS") return "INCOMPLETE_MARGIN_TIERS";
  return "INCOMPLETE_MARGIN_TIERS";
}

/**
 * Calcula margem comercial de um item da Proposta.
 * Fluxo: finalNetUnitPrice → faixas → comissão proporcional → fórmula inversa.
 */
export function calculateProposalItemCommercialMargin(
  input: CalculateProposalItemCommercialMarginInput
): ProposalCommercialMarginItemPayload {
  if (input.forceReasonCode) {
    return unavailableProposalCommercialMarginItem({
      quantity: Math.max(0, Number(input.quantity) || 0),
      referenceTableUnitPrice: input.referenceTableUnitPrice ?? null,
      negotiatedGrossUnitPrice: input.negotiatedGrossUnitPrice ?? null,
      finalNetUnitPrice: input.finalNetUnitPrice ?? null,
      finalNetLineValue: input.finalNetLineValue ?? null,
      formationContextId: input.formationContextId ?? null,
      referenceDate: input.referenceDate ?? null,
      reasonCode: input.forceReasonCode,
      warnings: input.warnings,
    });
  }

  const commercial = resolveProposalItemCommercialValues({
    quantity: input.quantity,
    referenceTableUnitPrice: input.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: input.negotiatedGrossUnitPrice ?? 0,
    informedDiscountRate: input.informedDiscountRate,
    informedDiscountValue: input.informedDiscountValue,
    finalNetUnitPrice: input.finalNetUnitPrice,
    finalNetLineValue: input.finalNetLineValue,
  });

  const baseUnavailable = {
    quantity: commercial.quantity,
    referenceTableUnitPrice: commercial.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: commercial.negotiatedGrossUnitPrice,
    finalNetUnitPrice: commercial.finalNetUnitPrice,
    finalNetLineValue: commercial.finalNetLineValue,
    manualPriceReduction: commercial.manualPriceReduction,
    explicitDiscount: commercial.explicitDiscount,
    totalCommercialConcession: commercial.totalCommercialConcession,
    formationContextId: input.formationContextId ?? null,
    referenceDate: input.referenceDate ?? null,
    warnings: [...(input.warnings ?? []), ...commercial.warnings],
  };

  if (!commercial.isComplete || commercial.reasonCode) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode:
        commercial.reasonCode === "INVALID_QUANTITY"
          ? "INVALID_QUANTITY"
          : commercial.reasonCode === "INVALID_FINAL_NET_PRICE"
            ? "INVALID_FINAL_NET_PRICE"
            : "FINAL_NET_PRICE_NOT_FOUND",
    });
  }

  const finalNetUnitPrice = commercial.finalNetUnitPrice!;
  const finalNetLineValue = commercial.finalNetLineValue!;

  const cost = readExplicitAbsolute(input.frozenCostUnit);
  if (!cost.present) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode: "COST_NOT_FOUND",
    });
  }
  if (!(cost.value > 0)) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode: "COST_NOT_FOUND",
      warnings: [...baseUnavailable.warnings, "Custo de formação zero ou inválido."],
    });
  }

  const tax = readExplicitRate(input.taxRate);
  if (!tax.present) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode: "TAX_NOT_FOUND",
    });
  }

  const freightRate = readExplicitRate(input.freightRate);
  if (!freightRate.present) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode: "FREIGHT_NOT_DEFINED",
    });
  }

  const freightAbs = readExplicitAbsolute(input.freightAbsoluteUnit);
  if (!freightAbs.present) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode: "FREIGHT_NOT_DEFINED",
    });
  }

  const other = readExplicitRate(input.otherVariablesRate);
  if (!other.present) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode: "OTHER_VARIABLES_NOT_DEFINED",
    });
  }

  let commissionRate: number;
  let lowerTier: CommercialMarginTier | null = null;
  let upperTier: CommercialMarginTier | null = null;
  let exactTier: CommercialMarginTier | null = null;
  let tierPosition: CommercialPricePositionKind | null = null;
  const tierWarnings: string[] = [];

  const providedCommissionRaw =
    input.commissionRate == null || input.commissionRate === ""
      ? null
      : typeof input.commissionRate === "number"
        ? input.commissionRate
        : Number(input.commissionRate);
  if (
    providedCommissionRaw != null &&
    Number.isFinite(providedCommissionRaw) &&
    providedCommissionRaw >= 0
  ) {
    // Percentual de tabela (1 = 1%) ou fração já normalizada (< 1).
    commissionRate = normalizeCommercialCommissionRateFraction(providedCommissionRaw);
  } else {
    const tiersInput = input.tiers ?? [];
    if (!tiersInput.length) {
      return unavailableProposalCommercialMarginItem({
        ...baseUnavailable,
        reasonCode: "INCOMPLETE_MARGIN_TIERS",
        warnings: [...baseUnavailable.warnings, "Formação sem faixas comerciais."],
      });
    }

    const validated = validateAndSortCommercialMarginTiers(tiersInput);
    if (!validated.ok) {
      return unavailableProposalCommercialMarginItem({
        ...baseUnavailable,
        reasonCode: mapTierValidationFailure(validated.code),
        warnings: [...baseUnavailable.warnings, validated.message],
      });
    }

    // Abaixo do Atacado: comissão mínima 1% (não a do Atacado).
    // Antes, `commissionPerc=1` virava fração 1.0 (=100%) e destruía a margem em tela.
    const outOfTableCommissionRate = PROPOSAL_OUT_OF_TABLE_COMMISSION_PERCENT / 100;
    const tierResolution = resolveCommercialCommissionFromTiers({
      netUnitPrice: finalNetUnitPrice,
      tiers: validated.tiers,
      belowLowestCommissionRate: outOfTableCommissionRate,
    });
    if (!tierResolution.ok) {
      return unavailableProposalCommercialMarginItem({
        ...baseUnavailable,
        reasonCode: mapTierValidationFailure(tierResolution.code),
        warnings: [...baseUnavailable.warnings, tierResolution.message],
      });
    }
    if (tierResolution.commissionRate == null) {
      return unavailableProposalCommercialMarginItem({
        ...baseUnavailable,
        reasonCode: "COMMISSION_NOT_DEFINED",
        warnings: [
          ...baseUnavailable.warnings,
          "Não foi possível enquadrar a comissão nas faixas.",
        ],
      });
    }

    commissionRate = tierResolution.commissionRate;
    lowerTier = tierResolution.position.lowerTier ?? null;
    upperTier = tierResolution.position.upperTier ?? null;
    exactTier = tierResolution.position.exactTier ?? null;
    tierPosition = tierResolution.position.position;
    if (tierResolution.belowLowest) {
      tierWarnings.push(
        `Preço abaixo da menor faixa — comissão mínima de ${PROPOSAL_OUT_OF_TABLE_COMMISSION_PERCENT}% (fora de tabela).`
      );
    }
  }

  const calc = calculateCommercialMarginFromNetUnitPrice({
    netUnitPrice: finalNetUnitPrice,
    quantity: commercial.quantity,
    frozenCostUnit: cost.value,
    taxRate: tax.value,
    commissionRate,
    freightRate: freightRate.value,
    freightAbsoluteUnit: freightAbs.value,
    otherVariablesRate: other.value,
  });

  if (!calc.ok) {
    return unavailableProposalCommercialMarginItem({
      ...baseUnavailable,
      reasonCode:
        calc.code === "INVALID_PRICE"
          ? "INVALID_FINAL_NET_PRICE"
          : calc.code === "INVALID_COST"
            ? "COST_NOT_FOUND"
            : "INCONSISTENT_PRICE_FORMATION_SET",
      warnings: [...baseUnavailable.warnings, calc.message],
    });
  }

  const costValue = roundPricingMoney(commercial.quantity * calc.costUnit);
  const taxValue = roundPricingMoney(finalNetLineValue * tax.value);
  const commissionValue = roundPricingMoney(finalNetLineValue * commissionRate);
  const freightRateValue = roundPricingMoney(finalNetLineValue * freightRate.value);
  const freightAbsoluteValue = roundPricingMoney(
    commercial.quantity * calc.freightAbsoluteUnit
  );
  const otherVariablesValue = roundPricingMoney(finalNetLineValue * other.value);
  // Margem da linha = líquido da linha × taxa (fecha composição com o líquido).
  const commercialMarginValue = roundPricingMoney(
    finalNetLineValue * calc.commercialMarginRate
  );
  const commercialMarginUnitValue = roundPricingMoney(calc.commercialMarginUnitValue);
  const commercialMarginPercent = roundPricingPercent(calc.commercialMarginPercent);

  return {
    quantity: commercial.quantity,
    referenceTableUnitPrice: commercial.referenceTableUnitPrice,
    negotiatedGrossUnitPrice: commercial.negotiatedGrossUnitPrice,
    finalNetUnitPrice,
    finalNetLineValue,
    manualPriceReduction: commercial.manualPriceReduction,
    explicitDiscount: commercial.explicitDiscount,
    totalCommercialConcession: commercial.totalCommercialConcession,
    costUnit: roundPricingMoney(calc.costUnit),
    costValue,
    taxRate: tax.value,
    taxValue,
    freightRate: freightRate.value,
    freightRateValue,
    freightAbsoluteUnit: roundPricingMoney(calc.freightAbsoluteUnit),
    freightAbsoluteValue,
    otherVariablesRate: other.value,
    otherVariablesValue,
    commissionRate,
    commissionValue,
    lowerTier,
    upperTier,
    exactTier,
    tierPosition,
    commercialMarginRate: calc.commercialMarginRate,
    commercialMarginPercent,
    commercialMarginUnitValue,
    commercialMarginValue,
    calculationSource: "PROPOSAL_PRICE_FORMATION",
    formationContextId: input.formationContextId ?? null,
    referenceDate: input.referenceDate ?? null,
    reasonCode: null,
    warnings: [...baseUnavailable.warnings, ...tierWarnings],
    isComplete: true,
  };
}

/**
 * Total ponderado da Proposta + cobertura.
 * Nunca média simples de percentuais.
 */
export function summarizeProposalCommercialMargins(
  items: ReadonlyArray<ProposalCommercialMarginItemPayload>,
  options?: { proposalTotalNetValue?: number }
): ProposalCommercialMarginSummaryPayload {
  let proposalCommercialMarginTotalValue = 0;
  let proposalCalculatedNetValue = 0;
  let itemsCalculated = 0;
  let itemsUnavailable = 0;
  let itemsActive = 0;
  const warnings: string[] = [];
  const reasonCodes: ProposalCommercialMarginReasonCode[] = [];

  let inferredTotalNet = 0;

  for (const item of items) {
    const net = item.finalNetLineValue ?? 0;
    if (item.quantity <= 0 || !(net > 0)) continue;
    itemsActive += 1;
    inferredTotalNet += net;

    if (
      item.isComplete &&
      item.commercialMarginValue != null &&
      item.commercialMarginPercent != null
    ) {
      itemsCalculated += 1;
      proposalCommercialMarginTotalValue += item.commercialMarginValue;
      proposalCalculatedNetValue += net;
    } else {
      itemsUnavailable += 1;
      if (item.reasonCode && !reasonCodes.includes(item.reasonCode)) {
        reasonCodes.push(item.reasonCode);
      }
      for (const w of item.warnings) {
        if (!warnings.includes(w)) warnings.push(w);
      }
    }
  }

  proposalCommercialMarginTotalValue = roundPricingMoney(
    proposalCommercialMarginTotalValue
  );
  proposalCalculatedNetValue = roundPricingMoney(proposalCalculatedNetValue);
  const proposalTotalNetValue = roundPricingMoney(
    options?.proposalTotalNetValue != null
      ? Math.max(0, options.proposalTotalNetValue)
      : inferredTotalNet
  );

  const proposalCommercialMarginTotalPercent =
    proposalCalculatedNetValue > 0
      ? roundPricingPercent(
          (proposalCommercialMarginTotalValue / proposalCalculatedNetValue) * 100
        )
      : null;

  const proposalMarginCoveragePercent =
    proposalTotalNetValue > 0
      ? roundPricingPercent((proposalCalculatedNetValue / proposalTotalNetValue) * 100)
      : null;

  const isComplete =
    itemsActive > 0 &&
    itemsUnavailable === 0 &&
    proposalCommercialMarginTotalPercent != null;

  if (!isComplete && itemsUnavailable > 0) {
    warnings.unshift(
      `Margem comercial parcial: ${itemsCalculated} de ${itemsActive} itens calculados.`
    );
  }

  return {
    proposalCommercialMarginTotalValue:
      itemsCalculated > 0 ? proposalCommercialMarginTotalValue : null,
    proposalCommercialMarginTotalPercent,
    proposalCalculatedNetValue,
    proposalTotalNetValue,
    proposalMarginCoveragePercent,
    itemsCalculated,
    itemsUnavailable,
    itemsActive,
    isComplete,
    reasonCodes,
    warnings,
  };
}
