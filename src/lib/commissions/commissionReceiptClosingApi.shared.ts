/**
 * Tipos e helpers puros do fechamento por recebimento — seguros para frontend.
 */
import { roundMoney } from "./commission-money.shared.js";

export type ReceiptClosingPageMode = "EMPTY" | "PREVIEW" | "CLOSED";

/** Chave do bucket de resumo para linhas sem vendedor comissionável ou excluídas por regra. */
export const RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY = "—";

export const RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL = "Sem vendedor / Excluído";

const RECEIPT_CLOSING_SELLER_EXCLUDED_STATUSES = new Set([
  "CUSTOMER_EXCLUDED",
  "GROUP_COMPANY_EXCLUDED",
]);

export function isReceiptClosingSellerExcludedFromCommission(status: string): boolean {
  return RECEIPT_CLOSING_SELLER_EXCLUDED_STATUSES.has(status);
}

/** Chave de agrupamento do resumo Por vendedor (não altera vendedor raw do detalhe). */
export function resolveReceiptClosingSellerGroupKey(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerName: string | null;
}): string {
  if (isReceiptClosingSellerExcludedFromCommission(line.status)) {
    return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
  }
  return (
    line.canonicalSellerId ??
    line.canonicalSellerName ??
    line.rawSellerName ??
    RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY
  );
}

export type ReceiptClosingMaterializationCards = {
  totalReceivedAmount: number;
  receivedWithScheduleAmount: number;
  receivedExcludedCustomerAmount: number;
  receivedGroupCompanyExcludedAmount: number;
  receivedWithoutScheduleAmount: number;
  commissionableBaseAmount: number;
  grossCommissionAmount: number;
  excludedCommissionAmount: number;
  finalCommissionAmount: number;
  nomusCommissionDiff: number | null;
  nomusDiffExplanation: string | null;
  reportStatus: "PREVIEW" | "CLOSED";
};

/** Mensagem exibida na tela quando há CR recebidos sem schedule materializado. */
export const COMMISSION_RECEIPT_MATERIALIZATION_PENDING_MESSAGE =
  "Existem títulos recebidos sem schedule de comissão. Rode a materialização para concluir a prévia.";

export type ReceiptClosingMaterializationSummary = {
  totalReceivablesCount: number;
  receivablesWithScheduleCount: number;
  receivablesWithoutScheduleCount: number;
  excludedCustomerCount: number;
  groupCompanyExcludedCount: number;
  sellerUnresolvedCount: number;
  staleScheduleCount: number;
  totalReceivedAmount: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  pendingMaterialization: boolean;
  pendingMaterializationMessage: string | null;
  rebuildScriptHint: string | null;
};

export type ReceiptClosingReconciliationSummary = {
  nomusBase: number | null;
  nomusCommission: number | null;
  diffCommissionFinal: number | null;
  diffCommissionBeforeExclusions: number | null;
  diffExplanation: string | null;
  excludedCustomerCount: number;
  groupCompanyExcludedCount: number;
  groupCompanyExcludedReceivedAmount: number;
  receivablesWithoutScheduleCount: number;
  staleScheduleCount: number;
  divergentReceivableCount: number;
  duplicateReceivedCount: number;
  comparable: boolean;
};

export type ReceiptClosingApiLine = {
  lineKey: string;
  nomusReceivableId: number | null;
  receivableNumber: string | null;
  installmentNumber: number | null;
  settlementDate: string | null;
  dueDate: string | null;
  customerId: string | null;
  customerExternalId: number | null;
  customerName: string | null;
  orderCode: string | null;
  localOrderId: string | null;
  nomusNfeId: number | null;
  nfeNumber: string | null;
  localItemId: string | null;
  nomusOrderItemId: number | null;
  productCode: string | null;
  productName: string | null;
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string | null;
  receivedAmount: number;
  /** Valor recebido exibido na linha — zero em linhas duplicadas do mesmo título. */
  uniqueReceivedAmount: number;
  commissionableBaseAmount: number;
  ratePercent: number;
  expectedCommissionAmount: number;
  releasedCommissionAmount: number;
  grossCommissionAmount: number;
  scheduledCommissionAmount: number | null;
  commissionReceivableScheduleId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  exclusionReason: string | null;
  status: string;
  statusReason: string | null;
  source: string;
};

export type ReceiptClosingApiSellerRow = {
  sellerId: string | null;
  sellerName: string | null;
  receivableCount: number;
  receivedAmount: number;
  commissionableBase: number;
  grossCommission: number;
  excludedCommission: number;
  expectedCommission: number;
  releasedCommission: number;
  exceptionCount: number;
};

export type ReceiptClosingSnapshotShared = {
  closingId: string;
  year: number;
  month: number;
  status: string;
  calculationHash: string | null;
  totalReceivedAmount: number;
  totalCommissionableBase: number;
  totalExpectedCommission: number;
  totalReleasedCommission: number;
  totalExcludedAmount: number;
  totalExceptionAmount: number;
  lineCount: number;
  closedAt: string | null;
  closedBy: string | null;
  notes: string | null;
};

export type ReceiptClosingPagePayload = {
  year: number;
  month: number;
  mode: ReceiptClosingPageMode;
  exportMode: "PREVIEW" | "CLOSED" | "NONE";
  closing: ReceiptClosingSnapshotShared | null;
  canApply: boolean;
  applyBlockedReason: string | null;
  criticalDivergence: boolean;
  criticalDivergenceReason: string | null;
  requiresCriticalConfirmation: boolean;
  cards: ReceiptClosingMaterializationCards;
  materializationSummary: ReceiptClosingMaterializationSummary;
  reconciliation: ReceiptClosingReconciliationSummary;
  summary: {
    totalReceivables: number;
    totalReceivedAmount: number;
    totalCommissionableBase: number;
    totalExpectedCommission: number;
    totalReleasedCommission: number;
    totalExcludedAmount: number;
    totalExceptionAmount: number;
    countByStatus: Record<string, number>;
  };
  bySeller: ReceiptClosingApiSellerRow[];
  lines: ReceiptClosingApiLine[];
};

/** Soma dos valores exibidos na coluna "Valor recebido" do detalhamento (âncoras por título). */
export function sumUniqueReceivedFromLines(lines: ReceiptClosingApiLine[]): number {
  return lines.reduce((sum, line) => roundMoney(sum + line.uniqueReceivedAmount), 0);
}
