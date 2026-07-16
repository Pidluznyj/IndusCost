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
  /** Base oficial (ex. vBC do ICMS HEADER), quando existir — não inferir de alíquota. */
  baseAmount?: number | null;
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
  /**
   * Camadas B/C/D — apuração, recolhimento e alocação gerencial.
   * Sempre presente quando o payload fiscal é carregado; pode estar vazio.
   */
  settlements: SalesOrderFiscalSettlementsBlock;
  technical: {
    source: string;
    note: string;
    doNotSumHeaderAndItem: true;
  };
};

/** Status textual da linha consolidada por tributo (nunca “impostos pagos” genérico). */
export type SalesOrderFiscalSettlementStatusCode =
  | "NO_COLLECTION_INFO"
  | "ASSESSED_PENDING_PAYMENT"
  | "PARTIALLY_PAID"
  | "PAID"
  | "GUIDE_CANCELLED"
  | "OPEN_PERIOD"
  | "ALLOCATED_ONLY";

export const SALES_ORDER_FISCAL_SETTLEMENT_STATUS_LABELS: Record<
  SalesOrderFiscalSettlementStatusCode,
  string
> = {
  NO_COLLECTION_INFO: "Sem informação de recolhimento",
  ASSESSED_PENDING_PAYMENT: "Apurado, pendente de recolhimento",
  PARTIALLY_PAID: "Recolhimento parcial",
  PAID: "Efetivamente recolhido",
  GUIDE_CANCELLED: "Guia cancelada/estornada",
  OPEN_PERIOD: "Período de apuração ainda aberto",
  ALLOCATED_ONLY: "Alocado gerencialmente (sem guia completa)",
};

export type SalesOrderFiscalTaxMatrixRow = {
  taxType: string;
  label: string;
  /** Destacado na NF (HEADER). */
  highlightedAmount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  periodStatus: string | null;
  /** Apurado no período (soma linhas do mesmo taxType nos períodos ligados). */
  assessedAmount: number | null;
  creditsAmount: number | null;
  amountDue: number | null;
  amountPaid: number | null;
  interestAmount: number | null;
  fineAmount: number | null;
  paidAt: string | null;
  guideType: string | null;
  guideNumber: string | null;
  guideStatus: string | null;
  guideBalanceDue: number | null;
  allocatedToOrder: number | null;
  allocationMethod: string | null;
  allocationMethodLabel: string | null;
  statusCode: SalesOrderFiscalSettlementStatusCode;
  statusLabel: string;
};

export type SalesOrderFiscalSettlementGuideDto = {
  guideId: string;
  taxType: string;
  guideType: string;
  guideTypeLabel: string;
  guideNumber: string | null;
  status: string;
  statusLabel: string;
  periodStart: string;
  periodEnd: string;
  dueDate: string | null;
  assessedAmount: number;
  creditsAmount: number;
  compensationsAmount: number;
  interestAmount: number;
  fineAmount: number;
  amountDue: number;
  amountPaid: number;
  balanceDue: number;
  paidAt: string | null;
  accountsPayableExternalId: number | null;
  accountsPayableDocumentNumber: string | null;
  proofCount: number;
  allocatedToThisOrder: number;
  allocationMethodLabels: string[];
  /** Texto operacional (parcial / pendente / sem recolhimento). */
  collectionLabel: string;
};

export type SalesOrderFiscalSettlementAllocationDto = {
  id: string;
  settlementId: string;
  guideId: string;
  taxType: string;
  allocatedAmount: number;
  allocationMethod: string;
  allocationMethodLabel: string;
  allocationBase: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  calculatedAt: string;
  version: number;
  manualOverride: boolean;
  notes: string | null;
  nomusNfeId: string | null;
  isManagerialOnly: true;
};

export type SalesOrderFiscalSettlementHistoryDto = {
  at: string;
  entityType: string;
  entityId: string;
  action: string;
  summary: string;
};

export type SalesOrderFiscalSettlementsBlock = {
  /** Fonte B */
  apurationSourceLabel: "Fechamento fiscal do período";
  /** Fonte C */
  collectionSourceLabel: "Guia + baixa/comprovante";
  /** Fonte D */
  allocationSourceLabel: "Metodologia gerencial explicitamente indicada";
  updatedAt: string | null;
  taxMatrix: SalesOrderFiscalTaxMatrixRow[];
  guides: SalesOrderFiscalSettlementGuideDto[];
  allocations: SalesOrderFiscalSettlementAllocationDto[];
  history: SalesOrderFiscalSettlementHistoryDto[];
  totals: {
    highlightedTotal: number;
    assessedTotal: number;
    amountDueTotal: number;
    amountPaidTotal: number;
    allocatedToOrderTotal: number;
  };
  emptyStates: {
    noGuides: boolean;
    noApuration: boolean;
    noAllocations: boolean;
  };
};

export function emptySalesOrderFiscalSettlementsBlock(
  updatedAt: string | null = null
): SalesOrderFiscalSettlementsBlock {
  return {
    apurationSourceLabel: "Fechamento fiscal do período",
    collectionSourceLabel: "Guia + baixa/comprovante",
    allocationSourceLabel: "Metodologia gerencial explicitamente indicada",
    updatedAt,
    taxMatrix: [],
    guides: [],
    allocations: [],
    history: [],
    totals: {
      highlightedTotal: 0,
      assessedTotal: 0,
      amountDueTotal: 0,
      amountPaidTotal: 0,
      allocatedToOrderTotal: 0,
    },
    emptyStates: {
      noGuides: true,
      noApuration: true,
      noAllocations: true,
    },
  };
}

export function resolveSalesOrderFiscalSettlementStatus(input: {
  hasGuide: boolean;
  guideStatus?: string | null;
  periodStatus?: string | null;
  assessedAmount?: number | null;
  amountDue?: number | null;
  amountPaid?: number | null;
  allocatedAmount?: number | null;
}): SalesOrderFiscalSettlementStatusCode {
  const paid = input.amountPaid ?? 0;
  const due = input.amountDue ?? 0;
  const assessed = input.assessedAmount ?? 0;
  const allocated = input.allocatedAmount ?? 0;
  const st = (input.guideStatus ?? "").toUpperCase();

  if (st === "CANCELLED" || st === "REVERSED") return "GUIDE_CANCELLED";
  if (!input.hasGuide) {
    if (allocated > 0.009) return "ALLOCATED_ONLY";
    return "NO_COLLECTION_INFO";
  }
  if ((input.periodStatus ?? "").toUpperCase() === "OPEN" && paid <= 0.009) {
    return "OPEN_PERIOD";
  }
  if (paid > 0.009 && due > 0 && paid + 0.009 < due) return "PARTIALLY_PAID";
  if (paid + 0.009 >= due && due > 0.009) return "PAID";
  if (assessed > 0.009 && paid <= 0.009) return "ASSESSED_PENDING_PAYMENT";
  if (paid <= 0.009) return "ASSESSED_PENDING_PAYMENT";
  return "PAID";
}

export function collectionLabelForGuide(input: {
  status: string;
  amountDue: number;
  amountPaid: number;
  balanceDue: number;
}): string {
  const st = input.status.toUpperCase();
  if (st === "CANCELLED" || st === "REVERSED") {
    return "Guia cancelada/estornada — sem recolhimento válido";
  }
  if (input.amountPaid <= 0.009) {
    return "Apurado, pendente de recolhimento";
  }
  if (input.balanceDue > 0.009) {
    return `Recolhimento parcial — devido ${input.amountDue.toFixed(2)}, pago ${input.amountPaid.toFixed(2)}, saldo ${input.balanceDue.toFixed(2)}`;
  }
  return "Efetivamente recolhido";
}

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

/** Soma só amounts > 0 (atalhos de UI que omitem zero). */
export function filterPositiveTaxAmounts(
  rows: SalesOrderFiscalTaxAmount[]
): SalesOrderFiscalTaxAmount[] {
  return sortFiscalTaxAmounts(rows.filter((r) => r.amount > 0.009));
}

/**
 * Mantém tributos documentais presentes, inclusive valor oficial zero.
 * Ausente (não listado) ≠ zero.
 */
export function filterPresentTaxAmounts(
  rows: SalesOrderFiscalTaxAmount[]
): SalesOrderFiscalTaxAmount[] {
  return sortFiscalTaxAmounts(
    rows.filter(
      (r) => r.amount != null && Number.isFinite(r.amount) && r.amount >= 0
    )
  );
}
