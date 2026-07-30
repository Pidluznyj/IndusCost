import type { BillingDashboardTab } from "./executiveDashboardTypes.js";
import type { BillingAuditResult } from "./financeBillingAuditTypes.js";
import type { FinanceBillingComparisonPayload } from "./financeBillingNfeComparison.js";

export type FinanceBillingActionSeverity = "critical" | "warning" | "info";

export type FinanceBillingActionItem = {
  id: string;
  severity: FinanceBillingActionSeverity;
  title: string;
  description: string;
  value?: string;
};

function comparisonDivergencePercent(
  comparison: FinanceBillingComparisonPayload | null
): number | null {
  if (!comparison || comparison.yearTotalNomusNfe <= 0) return null;
  const so = comparison.yearTotalSalesOrder;
  if (so <= 0) return null;
  return (Math.abs(comparison.yearTotalNomusNfe - so) / so) * 100;
}

export function buildFinanceBillingActionItems(input: {
  tab?: BillingDashboardTab | null;
  comparison?: FinanceBillingComparisonPayload | null;
  audit?: BillingAuditResult | null;
}): FinanceBillingActionItem[] {
  const items: FinanceBillingActionItem[] = [];
  const { tab, comparison, audit } = input;

  const achievement = tab?.target.achievementPercent ?? null;
  if (achievement != null && achievement < 80) {
    items.push({
      id: "below-target",
      severity: achievement < 60 ? "critical" : "warning",
      title: "Faturamento abaixo da meta do mês",
      description: `% atingimento: ${achievement.toFixed(1)}% — meta +20% sobre mês anterior`,
      value: tab?.target.formatted.gap,
    });
  }

  const divergencePct = comparisonDivergencePercent(comparison ?? null);
  if (divergencePct != null && divergencePct >= 10) {
    items.push({
      id: "nfe-so-divergence",
      severity: divergencePct >= 25 ? "critical" : "warning",
      title: "Divergência NF-e × SalesOrder",
      description: `Diferença anual de ${divergencePct.toFixed(1)}% entre fontes`,
      value: comparison?.yearDifference != null
        ? `Δ ${comparison.yearDifference.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`
        : undefined,
    });
  }

  if (audit?.summary.excludedCount && audit.summary.excludedCount > 0) {
    items.push({
      id: "excluded-notes",
      severity: "warning",
      title: "Revisar NF-e excluídas do dashboard",
      description: `${audit.summary.excludedCount} nota(s) fora da composição fiscal`,
      value: audit.summary.excludedTotal.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      }),
    });
  }

  const cancelled = audit?.excludedRows.filter(
    (r) => r.exclusionReasonCode === "CANCELLED_NFE"
  ).length;
  if (cancelled && cancelled > 0) {
    items.push({
      id: "cancelled-notes",
      severity: "info",
      title: "Notas canceladas no período",
      description: `${cancelled} registro(s) com status cancelado`,
    });
  }

  const topCustomer = tab?.topCustomers[0];
  if (topCustomer && tab?.topCustomers.length >= 1) {
    const total = tab.topCustomers.reduce((s, c) => s + c.totalNetValue, 0);
    const share = total > 0 ? (topCustomer.totalNetValue / total) * 100 : 0;
    if (share >= 35) {
      items.push({
        id: "customer-concentration",
        severity: share >= 50 ? "warning" : "info",
        title: "Concentração por cliente",
        description: `${topCustomer.customerName} concentra ${share.toFixed(1)}% do top ranking`,
        value: topCustomer.totalNetValue.toLocaleString("pt-BR", {
          style: "currency",
          currency: "BRL",
        }),
      });
    }
  }

  const outOfRange = audit?.excludedRows.filter(
    (r) => r.exclusionReasonCode === "OUT_OF_DATE_RANGE"
  ).length;
  if (outOfRange && outOfRange > 0) {
    items.push({
      id: "out-of-period",
      severity: "info",
      title: "Documentos fora do período filtrado",
      description: `${outOfRange} registro(s) com competência fora do intervalo`,
    });
  }

  const wrongCompany = audit?.excludedRows.filter(
    (r) => r.exclusionReasonCode === "WRONG_COMPANY"
  ).length;
  if (wrongCompany && wrongCompany > 0) {
    items.push({
      id: "wrong-company",
      severity: "warning",
      title: "NF-e de empresa/grupo interno",
      description: `${wrongCompany} nota(s) excluídas por classificação de empresa`,
    });
  }

  return items;
}
