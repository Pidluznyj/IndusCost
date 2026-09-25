/**
 * Classificação read-only da cobertura AR × recebimento × schedule.
 * Não grava, não sincroniza e não usa join aproximado.
 */

export const RECEIPT_COVERAGE_CLASSIFICATIONS = [
  "OK",
  "AR_RECEIVED_WITHOUT_RECEIPT",
  "RECEIPT_WITHOUT_AR",
  "RECEIPT_AMOUNT_MISMATCH",
  "SCHEDULE_MISSING",
  "RECEIPT_OUTSIDE_EXPECTED_COMPETENCE",
  "MULTIPLE_RECEIPTS_OK",
  "NOT_IN_LOCAL_SNAPSHOT",
] as const;

export type ReceiptCoverageClassification = (typeof RECEIPT_COVERAGE_CLASSIFICATIONS)[number];

export type ReceiptCoverageAr = {
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number | null;
  settlementDate: string | null;
};

export type ReceiptCoverageEvent = {
  externalId: number;
  receiptDate: string;
  receivedAmount: number;
};

export type ReceiptCoverageInput = {
  receivableExternalId: number;
  ar: ReceiptCoverageAr | null;
  receipts: readonly ReceiptCoverageEvent[];
  scheduleCount: number;
  /** `YYYY-MM`. Ausente = não avalia competência. */
  expectedCompetenceMonth?: string | null;
};

export type ReceiptCoverageResult = {
  receivableExternalId: number;
  classification: ReceiptCoverageClassification;
  reason: string;
  receiptCount: number;
  receiptAmount: number;
  scheduleCount: number;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthKey(receiptDate: string): string | null {
  const match = /^(\d{4}-\d{2})/.exec(receiptDate);
  return match ? match[1]! : null;
}

function arLooksReceived(ar: ReceiptCoverageAr): boolean {
  return ar.amountReceived > 0.009 || ar.settlementDate != null;
}

export function classifyReceivableReceiptCoverage(input: ReceiptCoverageInput): ReceiptCoverageResult {
  const receiptAmount = roundMoney(input.receipts.reduce((sum, row) => sum + row.receivedAmount, 0));
  const base = {
    receivableExternalId: input.receivableExternalId,
    receiptCount: input.receipts.length,
    receiptAmount,
    scheduleCount: input.scheduleCount,
  };

  if (!input.ar && input.receipts.length > 0) {
    return {
      ...base,
      classification: "RECEIPT_WITHOUT_AR",
      reason: "Há NomusReceivableReceipt sem NomusAccountsReceivable com o mesmo externalId.",
    };
  }
  if (!input.ar) {
    return {
      ...base,
      classification: "NOT_IN_LOCAL_SNAPSHOT",
      reason: "O CR não está em NomusAccountsReceivable nem em NomusReceivableReceipt.",
    };
  }
  if (arLooksReceived(input.ar) && input.receipts.length === 0) {
    return {
      ...base,
      classification: "AR_RECEIVED_WITHOUT_RECEIPT",
      reason: "O título indica recebimento ou baixa e não há evento em NomusReceivableReceipt.",
    };
  }
  if (input.receipts.length > 0 && input.scheduleCount === 0) {
    return {
      ...base,
      classification: "SCHEDULE_MISSING",
      reason: "Há recebimento real e não há CommissionReceivableSchedule para o CR.",
    };
  }
  if (input.receipts.length > 0 && Math.abs(receiptAmount - roundMoney(input.ar.amountReceived)) > 0.01) {
    return {
      ...base,
      classification: "RECEIPT_AMOUNT_MISMATCH",
      reason: "A soma de receivedAmount difere de NomusAccountsReceivable.amountReceived.",
    };
  }
  const expected = input.expectedCompetenceMonth ?? null;
  if (expected && input.receipts.length > 0 && !input.receipts.some((row) => monthKey(row.receiptDate) === expected)) {
    return {
      ...base,
      classification: "RECEIPT_OUTSIDE_EXPECTED_COMPETENCE",
      reason: `Nenhum receiptDate cai em ${expected}. A baixa não substitui a competência.`,
    };
  }
  if (input.receipts.length > 1) {
    return {
      ...base,
      classification: "MULTIPLE_RECEIPTS_OK",
      reason: "O CR preserva mais de um evento de recebimento.",
    };
  }
  return {
    ...base,
    classification: "OK",
    reason: input.receipts.length === 0
      ? "Título em aberto, sem baixa e sem evento de recebimento."
      : "AR, recebimento e schedule cobrem o CR.",
  };
}
