/**
 * Tipos e helpers puros do fechamento por recebimento — seguros para frontend.
 */
import { roundMoney } from "./commission-money.shared.js";
import type {
  CommissionLedgerInclusionType,
  ReceiptClosingCarryoverSection,
  ReceiptClosingCommissionComposition,
} from "./commissionReceiptCoverage.shared.js";

export type ReceiptClosingPageMode = "EMPTY" | "PREVIEW" | "CLOSED";

/** Chave do bucket de resumo para linhas sem vendedor comissionável ou excluídas por regra. */
export const RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY = "—";

export const RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_LABEL = "Sem vendedor / Excluído";

/** Chave do bucket quando o pedido Nomus não tem vendedor comissionável. */
export const RECEIPT_CLOSING_NO_SELLER_GROUP_KEY = "no-seller";

const RECEIPT_CLOSING_SELLER_EXCLUDED_STATUSES = new Set(["CUSTOMER_EXCLUDED"]);

export const RECEIPT_CLOSING_GROUP_COMPANY_STATUS = "GROUP_COMPANY_EXCLUDED" as const;

export function isReceiptClosingGroupCompanyLine(line: { status: string }): boolean {
  return line.status === RECEIPT_CLOSING_GROUP_COMPANY_STATUS;
}

export function isReceiptClosingManagerialLine(line: { status: string }): boolean {
  return !isReceiptClosingGroupCompanyLine(line);
}

export function partitionReceiptClosingLinesByGroupCompany<T extends { status: string }>(
  lines: T[]
): { managerialLines: T[]; groupCompanyAuditLines: T[] } {
  const managerialLines: T[] = [];
  const groupCompanyAuditLines: T[] = [];
  for (const line of lines) {
    if (isReceiptClosingGroupCompanyLine(line)) {
      groupCompanyAuditLines.push(line);
    } else {
      managerialLines.push(line);
    }
  }
  return { managerialLines, groupCompanyAuditLines };
}

export function isReceiptClosingSellerExcludedFromCommission(status: string): boolean {
  return RECEIPT_CLOSING_SELLER_EXCLUDED_STATUSES.has(status);
}

/** Chave de agrupamento do resumo Por vendedor (não altera vendedor raw do detalhe). */
export function resolveReceiptClosingSellerGroupKey(line: {
  status: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId?: number | null;
  rawSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string {
  if (isReceiptClosingSellerExcludedFromCommission(line.status)) {
    return RECEIPT_CLOSING_UNASSIGNED_SELLER_GROUP_KEY;
  }
  if (line.canonicalSellerId) return line.canonicalSellerId;
  if (line.sellerResolutionStatus === "SELLER_UNRESOLVED" && line.rawSellerId != null) {
    return `nomus-unresolved:${line.rawSellerId}`;
  }
  if (line.sellerResolutionStatus === "NO_SELLER") {
    return RECEIPT_CLOSING_NO_SELLER_GROUP_KEY;
  }
  return (
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
  /**
   * Quantidade de CRs da NF do título (todos, recebidos ou não no mês) — denominador
   * da coluna "Parcela" (ex.: 2/3). Preenchido no servidor por
   * `enrichReceiptClosingPageInstallments`; null quando não dá para afirmar com
   * segurança (ver commissionReceiptInstallment.shared.ts).
   */
  installmentTotal?: number | null;
  settlementDate: string | null;
  /** Dia civil do recebimento que definiu a competência. Não é a baixa. */
  receiptDate?: string | null;
  dueDate: string | null;
  customerId: string | null;
  customerExternalId: number | null;
  customerName: string | null;
  orderCode: string | null;
  localOrderId: string | null;
  linkResolutionSource?: string | null;
  linkResolutionStatus?: string | null;
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
  /** Valor original do CR (`amountReceivable` / nominal). */
  receivableOriginalAmount?: number;
  /** Principal comissionável = min(recebido, original). */
  commissionPrincipalAmount?: number;
  /** Encargos financeiros ignorados (recebido − original, se > 0). */
  ignoredFinancialChargesAmount?: number;
  auditFlags?: string[];
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
  /** Eventos de recebimento contemplados pela linha (auditoria de cobertura). */
  receiptExternalIds?: number[];
  /** Competência natural (mês do receiptDate); ausente = a do fechamento. */
  naturalYear?: number | null;
  naturalMonth?: number | null;
  /** NORMAL ou pendência de período anterior incluída neste fechamento. */
  inclusionType?: CommissionLedgerInclusionType;
};

export type ReceiptClosingApiSellerRow = {
  /** Chave estável de agrupamento — usada no filtro do detalhamento. */
  sellerGroupKey: string;
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
  /** Linhas gerenciais (exclui empresas do grupo). */
  lines: ReceiptClosingApiLine[];
  /** Empresas do grupo — somente para auditoria técnica opcional na UI. */
  groupCompanyAuditLines: ReceiptClosingApiLine[];
  /** Pendências de períodos anteriores (prévia de competência oficial IndusCost). */
  pendingCarryover?: ReceiptClosingCarryoverSection | null;
  /** Comissão da competência atual + pendências anteriores = total do fechamento. */
  composition?: ReceiptClosingCommissionComposition;
};

/** Pendência de período anterior (não NORMAL)? */
export function isReceiptClosingCarryoverLine(line: {
  inclusionType?: CommissionLedgerInclusionType | null;
}): boolean {
  return line.inclusionType != null && line.inclusionType !== "NORMAL";
}

/**
 * Chave de "recebido único": o título na competência. Linha normal = só o CR
 * (comportamento histórico); pendência = CR + tipo + competência natural — outro
 * evento do mesmo título, que não pode ser deduplicado contra a linha normal.
 */
export function receiptClosingReceivedAnchorKey(line: {
  nomusReceivableId: number | null;
  inclusionType?: CommissionLedgerInclusionType | null;
  naturalYear?: number | null;
  naturalMonth?: number | null;
}): string | null {
  if (line.nomusReceivableId == null) return null;
  if (!isReceiptClosingCarryoverLine(line)) return String(line.nomusReceivableId);
  return `${line.nomusReceivableId}|${line.inclusionType}|${line.naturalYear ?? ""}-${line.naturalMonth ?? ""}`;
}

/** Composição da comissão final do fechamento (competência atual × pendências). */
export function buildReceiptClosingCommissionComposition(
  lines: ReadonlyArray<Pick<ReceiptClosingApiLine, "status" | "releasedCommissionAmount" | "uniqueReceivedAmount" | "inclusionType">>
): ReceiptClosingCommissionComposition {
  let current = 0;
  let carryover = 0;
  let carryoverLineCount = 0;
  let carryoverReceived = 0;
  for (const line of lines) {
    const isCarryover = isReceiptClosingCarryoverLine(line);
    if (isCarryover) {
      carryoverLineCount += 1;
      carryoverReceived = roundMoney(carryoverReceived + line.uniqueReceivedAmount);
    }
    if (line.status !== "COMMISSIONABLE") continue;
    if (isCarryover) carryover = roundMoney(carryover + line.releasedCommissionAmount);
    else current = roundMoney(current + line.releasedCommissionAmount);
  }
  return {
    currentCompetenceCommission: current,
    carryoverCommission: carryover,
    totalCommission: roundMoney(current + carryover),
    carryoverLineCount,
    carryoverReceivedAmount: carryoverReceived,
  };
}

/** Soma dos valores exibidos na coluna "Valor recebido" do detalhamento (âncoras por título). */
export function sumUniqueReceivedFromLines(lines: ReceiptClosingApiLine[]): number {
  return lines.reduce((sum, line) => roundMoney(sum + line.uniqueReceivedAmount), 0);
}
