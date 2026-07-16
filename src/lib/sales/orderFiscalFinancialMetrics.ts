/**
 * Métricas fiscais/financeiras do Pedido de Venda — contrato compartilhado.
 *
 * Separação oficial:
 * - Valor do pedido / ativo → motor SalesOrder (não recalcular aqui).
 * - Total NF válido / produtos / impostos destacados → NomusNfe (xmlVNF, valorLiquido).
 * - A faturar → operacional (ativo − total NF válido comparável).
 * - Saldo financeiro → somente CR oficial em aberto (nunca pedido − NF).
 * - Total financeiro → CR real + planejado aplicável (exclui planejado substituído).
 *
 * Frontend-safe: sem Prisma.
 */

export type LinkedNfeFiscalAmountsInput = {
  valorLiquido?: unknown;
  xmlVNF?: unknown;
  xmlVProd?: unknown;
  xmlVDesc?: unknown;
};

export type LinkedNfeFiscalAmounts = {
  /** vProd − vDesc (ou valorLiquido persistido). */
  productsValue: number | null;
  /** Total da NF (vNF / xmlVNF). */
  totalNfValue: number | null;
  /**
   * Impostos/encargos destacados no total da NF quando ambos os lados existem:
   * max(0, vNF − produtos). Não inventa IPI/ICMS individuais se o banco não os tiver.
   */
  highlightedTaxesValue: number | null;
  /**
   * Base fiscal comparável ao total do pedido.
   * Prefere xmlVNF; fallback valorLiquido/produtos.
   */
  comparableBillingValue: number;
};

export type OrderOfficialCrSummary = {
  hasOfficialCr: boolean;
  crOriginal: number;
  crReceived: number;
  /** Soma de balanceReceivable dos CRs válidos. */
  crOpen: number;
};

export type OrderFiscalFinancialMetrics = {
  orderActiveValue: number;
  nfeProductsValue: number;
  nfeHighlightedTaxesValue: number;
  /** Soma de NF válida em base comparável ao pedido. */
  nfeValidTotalValue: number;
  /** Parcela ativa ainda não coberta por NF válida (operacional). */
  amountToInvoice: number;
  hasOfficialCr: boolean;
  crOriginal: number;
  crReceived: number;
  crOpen: number;
  /**
   * Saldo financeiro oficial.
   * null = sem CR gerado (UI deve exibir "—" / "Sem CR gerado").
   */
  financialBalance: number | null;
  plannedApplicableExpected: number;
  plannedReplacedAmount: number;
  /** CR original + planejado ainda aplicável (nunca soma substituído). */
  totalFinancialValue: number;
};

function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function roundOrderMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Produtos líquidos da NF (valorLiquido = vProd − vDesc). */
export function resolveNfeProductsValue(
  nfe: LinkedNfeFiscalAmountsInput | null | undefined
): number | null {
  if (!nfe) return null;
  const liquido = toFiniteNumber(nfe.valorLiquido);
  if (liquido != null && liquido >= 0) return liquido;
  const vProd = toFiniteNumber(nfe.xmlVProd);
  if (vProd == null) return null;
  const vDesc = toFiniteNumber(nfe.xmlVDesc) ?? 0;
  const value = vProd - vDesc;
  return Number.isFinite(value) ? value : null;
}

/** Total oficial da NF (vNF). */
export function resolveNfeTotalValue(
  nfe: LinkedNfeFiscalAmountsInput | null | undefined
): number | null {
  if (!nfe) return null;
  const vNf = toFiniteNumber(nfe.xmlVNF);
  if (vNf != null && vNf >= 0) return vNf;
  return null;
}

/**
 * Valor de faturamento comparável ao pedido.
 * Preferência: xmlVNF (inclui IPI e demais componentes do total da NF).
 * Fallback: produtos líquidos (valorLiquido).
 */
export function resolveNfeComparableBillingValue(
  nfe: LinkedNfeFiscalAmountsInput | null | undefined,
  rawFallback = 0
): number {
  const total = resolveNfeTotalValue(nfe);
  if (total != null) return total;
  const products = resolveNfeProductsValue(nfe);
  if (products != null) return products;
  return Number.isFinite(rawFallback) && rawFallback >= 0 ? rawFallback : 0;
}

export function resolveNfeHighlightedTaxesValue(
  nfe: LinkedNfeFiscalAmountsInput | null | undefined
): number | null {
  const total = resolveNfeTotalValue(nfe);
  const products = resolveNfeProductsValue(nfe);
  if (total == null || products == null) return null;
  return roundOrderMoney(Math.max(0, total - products));
}

export function buildLinkedNfeFiscalAmounts(
  nfe: LinkedNfeFiscalAmountsInput | null | undefined,
  rawFallback = 0
): LinkedNfeFiscalAmounts {
  const productsValue = resolveNfeProductsValue(nfe);
  const totalNfValue = resolveNfeTotalValue(nfe);
  return {
    productsValue,
    totalNfValue,
    highlightedTaxesValue: resolveNfeHighlightedTaxesValue(nfe),
    comparableBillingValue: resolveNfeComparableBillingValue(nfe, rawFallback),
  };
}

export function computeAmountToInvoice(
  orderActiveValue: number,
  nfeValidComparableTotal: number
): number {
  return roundOrderMoney(Math.max(0, orderActiveValue - nfeValidComparableTotal));
}

/**
 * Saldo financeiro = aberto oficial do CR.
 * Sem CR → null (não inventar saldo por pedido − NF).
 */
export function resolveFinancialBalanceFromCr(
  cr: OrderOfficialCrSummary | null | undefined
): number | null {
  if (!cr || !cr.hasOfficialCr) return null;
  return roundOrderMoney(Math.max(0, cr.crOpen));
}

/**
 * Total financeiro consolidado:
 * CR real original + planejado ainda aplicável (exclui substituído por CR).
 */
export function computeOrderTotalFinancialValue(input: {
  crOriginal: number;
  plannedApplicableExpected: number;
}): number {
  return roundOrderMoney(
    Math.max(0, input.crOriginal) + Math.max(0, input.plannedApplicableExpected)
  );
}

export function buildOrderFiscalFinancialMetrics(input: {
  orderActiveValue: number;
  nfeProductsValue?: number;
  nfeHighlightedTaxesValue?: number;
  nfeValidTotalValue: number;
  cr?: OrderOfficialCrSummary | null;
  plannedApplicableExpected?: number;
  plannedReplacedAmount?: number;
}): OrderFiscalFinancialMetrics {
  const cr = input.cr ?? {
    hasOfficialCr: false,
    crOriginal: 0,
    crReceived: 0,
    crOpen: 0,
  };
  const plannedApplicable = roundOrderMoney(input.plannedApplicableExpected ?? 0);
  const plannedReplaced = roundOrderMoney(input.plannedReplacedAmount ?? 0);
  const nfeValid = roundOrderMoney(input.nfeValidTotalValue);
  return {
    orderActiveValue: roundOrderMoney(input.orderActiveValue),
    nfeProductsValue: roundOrderMoney(input.nfeProductsValue ?? 0),
    nfeHighlightedTaxesValue: roundOrderMoney(input.nfeHighlightedTaxesValue ?? 0),
    nfeValidTotalValue: nfeValid,
    amountToInvoice: computeAmountToInvoice(input.orderActiveValue, nfeValid),
    hasOfficialCr: cr.hasOfficialCr,
    crOriginal: roundOrderMoney(cr.crOriginal),
    crReceived: roundOrderMoney(cr.crReceived),
    crOpen: roundOrderMoney(cr.crOpen),
    financialBalance: resolveFinancialBalanceFromCr(cr),
    plannedApplicableExpected: plannedApplicable,
    plannedReplacedAmount: plannedReplaced,
    totalFinancialValue: computeOrderTotalFinancialValue({
      crOriginal: cr.crOriginal,
      plannedApplicableExpected: plannedApplicable,
    }),
  };
}

/** Planejado aplicável = totalExpected − replacedAmount (quando totals ainda incluem substituídos). */
export function resolveApplicablePlannedExpected(input: {
  totalExpected: number;
  replacedAmount: number;
}): number {
  return roundOrderMoney(Math.max(0, input.totalExpected - input.replacedAmount));
}
