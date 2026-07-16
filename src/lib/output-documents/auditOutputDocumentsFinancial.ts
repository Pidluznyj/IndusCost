/**
 * Classificação pura de alocação financeira e Contas a Receber (DS-02.6).
 * Não altera regras oficiais. Não acessa banco.
 *
 * Dinheiro: centavos inteiros após `roundMoney` (helper oficial).
 * Tolerância de 1 centavo só para classificação de arredondamento.
 */

import { roundMoney } from "../commissions/commission-money.shared.js";
import { FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE } from "../financeApAllocationShared.js";

/** 1 centavo — alinhado a FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE (0.01). */
export const AUDIT_MONEY_CENT_TOLERANCE = Math.round(
  FINANCE_AP_ALLOCATION_AMOUNT_TOLERANCE * 100
);

export type AllocationCoverageStatus =
  | "nao_alocado"
  | "parcial"
  | "completo"
  | "superalocado"
  | "arredondamento";

export type ReceivableSettlementStatus = "aberto" | "parcial" | "recebido";

export type ReceivableDueStatus =
  | "vencido"
  | "sem_vencimento"
  | "a_vencer"
  | "nao_aplicavel";

export type FinancialEvidenceSource =
  | "REAL_RECEIVABLE"
  | "OUTPUT_DOCUMENT"
  | "ORDER_PLAN"
  | "MIXED"
  | "NONE";

export type MoneyCompareResult = "equal" | "less" | "greater" | "rounding";

export type AllocationsSection = {
  metrics: {
    documentsTotal: number;
    documentsWithItemValue: number;
    documentsWithoutItemValue: number;
    unallocated: number;
    partial: number;
    complete: number;
    overAllocated: number;
    roundingTolerance: number;
    totalDocumentValueCents: number;
    totalAllocatedToOrdersCents: number;
    totalDifferenceCents: number;
    coverageCounts: Record<AllocationCoverageStatus, number>;
  };
  samples: {
    unallocatedDocumentExternalIds: number[];
    partialDocumentExternalIds: number[];
    overAllocatedDocumentExternalIds: number[];
    roundingDocumentExternalIds: number[];
  };
  notes: string[];
};

export type AccountsReceivableLinksSection = {
  metrics: {
    documentsWithIdNfe: number;
    documentsWithReceivables: number;
    documentsWithoutReceivables: number;
    titlesOpen: number;
    titlesPartial: number;
    titlesReceived: number;
    titlesOverdue: number;
    titlesWithoutDueDate: number;
    nfeWithMultipleTitles: number;
    nfeReceivableSumDivergent: number;
    nfeReceivableSumRounding: number;
    settlementCounts: Record<ReceivableSettlementStatus, number>;
  };
  samples: {
    multiTitleNfeIds: number[];
    divergentNfeIds: number[];
    overdueReceivableExternalIds: number[];
    documentsWithoutReceivableExternalIds: number[];
  };
  notes: string[];
};

export type FinancialEvidenceSection = {
  metrics: {
    documentsEvaluated: number;
    evidenceByReceivable: number;
    evidenceByDocument: number;
    evidenceByOrderPlan: number;
    evidenceMixed: number;
    evidenceNone: number;
    doubleCountPrevented: number;
    sourceCounts: Record<FinancialEvidenceSource, number>;
  };
  samples: {
    doubleCountPreventedDocumentExternalIds: number[];
    mixedEvidenceDocumentExternalIds: number[];
  };
  notes: string[];
};

export function emptyAllocationCoverageCounts(): Record<
  AllocationCoverageStatus,
  number
> {
  return {
    nao_alocado: 0,
    parcial: 0,
    completo: 0,
    superalocado: 0,
    arredondamento: 0,
  };
}

export function emptySettlementCounts(): Record<ReceivableSettlementStatus, number> {
  return {
    aberto: 0,
    parcial: 0,
    recebido: 0,
  };
}

export function emptyEvidenceSourceCounts(): Record<FinancialEvidenceSource, number> {
  return {
    REAL_RECEIVABLE: 0,
    OUTPUT_DOCUMENT: 0,
    ORDER_PLAN: 0,
    MIXED: 0,
    NONE: 0,
  };
}

/**
 * Converte valor monetário para centavos inteiros via `roundMoney`.
 * Aceita number, string numérica ou objeto com `toNumber()` (Decimal Prisma).
 */
export function toMoneyCents(value: unknown): number {
  if (value == null) return 0;
  let n = 0;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "bigint") {
    n = Number(value);
  } else if (typeof value === "string" && value.trim()) {
    n = Number(value.replace(",", "."));
  } else if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      n = (value as { toNumber: () => number }).toNumber();
    } catch {
      n = 0;
    }
  }
  if (!Number.isFinite(n)) return 0;
  return Math.round(roundMoney(n) * 100);
}

export function moneyCentsToNumber(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return roundMoney(cents / 100);
}

/** Comparação monetária em centavos; diff de 1 centavo → rounding. */
export function compareMoneyCents(
  leftCents: number,
  rightCents: number,
  toleranceCents: number = AUDIT_MONEY_CENT_TOLERANCE
): MoneyCompareResult {
  const left = Math.trunc(leftCents);
  const right = Math.trunc(rightCents);
  const diff = Math.abs(left - right);
  if (diff === 0) return "equal";
  if (diff <= toleranceCents) return "rounding";
  return left < right ? "less" : "greater";
}

export function moneyCentsEqual(
  leftCents: number,
  rightCents: number,
  toleranceCents: number = 0
): boolean {
  return Math.abs(Math.trunc(leftCents) - Math.trunc(rightCents)) <= toleranceCents;
}

/**
 * Classifica cobertura documento × alocação a pedidos.
 * Tolerância de 1 centavo → somente "arredondamento" (não mistura com completo).
 */
export function classifyAllocationCoverage(input: {
  documentValueCents: number;
  allocatedToOrdersCents: number;
}): {
  status: AllocationCoverageStatus;
  differenceCents: number;
  reasons: string[];
} {
  const documentValueCents = Math.max(0, Math.trunc(input.documentValueCents));
  const allocatedToOrdersCents = Math.max(0, Math.trunc(input.allocatedToOrdersCents));
  const differenceCents = documentValueCents - allocatedToOrdersCents;
  const reasons: string[] = [];

  if (documentValueCents <= 0 && allocatedToOrdersCents <= 0) {
    reasons.push("Documento e alocações zerados.");
    return { status: "nao_alocado", differenceCents, reasons };
  }

  if (allocatedToOrdersCents <= 0 && documentValueCents > 0) {
    reasons.push("Documento com valor e nenhuma alocação a pedidos.");
    return { status: "nao_alocado", differenceCents, reasons };
  }

  const cmp = compareMoneyCents(documentValueCents, allocatedToOrdersCents);
  if (cmp === "equal") {
    reasons.push("Valor do documento igual à soma alocada aos pedidos.");
    return { status: "completo", differenceCents: 0, reasons };
  }
  if (cmp === "rounding") {
    reasons.push(
      `Diferença de ${Math.abs(differenceCents)} centavo(s) — classificação de arredondamento.`
    );
    return { status: "arredondamento", differenceCents, reasons };
  }
  if (allocatedToOrdersCents > documentValueCents) {
    reasons.push("Alocação aos pedidos excede o valor do documento.");
    return { status: "superalocado", differenceCents, reasons };
  }

  reasons.push("Alocação parcial: pedidos cobrem só parte do documento.");
  return { status: "parcial", differenceCents, reasons };
}

/**
 * Status de quitação do título CR (centavos).
 * aberto / parcial / recebido.
 */
export function classifyReceivableSettlement(input: {
  amountReceivableCents: number;
  amountReceivedCents: number;
  balanceReceivableCents: number;
}): {
  status: ReceivableSettlementStatus;
  reasons: string[];
} {
  const receivable = Math.max(0, Math.trunc(input.amountReceivableCents));
  const received = Math.max(0, Math.trunc(input.amountReceivedCents));
  const balance = Math.trunc(input.balanceReceivableCents);
  const reasons: string[] = [];

  if (balance <= 0 || (receivable > 0 && received >= receivable)) {
    reasons.push("Saldo zerado ou recebido >= valor do título.");
    return { status: "recebido", reasons };
  }
  if (received > 0 && balance > 0) {
    reasons.push("Há valor recebido e saldo em aberto.");
    return { status: "parcial", reasons };
  }
  reasons.push("Saldo em aberto sem recebimento.");
  return { status: "aberto", reasons };
}

export function classifyReceivableDueStatus(input: {
  dueDate: Date | null | undefined;
  referenceDate: Date;
  settlement: ReceivableSettlementStatus;
}): ReceivableDueStatus {
  if (input.settlement === "recebido") return "nao_aplicavel";
  if (!input.dueDate || Number.isNaN(input.dueDate.getTime())) {
    return "sem_vencimento";
  }
  const due = startOfLocalDay(input.dueDate).getTime();
  const today = startOfLocalDay(input.referenceDate).getTime();
  if (due < today) return "vencido";
  return "a_vencer";
}

/**
 * Divergência NF × soma dos títulos (amountReceivable).
 * 1 centavo → arredondamento; maior → divergente.
 */
export function classifyNfeVsReceivablesSum(input: {
  nfeValueCents: number;
  titlesAmountReceivableCents: number;
}): {
  status: "ok" | "arredondamento" | "divergente" | "sem_titulos" | "sem_nfe_valor";
  differenceCents: number;
  reasons: string[];
} {
  const nfe = Math.max(0, Math.trunc(input.nfeValueCents));
  const titles = Math.max(0, Math.trunc(input.titlesAmountReceivableCents));
  const differenceCents = nfe - titles;
  const reasons: string[] = [];

  if (titles <= 0) {
    reasons.push("Nenhum título CR para a NF.");
    return { status: "sem_titulos", differenceCents, reasons };
  }
  if (nfe <= 0) {
    reasons.push("NF sem valor comparável (xmlVNF/valorLiquido).");
    return { status: "sem_nfe_valor", differenceCents, reasons };
  }

  const cmp = compareMoneyCents(nfe, titles);
  if (cmp === "equal") {
    reasons.push("Soma dos títulos igual ao valor da NF.");
    return { status: "ok", differenceCents: 0, reasons };
  }
  if (cmp === "rounding") {
    reasons.push("Diferença de 1 centavo entre NF e soma dos títulos.");
    return { status: "arredondamento", differenceCents, reasons };
  }
  reasons.push("Soma dos títulos diverge do valor da NF.");
  return { status: "divergente", differenceCents, reasons };
}

/**
 * Evidência financeira sem dupla contagem.
 * Precedência: CR real > condição documentada do Documento > previsão do Pedido.
 * Documento e CR da mesma NF não somam como duas coberturas.
 */
export function resolveFinancialEvidenceWithoutDoubleCount(input: {
  receivableCents: number;
  documentCents: number;
  orderForecastCents: number;
}): {
  source: FinancialEvidenceSource;
  coveredByReceivableCents: number;
  coveredByDocumentIncrementalCents: number;
  coveredByOrderIncrementalCents: number;
  dominantCoverageCents: number;
  wouldDoubleCountIfSummed: boolean;
  reasons: string[];
} {
  const receivable = Math.max(0, Math.trunc(input.receivableCents));
  const document = Math.max(0, Math.trunc(input.documentCents));
  const orderForecast = Math.max(0, Math.trunc(input.orderForecastCents));
  const reasons: string[] = [];

  // max(CR, Doc) — não soma Documento + CR da mesma cadeia.
  const dominantDocOrCr = Math.max(receivable, document);
  const coveredByReceivableCents = receivable;
  const coveredByDocumentIncrementalCents = Math.max(0, dominantDocOrCr - receivable);
  const coveredByOrderIncrementalCents = Math.max(
    0,
    orderForecast - dominantDocOrCr
  );
  const dominantCoverageCents =
    dominantDocOrCr + coveredByOrderIncrementalCents;

  const wouldDoubleCountIfSummed =
    receivable > 0 && document > 0;

  if (wouldDoubleCountIfSummed) {
    reasons.push(
      "Documento e CR presentes: cobertura usa max(CR, Documento), não a soma."
    );
  }

  let source: FinancialEvidenceSource = "NONE";
  if (receivable > 0 && coveredByDocumentIncrementalCents > 0) {
    source = "MIXED";
    reasons.push("Evidência mista: CR real e documento além do CR.");
  } else if (receivable > 0) {
    source = "REAL_RECEIVABLE";
    reasons.push("Evidência dominante: Contas a Receber real.");
  } else if (document > 0) {
    source = "OUTPUT_DOCUMENT";
    reasons.push("Evidência dominante: condição documentada do Documento.");
  } else if (orderForecast > 0) {
    source = "ORDER_PLAN";
    reasons.push("Evidência dominante: previsão do Pedido.");
  } else {
    reasons.push("Sem evidência financeira resolvida.");
  }

  if (coveredByOrderIncrementalCents > 0 && source !== "ORDER_PLAN" && source !== "NONE") {
    reasons.push(
      "Previsão do pedido usada só no residual não coberto por CR/Documento."
    );
  }

  return {
    source,
    coveredByReceivableCents,
    coveredByDocumentIncrementalCents,
    coveredByOrderIncrementalCents,
    dominantCoverageCents,
    wouldDoubleCountIfSummed,
    reasons,
  };
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function buildEmptyAllocationsSection(): AllocationsSection {
  return {
    metrics: {
      documentsTotal: 0,
      documentsWithItemValue: 0,
      documentsWithoutItemValue: 0,
      unallocated: 0,
      partial: 0,
      complete: 0,
      overAllocated: 0,
      roundingTolerance: 0,
      totalDocumentValueCents: 0,
      totalAllocatedToOrdersCents: 0,
      totalDifferenceCents: 0,
      coverageCounts: emptyAllocationCoverageCounts(),
    },
    samples: {
      unallocatedDocumentExternalIds: [],
      partialDocumentExternalIds: [],
      overAllocatedDocumentExternalIds: [],
      roundingDocumentExternalIds: [],
    },
    notes: [
      "Valor do documento = Σ NomusStockDocumentItem.estimatedTotalValue (centavos).",
      "Alocação a pedidos = Σ OrderToCashAuditFact.allocatedValueByDocumentPrice (amostra/agregado).",
      "Tolerância de 1 centavo só classifica arredondamento — não altera regras oficiais.",
    ],
  };
}

export function buildEmptyAccountsReceivableLinksSection(): AccountsReceivableLinksSection {
  return {
    metrics: {
      documentsWithIdNfe: 0,
      documentsWithReceivables: 0,
      documentsWithoutReceivables: 0,
      titlesOpen: 0,
      titlesPartial: 0,
      titlesReceived: 0,
      titlesOverdue: 0,
      titlesWithoutDueDate: 0,
      nfeWithMultipleTitles: 0,
      nfeReceivableSumDivergent: 0,
      nfeReceivableSumRounding: 0,
      settlementCounts: emptySettlementCounts(),
    },
    samples: {
      multiTitleNfeIds: [],
      divergentNfeIds: [],
      overdueReceivableExternalIds: [],
      documentsWithoutReceivableExternalIds: [],
    },
    notes: [
      "CR liga-se à NF via NomusAccountsReceivable.sourceInvoiceId = NomusStockDocument.idNfe.",
      "Documento não é FK de CR; caminho oficial é Documento → NF → CR.",
      "Este auditor não altera títulos nem regras de Contas a Receber.",
    ],
  };
}

export function buildEmptyFinancialEvidenceSection(): FinancialEvidenceSection {
  return {
    metrics: {
      documentsEvaluated: 0,
      evidenceByReceivable: 0,
      evidenceByDocument: 0,
      evidenceByOrderPlan: 0,
      evidenceMixed: 0,
      evidenceNone: 0,
      doubleCountPrevented: 0,
      sourceCounts: emptyEvidenceSourceCounts(),
    },
    samples: {
      doubleCountPreventedDocumentExternalIds: [],
      mixedEvidenceDocumentExternalIds: [],
    },
    notes: [
      "Precedência: CR real > condição documentada do Documento > previsão do Pedido.",
      "Documento e CR da mesma NF não contam como duas coberturas (usa max, não soma).",
      "Pedido, Documento, NF e CR não devem ser somados como recebíveis diferentes.",
    ],
  };
}
