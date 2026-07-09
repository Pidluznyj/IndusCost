/**
 * Previsão oficial — agrega linhas do motor de recebimento (títulos em aberto).
 * Reutiliza classificação e cards do fechamento por recebimento.
 */
import type { CommissionReceiptPreviewLine, CommissionReceiptPreviewResult } from "./commissionReceiptEngine.js";
import { roundMoney } from "./commission-money.js";
import {
  buildReceiptClosingMaterializationCards,
  buildReceiptClosingMaterializationSummary,
  mapPreviewLineToApiLine,
  markReceivableReceivedAnchors,
} from "./commissionReceiptClosingApi.js";
import {
  partitionReceiptClosingLinesByGroupCompany,
  type ReceiptClosingMaterializationSummary,
  type ReceiptClosingReconciliationSummary,
} from "./commissionReceiptClosingApi.shared.js";
import {
  aggregateReceivableForecastFromRows,
  type CommissionReceivableForecastQuery,
  type ReceivableForecastSummary,
} from "./commissionReceivableForecast.js";
import { buildVisualAuditRow, type VisualAuditRowInput } from "./commissionVisualAudit.js";

export const COMMISSION_FORECAST_SCOPE_NOTE =
  "Previsão por vencimento (dueDate) de títulos em aberto. O fechamento oficial usa settlementDate quando o título é recebido.";

export const COMMISSION_FORECAST_RECONCILIATION_NOTE =
  "Esta aba é previsão; o fechamento oficial ocorre quando os títulos são recebidos. Regras de vendedor Nomus, cliente excluído, empresa do grupo e schedules materializados são as mesmas do Fechamento do mês.";

export type ReceivableForecastOfficialPayload = ReceivableForecastSummary & {
  scopeNote: string;
  reconciliationNote: string;
  materializationSummary: ReceiptClosingMaterializationSummary;
  officialCards: ReturnType<typeof buildReceiptClosingMaterializationCards>;
};

function receiptLineToVisualAuditInput(line: CommissionReceiptPreviewLine): VisualAuditRowInput {
  return {
    lineId: line.ledgerLineKey,
    recordId: line.ledgerLineKey,
    scheduleId: line.commissionReceivableScheduleId ?? line.ledgerLineKey,
    commissionPersonId: line.canonicalSellerId ?? "—",
    commissionPersonName: line.canonicalSellerName ?? line.rawSellerName ?? "—",
    customerName: line.customerName,
    orderCode: line.orderCode,
    nfeNumber: line.nfeNumber,
    nomusNfeId: line.nomusNfeId,
    confirmedAt: line.dueDate,
    documentKey: line.ledgerLineKey,
    documentBaseAmount: line.commissionableBaseAmount,
    documentCommissionTotal: line.expectedCommissionAmount,
    itemBaseAmount: line.commissionableBaseAmount,
    itemCommissionAmount: line.expectedCommissionAmount,
    itemRatePercent: line.ratePercent,
    productCode: line.productCode,
    nomusReceivableId: line.nomusReceivableId,
    installmentNumber: line.installmentNumber,
    dueDate: line.dueDate,
    settlementDate: line.settlementDate || null,
    receivableAmount: line.receivableAmount,
    receivedAmount: 0,
    openBalance: line.receivedAmount,
    allocationPercent: line.receivedSharePercent,
    commissionExpected: line.expectedCommissionAmount,
    commissionReleased: 0,
    hasArLink: true,
    hasSchedule: line.commissionReceivableScheduleId != null,
    customerNoCommission: line.status === "CUSTOMER_EXCLUDED",
    isCommissionable: line.status === "COMMISSIONABLE",
    exclusionReason: line.exclusionReason,
    exclusionRuleId: line.exclusionRuleId,
  };
}

export function buildReceivableForecastOfficialPayload(
  preview: CommissionReceiptPreviewResult,
  query: CommissionReceivableForecastQuery = {},
  ref: Date = new Date()
): ReceivableForecastOfficialPayload {
  const visualRows = preview.lines.map((line) =>
    buildVisualAuditRow(receiptLineToVisualAuditInput(line))
  );
  const summary = aggregateReceivableForecastFromRows(visualRows, query, ref);

  const apiLines = markReceivableReceivedAnchors(preview.lines.map(mapPreviewLineToApiLine));
  const { managerialLines, groupCompanyAuditLines } =
    partitionReceiptClosingLinesByGroupCompany(apiLines);

  const groupAuditOpen = groupCompanyAuditLines.reduce(
    (sum, line) => roundMoney(sum + line.receivedAmount),
    0
  );

  const reconciliation: ReceiptClosingReconciliationSummary = {
    excludedCustomerCount: new Set(
      managerialLines
        .filter((l) => l.status === "CUSTOMER_EXCLUDED" && l.nomusReceivableId != null)
        .map((l) => l.nomusReceivableId)
    ).size,
    groupCompanyExcludedCount: groupCompanyAuditLines.length,
    groupCompanyExcludedReceivedAmount: groupAuditOpen,
    receivablesWithoutScheduleCount: new Set(
      managerialLines
        .filter((l) => l.status === "NO_SCHEDULE" && l.nomusReceivableId != null)
        .map((l) => l.nomusReceivableId)
    ).size,
    staleScheduleCount: managerialLines.filter((l) => l.status === "STALE_SCHEDULE").length,
    divergentReceivableCount: new Set(
      managerialLines
        .filter(
          (l) =>
            l.nomusReceivableId != null &&
            ["NO_SALES_LINK", "NO_SCHEDULE", "NO_SELLER", "SELLER_UNRESOLVED", "ERROR"].includes(
              l.status
            )
        )
        .map((l) => l.nomusReceivableId)
    ).size,
    duplicateReceivedCount: 0,
    comparable: false,
    nomusBase: null,
    nomusCommission: null,
    diffCommissionFinal: null,
    diffCommissionBeforeExclusions: null,
    diffExplanation: null,
  };

  const officialCards = buildReceiptClosingMaterializationCards(
    managerialLines,
    "PREVIEW",
    reconciliation,
    groupAuditOpen
  );

  const materializationSummary = buildReceiptClosingMaterializationSummary({
    managerialLines,
    groupCompanyAuditLines,
    reconciliation,
    year: preview.year,
    month: preview.month,
    totalReceivedAmount: officialCards.totalReceivedAmount,
    totalExpectedCommission: preview.totalExpectedCommission,
    totalReleasedCommission: preview.totalReleasedCommission,
  });

  return {
    ...summary,
    scopeNote: COMMISSION_FORECAST_SCOPE_NOTE,
    reconciliationNote: COMMISSION_FORECAST_RECONCILIATION_NOTE,
    materializationSummary,
    officialCards,
  };
}
