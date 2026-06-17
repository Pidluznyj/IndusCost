import type { BillingDashboardTab } from "./executiveDashboardTypes.js";
import type { FinanceArDashboardCards } from "./financeAccountsReceivableDashboardTypes.js";
import type { FinanceApDashboardCards } from "./financeAccountsPayableDashboardTypes.js";
import type { FinanceCashFlowDashboardPayload } from "./financeCashFlowDashboardTypes.js";
import type {
  FinanceExecutiveReportNarrative,
  FinanceExecutiveReportOfficialSourceKey,
} from "./financeExecutiveReportTypes.js";
import {
  formatExecutiveReportCurrency,
  formatExecutiveReportPercent,
} from "./financeExecutiveReportUtils.js";
import type { SalesOrdersDashboardTab } from "./executiveDashboardTypes.js";

function section(
  id: string,
  title: string,
  body: string,
  sourceRefs: FinanceExecutiveReportOfficialSourceKey[]
) {
  return { id, title, body, sourceRefs };
}

export function buildFinanceExecutiveReportNarrative(input: {
  billingTab: BillingDashboardTab | null;
  arCards: FinanceArDashboardCards | null;
  apCards: FinanceApDashboardCards | null;
  cashFlow: FinanceCashFlowDashboardPayload | null;
  salesOrdersTab: SalesOrdersDashboardTab | null;
}): FinanceExecutiveReportNarrative {
  const sections: FinanceExecutiveReportNarrative["sections"] = [];

  const achievement = input.billingTab?.target.achievementPercent ?? null;
  const target = input.billingTab?.target.target ?? null;
  const actual = input.billingTab?.target.actual ?? null;
  if (achievement != null && target != null && actual != null) {
    const direction =
      achievement >= 100 ? "acima" : achievement === 100 ? "em linha com" : "abaixo";
    sections.push(
      section(
        "billing-target",
        "Faturamento vs meta",
        `O faturamento do mês está ${formatExecutiveReportPercent(Math.abs(achievement - 100))} ${direction} da meta (${formatExecutiveReportCurrency(actual)} de ${formatExecutiveReportCurrency(target)}).`,
        ["billing"]
      )
    );
  } else if (target == null) {
    sections.push(
      section(
        "billing-target-missing",
        "Meta de faturamento",
        "Meta do mês indisponível — não há base confiável para o período selecionado.",
        ["billing"]
      )
    );
  }

  const projected = input.billingTab?.projection?.projectedMonth ?? null;
  const projectedAchievement =
    projected != null && target != null && target > 0
      ? (projected / target) * 100
      : null;
  if (projectedAchievement != null) {
    sections.push(
      section(
        "billing-year-projection",
        "Projeção anual",
        `A projeção do mês indica ${formatExecutiveReportPercent(projectedAchievement)} da meta mensal (${formatExecutiveReportCurrency(projected)} projetados).`,
        ["billing", "salesOrderRules"]
      )
    );
  }

  const negativeMonths = input.cashFlow?.cards.negativeBalanceMonthsCount ?? 0;
  if (negativeMonths > 0) {
    sections.push(
      section(
        "cashflow-negative-months",
        "Fluxo de caixa",
        `O fluxo projetado indica saldo líquido negativo em ${negativeMonths} mês(es) no horizonte analisado.`,
        ["cashFlow"]
      )
    );
  }

  const openAr = input.arCards?.totalOpenAmount ?? null;
  if (openAr != null && openAr > 0) {
    sections.push(
      section(
        "ar-open",
        "Contas a receber",
        `O contas a receber em aberto representa ${formatExecutiveReportCurrency(openAr)}.`,
        ["accountsReceivable"]
      )
    );
  }

  const openAp = input.apCards?.totalOpenAmount ?? null;
  if (openAp != null && openAp > 0) {
    sections.push(
      section(
        "ap-open",
        "Contas a pagar",
        `O contas a pagar em aberto representa ${formatExecutiveReportCurrency(openAp)}.`,
        ["accountsPayable"]
      )
    );
  }

  const salesAchievement = input.salesOrdersTab?.target.achievementPercent ?? null;
  const annualTarget = input.salesOrdersTab?.targets?.annual?.target ?? null;
  const annualProjected = input.salesOrdersTab?.projection.annualProjection ?? null;
  if (annualProjected != null && annualTarget != null && annualTarget > 0) {
    sections.push(
      section(
        "sales-annual",
        "Pedidos de venda",
        `A projeção anual de pedidos indica ${formatExecutiveReportPercent((annualProjected / annualTarget) * 100)} da meta anual.`,
        ["salesOrders"]
      )
    );
  } else if (salesAchievement != null) {
    sections.push(
      section(
        "sales-month",
        "Pedidos do mês",
        `Pedidos do mês atingem ${formatExecutiveReportPercent(salesAchievement)} da meta comercial.`,
        ["salesOrders"]
      )
    );
  }

  return { sections };
}
