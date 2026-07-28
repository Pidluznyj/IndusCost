/**
 * Motor de custo comparável e ganho de negociação (OP-16) — puro, sem Prisma.
 *
 * Custo comparável = itens + frete (se não CIF) + impostos não recuperáveis + despesas − descontos.
 * Prazo, pagamento, lote e condições qualitativas NÃO entram como economia monetária.
 */

export type FreightIncoterm = "CIF" | "FOB" | "OTHER";

export type CommercialLineInput = {
  unitPrice: number;
  quantity: number;
  freightValue?: number | null;
  nonRecoverableTaxes?: number | null;
  expenses?: number | null;
  discounts?: number | null;
};

export type ComparableCostInput = {
  currency: string;
  lines: CommercialLineInput[];
  headerFreight?: number | null;
  headerNonRecoverableTaxes?: number | null;
  headerExpenses?: number | null;
  headerDiscounts?: number | null;
  /** CIF: frete embutido no preço — não soma freightValue. FOB/OTHER: soma frete. */
  freightIncoterm?: FreightIncoterm | string | null;
};

export type ConditionField =
  | "leadTimeDays"
  | "paymentTerms"
  | "deliveryTerms"
  | "minOrderQty"
  | "warranty"
  | "otherQualitative";

export type ConditionGain = {
  field: ConditionField;
  label: string;
  previousValue: string | number | null;
  newValue: string | number | null;
  improved: boolean | null;
};

export type NegotiationSavingsResult = {
  currency: string;
  initialComparableCost: number;
  negotiatedComparableCost: number;
  /** initial − negotiated (positivo = economia). */
  totalGain: number;
  /** totalGain / quantidade total negociada; null se qty <= 0. */
  unitGain: number | null;
  /** (totalGain / initialComparable) * 100; null se initial == 0 (divisão por zero). */
  percentGain: number | null;
  costIncreased: boolean;
  pricesEqual: boolean;
  totalQuantity: number;
  itemsSubtotalInitial: number;
  itemsSubtotalNegotiated: number;
  conditionGains: ConditionGain[];
};

export class NegotiationSavingsError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "NegotiationSavingsError";
  }
}

function n(value: number | null | undefined): number {
  if (value == null) return 0;
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function normalizeCurrency(currency: string): string {
  const c = String(currency || "").trim().toUpperCase();
  if (!c) {
    throw new NegotiationSavingsError("Moeda obrigatória.", "CURRENCY_REQUIRED");
  }
  return c;
}

function includesBuyerFreight(incoterm: string | null | undefined): boolean {
  const t = String(incoterm || "FOB").trim().toUpperCase();
  // CIF: frete no preço do fornecedor — não soma frete separado no custo do comprador.
  return t !== "CIF";
}

export function sumItemsSubtotal(lines: CommercialLineInput[]): number {
  return lines.reduce((s, line) => {
    const qty = n(line.quantity);
    const price = n(line.unitPrice);
    if (qty < 0 || price < 0) {
      throw new NegotiationSavingsError("Preço/quantidade não podem ser negativos.", "NEGATIVE_VALUE");
    }
    return s + price * qty;
  }, 0);
}

export function sumLineExtras(
  lines: CommercialLineInput[],
  opts: { includeFreight: boolean }
): { freight: number; taxes: number; expenses: number; discounts: number } {
  let freight = 0;
  let taxes = 0;
  let expenses = 0;
  let discounts = 0;
  for (const line of lines) {
    if (opts.includeFreight) freight += n(line.freightValue);
    taxes += n(line.nonRecoverableTaxes);
    expenses += n(line.expenses);
    discounts += n(line.discounts);
  }
  return { freight, taxes, expenses, discounts };
}

export function computeComparableCost(input: ComparableCostInput): {
  comparableCost: number;
  itemsSubtotal: number;
  freightTotal: number;
  taxesTotal: number;
  expensesTotal: number;
  discountsTotal: number;
  totalQuantity: number;
} {
  const includeFreight = includesBuyerFreight(input.freightIncoterm);
  const itemsSubtotal = sumItemsSubtotal(input.lines);
  const lineExtras = sumLineExtras(input.lines, { includeFreight });
  const headerFreight = includeFreight ? n(input.headerFreight) : 0;
  const taxesTotal = lineExtras.taxes + n(input.headerNonRecoverableTaxes);
  const expensesTotal = lineExtras.expenses + n(input.headerExpenses);
  const discountsTotal = lineExtras.discounts + n(input.headerDiscounts);
  const freightTotal = lineExtras.freight + headerFreight;
  const comparableCost = itemsSubtotal + freightTotal + taxesTotal + expensesTotal - discountsTotal;
  const totalQuantity = input.lines.reduce((s, l) => s + n(l.quantity), 0);
  return {
    comparableCost,
    itemsSubtotal,
    freightTotal,
    taxesTotal,
    expensesTotal,
    discountsTotal,
    totalQuantity,
  };
}

export function buildConditionGains(input: {
  previousLeadTimeDays?: number | null;
  newLeadTimeDays?: number | null;
  previousPaymentTerms?: string | null;
  newPaymentTerms?: string | null;
  previousDeliveryTerms?: string | null;
  newDeliveryTerms?: string | null;
  previousMinOrderQty?: number | null;
  newMinOrderQty?: number | null;
  previousWarranty?: string | null;
  newWarranty?: string | null;
  qualitativeNotes?: string | null;
}): ConditionGain[] {
  const out: ConditionGain[] = [];

  if (
    input.previousLeadTimeDays != null ||
    input.newLeadTimeDays != null
  ) {
    const prev = input.previousLeadTimeDays ?? null;
    const next = input.newLeadTimeDays ?? null;
    let improved: boolean | null = null;
    if (prev != null && next != null) improved = next < prev;
    out.push({
      field: "leadTimeDays",
      label: "Prazo de entrega (dias)",
      previousValue: prev,
      newValue: next,
      improved,
    });
  }

  const payPrev = (input.previousPaymentTerms ?? "").trim() || null;
  const payNext = (input.newPaymentTerms ?? "").trim() || null;
  if (payPrev !== payNext && (payPrev || payNext)) {
    out.push({
      field: "paymentTerms",
      label: "Condição de pagamento",
      previousValue: payPrev,
      newValue: payNext,
      improved: null,
    });
  }

  const delPrev = (input.previousDeliveryTerms ?? "").trim() || null;
  const delNext = (input.newDeliveryTerms ?? "").trim() || null;
  if (delPrev !== delNext && (delPrev || delNext)) {
    out.push({
      field: "deliveryTerms",
      label: "Condição de entrega / frete qualitativo",
      previousValue: delPrev,
      newValue: delNext,
      improved: null,
    });
  }

  if (input.previousMinOrderQty != null || input.newMinOrderQty != null) {
    const prev = input.previousMinOrderQty ?? null;
    const next = input.newMinOrderQty ?? null;
    let improved: boolean | null = null;
    if (prev != null && next != null) improved = next < prev;
    if (prev !== next) {
      out.push({
        field: "minOrderQty",
        label: "Lote mínimo (MOQ)",
        previousValue: prev,
        newValue: next,
        improved,
      });
    }
  }

  const wPrev = (input.previousWarranty ?? "").trim() || null;
  const wNext = (input.newWarranty ?? "").trim() || null;
  if (wPrev !== wNext && (wPrev || wNext)) {
    out.push({
      field: "warranty",
      label: "Garantia",
      previousValue: wPrev,
      newValue: wNext,
      improved: null,
    });
  }

  const q = (input.qualitativeNotes ?? "").trim();
  if (q) {
    out.push({
      field: "otherQualitative",
      label: "Condição qualitativa",
      previousValue: null,
      newValue: q,
      improved: null,
    });
  }

  return out;
}

/**
 * Compara custo inicial vs negociado na mesma moeda.
 * Não monetiza prazo/pagamento/lote/garantia — só lista em conditionGains.
 */
export function computeNegotiationSavings(input: {
  initial: ComparableCostInput;
  negotiated: ComparableCostInput;
  condition?: Parameters<typeof buildConditionGains>[0];
}): NegotiationSavingsResult {
  const currencyInitial = normalizeCurrency(input.initial.currency);
  const currencyNegotiated = normalizeCurrency(input.negotiated.currency);
  if (currencyInitial !== currencyNegotiated) {
    throw new NegotiationSavingsError(
      `Moedas incompatíveis: ${currencyInitial} vs ${currencyNegotiated}.`,
      "CURRENCY_MISMATCH"
    );
  }

  const initial = computeComparableCost(input.initial);
  const negotiated = computeComparableCost(input.negotiated);
  const totalGain = initial.comparableCost - negotiated.comparableCost;
  const totalQuantity = negotiated.totalQuantity > 0 ? negotiated.totalQuantity : initial.totalQuantity;
  const unitGain = totalQuantity > 0 ? totalGain / totalQuantity : null;
  const percentGain =
    Math.abs(initial.comparableCost) < 1e-12
      ? null
      : (totalGain / initial.comparableCost) * 100;

  const pricesEqual = Math.abs(totalGain) < 1e-9;

  return {
    currency: currencyInitial,
    initialComparableCost: initial.comparableCost,
    negotiatedComparableCost: negotiated.comparableCost,
    totalGain,
    unitGain,
    percentGain,
    costIncreased: totalGain < -1e-9,
    pricesEqual,
    totalQuantity,
    itemsSubtotalInitial: initial.itemsSubtotal,
    itemsSubtotalNegotiated: negotiated.itemsSubtotal,
    conditionGains: buildConditionGains(input.condition ?? {}),
  };
}
