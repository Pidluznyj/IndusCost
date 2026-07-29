/**
 * Domínio canônico de preço e desconto do item da Proposta.
 *
 * Função pura — sem Prisma, sem Pedido, sem I/O.
 * Produz preço líquido final, concessões comerciais e base para margem comercial.
 */
import { roundPricingMoney } from "./pricingCalculations.js";

export type ProposalItemCommercialValuesReasonCode =
  | "FINAL_NET_PRICE_NOT_FOUND"
  | "INVALID_FINAL_NET_PRICE"
  | "INVALID_QUANTITY"
  | null;

export type ResolveProposalItemCommercialValuesInput = {
  quantity: number;
  /** Preço unitário da tabela de referência (formação). */
  referenceTableUnitPrice?: number | null;
  /** Preço unitário bruto negociado (antes do desconto explícito). */
  negotiatedGrossUnitPrice: number;
  /** Desconto % informado (0–1 ou 0–100). */
  informedDiscountRate?: number | null;
  /** Desconto R$ informado na linha. */
  informedDiscountValue?: number | null;
  /**
   * Preço unitário líquido final já resolvido (quando o caller já o possui).
   * Se ausente, deriva de bruto − desconto.
   */
  finalNetUnitPrice?: number | null;
  /** Valor líquido da linha; se ausente, quantity × finalNetUnitPrice. */
  finalNetLineValue?: number | null;
};

export type ProposalItemCommercialValues = {
  quantity: number;
  referenceTableUnitPrice: number | null;
  negotiatedGrossUnitPrice: number;
  finalNetUnitPrice: number | null;
  finalNetLineValue: number | null;
  /** Redução manual vs tabela: max(0, reference − negotiatedGross) × qty (unitário também exposto). */
  manualPriceReductionUnit: number;
  manualPriceReduction: number;
  /** Desconto explícito em R$ na linha. */
  explicitDiscount: number;
  explicitDiscountRate: number;
  /** Concessão total = redução manual + desconto explícito (em R$ na linha). */
  totalCommercialConcession: number;
  totalCommercialConcessionRate: number;
  reasonCode: ProposalItemCommercialValuesReasonCode;
  warnings: string[];
  isComplete: boolean;
};

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : null;
  }
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRate(value: unknown): number | null {
  const n = toFiniteNumber(value);
  if (n == null || n < 0) return null;
  return n > 1 ? n / 100 : n;
}

/**
 * Resolve composição comercial do item da Proposta.
 * Não reaplica desconto sobre preço já líquido.
 */
export function resolveProposalItemCommercialValues(
  input: ResolveProposalItemCommercialValuesInput
): ProposalItemCommercialValues {
  const quantity = Math.max(0, toFiniteNumber(input.quantity) ?? 0);
  const referenceTableUnitPrice = toFiniteNumber(input.referenceTableUnitPrice);
  const negotiatedGrossUnitPrice = toFiniteNumber(input.negotiatedGrossUnitPrice) ?? 0;
  const informedDiscountRate = normalizeRate(input.informedDiscountRate);
  const informedDiscountValue = toFiniteNumber(input.informedDiscountValue);

  const warnings: string[] = [];

  if (quantity <= 0) {
    return {
      quantity,
      referenceTableUnitPrice:
        referenceTableUnitPrice != null ? roundPricingMoney(referenceTableUnitPrice) : null,
      negotiatedGrossUnitPrice: roundPricingMoney(Math.max(0, negotiatedGrossUnitPrice)),
      finalNetUnitPrice: null,
      finalNetLineValue: null,
      manualPriceReductionUnit: 0,
      manualPriceReduction: 0,
      explicitDiscount: 0,
      explicitDiscountRate: 0,
      totalCommercialConcession: 0,
      totalCommercialConcessionRate: 0,
      reasonCode: "INVALID_QUANTITY",
      warnings,
      isComplete: false,
    };
  }

  const grossLine = roundPricingMoney(quantity * Math.max(0, negotiatedGrossUnitPrice));

  let explicitDiscount = 0;
  if (informedDiscountValue != null && informedDiscountValue >= 0) {
    explicitDiscount = roundPricingMoney(Math.min(grossLine, informedDiscountValue));
  } else if (informedDiscountRate != null) {
    explicitDiscount = roundPricingMoney(grossLine * informedDiscountRate);
  }

  const derivedNetLine = roundPricingMoney(Math.max(0, grossLine - explicitDiscount));
  const derivedNetUnit =
    quantity > 0 ? roundPricingMoney(derivedNetLine / quantity) : null;

  const providedNetUnit = toFiniteNumber(input.finalNetUnitPrice);
  const providedNetLine = toFiniteNumber(input.finalNetLineValue);

  let finalNetUnitPrice: number | null = null;
  let finalNetLineValue: number | null = null;

  if (providedNetUnit != null && providedNetUnit > 0) {
    finalNetUnitPrice = roundPricingMoney(providedNetUnit);
    finalNetLineValue =
      providedNetLine != null && providedNetLine > 0
        ? roundPricingMoney(providedNetLine)
        : roundPricingMoney(quantity * finalNetUnitPrice);
  } else if (providedNetLine != null && providedNetLine > 0) {
    finalNetLineValue = roundPricingMoney(providedNetLine);
    finalNetUnitPrice = roundPricingMoney(finalNetLineValue / quantity);
  } else if (derivedNetUnit != null && derivedNetUnit > 0 && derivedNetLine > 0) {
    finalNetUnitPrice = derivedNetUnit;
    finalNetLineValue = derivedNetLine;
  }

  if (finalNetUnitPrice == null || finalNetLineValue == null) {
    return {
      quantity,
      referenceTableUnitPrice:
        referenceTableUnitPrice != null ? roundPricingMoney(referenceTableUnitPrice) : null,
      negotiatedGrossUnitPrice: roundPricingMoney(Math.max(0, negotiatedGrossUnitPrice)),
      finalNetUnitPrice: null,
      finalNetLineValue: null,
      manualPriceReductionUnit: 0,
      manualPriceReduction: 0,
      explicitDiscount,
      explicitDiscountRate:
        grossLine > 0 ? roundPricingMoney(explicitDiscount / grossLine) : 0,
      totalCommercialConcession: explicitDiscount,
      totalCommercialConcessionRate:
        grossLine > 0 ? roundPricingMoney(explicitDiscount / grossLine) : 0,
      reasonCode: "FINAL_NET_PRICE_NOT_FOUND",
      warnings,
      isComplete: false,
    };
  }

  if (!(finalNetUnitPrice > 0) || !(finalNetLineValue > 0)) {
    return {
      quantity,
      referenceTableUnitPrice:
        referenceTableUnitPrice != null ? roundPricingMoney(referenceTableUnitPrice) : null,
      negotiatedGrossUnitPrice: roundPricingMoney(Math.max(0, negotiatedGrossUnitPrice)),
      finalNetUnitPrice,
      finalNetLineValue,
      manualPriceReductionUnit: 0,
      manualPriceReduction: 0,
      explicitDiscount,
      explicitDiscountRate:
        grossLine > 0 ? roundPricingMoney(explicitDiscount / grossLine) : 0,
      totalCommercialConcession: explicitDiscount,
      totalCommercialConcessionRate:
        grossLine > 0 ? roundPricingMoney(explicitDiscount / grossLine) : 0,
      reasonCode: "INVALID_FINAL_NET_PRICE",
      warnings,
      isComplete: false,
    };
  }

  const manualPriceReductionUnit =
    referenceTableUnitPrice != null && referenceTableUnitPrice > negotiatedGrossUnitPrice
      ? roundPricingMoney(referenceTableUnitPrice - negotiatedGrossUnitPrice)
      : 0;
  const manualPriceReduction = roundPricingMoney(manualPriceReductionUnit * quantity);

  // Se o líquido foi informado diretamente e diverge do derivado, o desconto efetivo
  // pela diferença bruto−líquido prevalece para concessões (sem reaplicar).
  const effectiveExplicitFromNet = roundPricingMoney(
    Math.max(0, grossLine - finalNetLineValue - manualPriceReduction)
  );
  // Prefer informed explicit when present; else derive from net gap after manual reduction.
  if (informedDiscountValue == null && informedDiscountRate == null) {
    explicitDiscount = Math.max(0, effectiveExplicitFromNet);
  }

  const referenceLine =
    referenceTableUnitPrice != null && referenceTableUnitPrice > 0
      ? roundPricingMoney(quantity * referenceTableUnitPrice)
      : grossLine;
  const totalCommercialConcession = roundPricingMoney(
    Math.max(0, referenceLine - finalNetLineValue)
  );
  const totalCommercialConcessionRate =
    referenceLine > 0
      ? roundPricingMoney(totalCommercialConcession / referenceLine)
      : 0;
  const explicitDiscountRate =
    grossLine > 0 ? roundPricingMoney(explicitDiscount / grossLine) : 0;

  return {
    quantity,
    referenceTableUnitPrice:
      referenceTableUnitPrice != null ? roundPricingMoney(referenceTableUnitPrice) : null,
    negotiatedGrossUnitPrice: roundPricingMoney(Math.max(0, negotiatedGrossUnitPrice)),
    finalNetUnitPrice,
    finalNetLineValue,
    manualPriceReductionUnit,
    manualPriceReduction,
    explicitDiscount,
    explicitDiscountRate,
    totalCommercialConcession,
    totalCommercialConcessionRate,
    reasonCode: null,
    warnings,
    isComplete: true,
  };
}
