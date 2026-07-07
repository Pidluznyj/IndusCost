/**
 * Top cards de Centro de Custo para o Relatório Presidencial.
 * Deriva exclusivamente de buildFinanceCostCenterDashboardDefault + mapa de centros.
 */
import { roundMoney, safeRatio } from "./financeAccountsPayableDashboard.js";
import type { FinanceCostCenterDashboardByCostCenterRow } from "./financeCostCenterDashboard.js";
import {
  buildCostCenterExpenseMapCards,
  expenseMapCategoryLabel,
  filterCostCenterExpenseMapCards,
  type CostCenterExpenseMapCard,
} from "./financeCostCenterExpenseMap.js";
import type { FinanceCostCenterDto } from "./financeCostCenters.js";
import { formatFinanceKpiCurrency } from "./financeKpiFormat.js";

export const EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT = 12;

export type FinanceExecutiveReportCostCenterTopCard = {
  id: string;
  code: string;
  name: string;
  parentName: string | null;
  category: string;
  status: "ACTIVE" | "INACTIVE";
  totalAmount: number;
  overdueAmount: number;
  openAmount: number;
  upcomingAmount: number;
  paidAmount: number;
  participationPercent: number;
  titlesCount: number;
};

export type FinanceExecutiveReportCostCenterTopCardsSummary = {
  cardsCount: number;
  topAmount: number;
  topSharePercent: number;
  classifiedTotal: number;
  headline: string;
};

export function mapCostCenterExpenseMapCardToExecutiveTopCard(
  card: CostCenterExpenseMapCard
): FinanceExecutiveReportCostCenterTopCard {
  return {
    id: card.costCenterId,
    code: card.code,
    name: card.name,
    parentName: card.parentName,
    category: expenseMapCategoryLabel(card.category),
    status: card.status,
    totalAmount: card.amount,
    overdueAmount: card.overdueAmount,
    openAmount: card.openAmount,
    upcomingAmount: card.upcomingAmount,
    paidAmount: card.paidAmount,
    participationPercent: card.sharePercentage,
    titlesCount: card.titlesCount,
  };
}

export function buildExecutiveReportCostCenterTopCards(
  byCostCenter: FinanceCostCenterDashboardByCostCenterRow[],
  centers: FinanceCostCenterDto[],
  options: {
    limit?: number;
    classifiedTotal?: number;
  } = {}
): {
  topCards: FinanceExecutiveReportCostCenterTopCard[];
  summary: FinanceExecutiveReportCostCenterTopCardsSummary;
} {
  const limit = options.limit ?? EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT;
  const sorted = buildCostCenterExpenseMapCards(byCostCenter, centers);
  const withValue = filterCostCenterExpenseMapCards(sorted, "withValue");
  const topCards = withValue
    .slice(0, limit)
    .map(mapCostCenterExpenseMapCardToExecutiveTopCard);

  const topAmount = roundMoney(topCards.reduce((sum, card) => sum + card.totalAmount, 0));
  const classifiedTotal =
    options.classifiedTotal ??
    roundMoney(withValue.reduce((sum, card) => sum + card.amount, 0));
  const topSharePercent = roundMoney(safeRatio(topAmount, classifiedTotal) * 100);

  const headline =
    topCards.length === 0
      ? "Nenhum centro de custo com valor classificado no período filtrado."
      : `Os ${topCards.length} maiores centros de custo concentram ${formatFinanceKpiCurrency(topAmount)}, representando ${topSharePercent.toFixed(1).replace(".", ",")}% do gasto classificado no período filtrado.`;

  return {
    topCards,
    summary: {
      cardsCount: topCards.length,
      topAmount,
      topSharePercent,
      classifiedTotal,
      headline,
    },
  };
}

export function buildEmptyExecutiveReportCostCenterTopCards(): {
  topCards: FinanceExecutiveReportCostCenterTopCard[];
  summary: FinanceExecutiveReportCostCenterTopCardsSummary;
} {
  return {
    topCards: [],
    summary: {
      cardsCount: 0,
      topAmount: 0,
      topSharePercent: 0,
      classifiedTotal: 0,
      headline: "Nenhum centro de custo com valor classificado no período filtrado.",
    },
  };
}
