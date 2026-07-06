/**
 * Cards da Gestão de Pedidos — delegam ao Status Logístico BI (fórmula Power BI).
 * Mantém aliases Management* para compatibilidade com rotas e componentes existentes.
 */
export {
  BI_LOGISTIC_STATUS_CARD_IDS as MANAGEMENT_STATUS_CARD_IDS,
  BI_LOGISTIC_STATUS_CARDS,
  BI_LOGISTIC_STATUS_CARDS as MANAGEMENT_STATUS_CARDS,
  type BiLogisticStatusCardId as ManagementStatusCardId,
  type SalesOrderBiLogisticStatusLabel,
  type BiLogisticDashboardCard as ManagementDashboardCard,
  type BiLogisticCardReconciliation as ManagementCardReconciliation,
  buildSalesOrderBiLogisticStatus,
  buildSalesOrderLogisticStatus,
  biLogisticLabelToCardId,
  getBiLogisticCardLabel as getManagementStatusCardLabel,
  getBiLogisticCardHint as getManagementStatusCardHint,
  getBiLogisticCardLabel as getManagementCardGridLabel,
  getBiLogisticCardLabel as getManagementStatusFilterLabel,
  isBiLogisticStatusCardId as isManagementStatusCardId,
  emptyBiLogisticStatusCardCounts as emptyManagementStatusCardCounts,
  emptyBiLogisticStatusCardAmounts as emptyManagementStatusCardAmounts,
  buildBiLogisticStatusCardMetrics as buildManagementStatusCardMetrics,
  buildBiLogisticDashboardCards as buildManagementDashboardCards,
  buildBiLogisticDashboardCardsFromAggregates as buildManagementDashboardCardsFromAggregates,
  reconcileBiLogisticStatusCards as reconcileManagementStatusCards,
  sumBiLogisticCardCounts as sumManagementStatusCardCounts,
  sumBiLogisticCardAmounts as sumManagementStatusCardAmounts,
} from "./salesOrderLogisticStatus.js";

import type { BiLogisticCardReconciliation } from "./salesOrderLogisticStatus.js";

export function assertManagementCardsReconciliation(
  reconciliation: BiLogisticCardReconciliation
): void {
  if (!reconciliation.countMatches) {
    throw new Error(
      `Reconciliação de cards: diferença de quantidade ${reconciliation.countDifference}`
    );
  }
  if (!reconciliation.valueMatches) {
    throw new Error(
      `Reconciliação de cards: diferença de valor ${reconciliation.valueDifference}`
    );
  }
}
