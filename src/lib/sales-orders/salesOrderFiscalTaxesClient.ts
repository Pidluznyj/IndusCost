/**
 * DTO client-safe da aba Tributos do Pedido de Venda (T04).
 * Camada A (destacado na NF) — nunca “pago” / apurado / alocado.
 * Agregados usam apenas linhas HEADER (não somar HEADER+ITEM).
 */

export const SALES_ORDER_FISCAL_TAX_LABELS: Record<string, string> = {
  IPI: "IPI",
  ICMS: "ICMS",
  ICMS_ST: "ICMS-ST",
  ICMS_DESON: "ICMS desonerado",
  FCP: "FCP",
  FCP_ST: "FCP-ST",
  FCP_ST_RET: "FCP-ST retido",
  PIS: "PIS",
  COFINS: "COFINS",
  II: "II",
  ISS: "ISS",
  IBS: "IBS",
  CBS: "CBS",
  IS: "Imposto Seletivo",
  IPI_DEVOL: "IPI devolvido",
  OTHER: "Outros",
};

/** Ordem de exibição preferencial. */
export const SALES_ORDER_FISCAL_TAX_ORDER = [
  "IPI",
  "ICMS",
  "ICMS_ST",
  "ICMS_DESON",
  "FCP",
  "FCP_ST",
  "FCP_ST_RET",
  "PIS",
  "COFINS",
  "II",
  "ISS",
  "IBS",
  "CBS",
  "IS",
  "IPI_DEVOL",
] as const;

export type SalesOrderFiscalTaxAmount = {
  taxType: string;
  label: string;
  amount: number;
};

export type SalesOrderFiscalTaxesSummary = {
  orderActiveValue: number;
  productsValue: number;
  discountsValue: number;
  freightValue: number;
  insuranceValue: number;
  otherExpensesValue: number;
  nfeValidTotal: number;
  amountToInvoice: number;
  /**
   * Saldo financeiro oficial (CR aberto) — NÃO é saldo fiscal / residual de imposto.
   * null = sem CR gerado.
   */
  financialBalance: number | null;
  financialBalanceLabel: string;
  validNfeCount: number;
  cancelledNfeCount: number;
  compositionIncomplete: boolean;
  compositionIncompleteReason: string | null;
  sourceLabel: string;
  lastParsedAt: string | null;
  parserVersion: string | null;
};

export type SalesOrderFiscalTaxLineDto = {
  lineKey: string;
  taxType: string;
  label: string;
  scope: "HEADER" | "ITEM";
  itemNumber: number | null;
  baseAmount: number | null;
  rate: number | null;
  amount: number | null;
  cst: string | null;
  csosn: string | null;
  cfop: string | null;
  ncm: string | null;
  productSku: string | null;
  productName: string | null;
  /** Quantidade do item na NF (quando disponível via audit.nfeItems). */
  quantity?: number | null;
  /** Valor do item na NF (quando disponível). */
  itemValue?: number | null;
  nfeExternalId?: number | null;
  nfeNumero?: string | null;
};

export type SalesOrderFiscalNfeDto = {
  nomusNfeId: string | null;
  nfeExternalId: number;
  numero: string | null;
  serie: string | null;
  chave: string | null;
  emissionDate: string | null;
  status: number | null;
  statusLabel: string;
  isCancelled: boolean;
  isValidForTotals: boolean;
  finalidade: number | null;
  productsValue: number | null;
  discountsValue: number | null;
  freightValue: number | null;
  insuranceValue: number | null;
  otherExpensesValue: number | null;
  taxesTotalHeader: number | null;
  highlightedTaxesFallback: number | null;
  totalValue: number | null;
  compositionIncomplete: boolean;
  source: "FISCAL_SUMMARY" | "HEADER_DIFF" | "MISSING";
  parsedAt: string | null;
  parserVersion: string | null;
  headerTaxes: SalesOrderFiscalTaxAmount[];
  itemTaxLines: SalesOrderFiscalTaxLineDto[];
};

export type SalesOrderFiscalTaxesPayload = {
  summary: SalesOrderFiscalTaxesSummary;
  highlightedTaxes: SalesOrderFiscalTaxAmount[];
  nfes: SalesOrderFiscalNfeDto[];
  cancelledNfes: SalesOrderFiscalNfeDto[];
  itemTaxLines: SalesOrderFiscalTaxLineDto[];
  technical: {
    source: string;
    note: string;
    doNotSumHeaderAndItem: true;
  };
};

export function labelForFiscalTaxType(taxType: string): string {
  return SALES_ORDER_FISCAL_TAX_LABELS[taxType] ?? taxType;
}

export function sortFiscalTaxAmounts(
  rows: SalesOrderFiscalTaxAmount[]
): SalesOrderFiscalTaxAmount[] {
  const order = new Map(
    SALES_ORDER_FISCAL_TAX_ORDER.map((t, i) => [t, i] as const)
  );
  return [...rows].sort((a, b) => {
    const ia = order.get(a.taxType as (typeof SALES_ORDER_FISCAL_TAX_ORDER)[number]);
    const ib = order.get(b.taxType as (typeof SALES_ORDER_FISCAL_TAX_ORDER)[number]);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.taxType.localeCompare(b.taxType);
  });
}

/** Soma só amounts > 0 (campos disponíveis). */
export function filterPositiveTaxAmounts(
  rows: SalesOrderFiscalTaxAmount[]
): SalesOrderFiscalTaxAmount[] {
  return sortFiscalTaxAmounts(rows.filter((r) => r.amount > 0.009));
}
