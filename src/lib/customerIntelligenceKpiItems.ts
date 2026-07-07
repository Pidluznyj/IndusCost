import { FINANCIAL_STATUS_LABEL_PT } from "@/src/lib/customerIntelligenceNavigation";
import {
  formatKpiCompactCurrency,
  formatKpiCompactNumber,
  formatKpiCompactPercent,
  formatKpiDisplayValue,
} from "@/src/lib/kpiDisplayFormat";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";
import {
  buildOfficialSalesOrderMarginTooltipText,
  buildSalesOrderMarginCoverageHint,
  resolveSalesOrderMarginPercentLabel,
} from "@/src/lib/salesOrderMarginDisplay";

export type CustomerIntelligenceKpiItem = {
  label: string;
  value: string;
  valueTitle?: string;
  hint?: string;
};

function formatOptionalCurrency(value: number | null | undefined): CustomerIntelligenceKpiItem {
  if (value == null) return { label: "", value: "Não informado" };
  const formatted = formatKpiCompactCurrency(value);
  const display = formatKpiDisplayValue(formatted);
  return { label: "", value: display.value, valueTitle: display.valueTitle };
}

function formatOptionalNumber(value: number | null | undefined): CustomerIntelligenceKpiItem {
  if (value == null) return { label: "", value: "Não informado" };
  const formatted = formatKpiCompactNumber(value);
  const display = formatKpiDisplayValue(formatted);
  return { label: "", value: display.value, valueTitle: display.valueTitle };
}

function formatOptionalPercent(value: number | null | undefined): CustomerIntelligenceKpiItem {
  if (value == null) return { label: "", value: "Não informado" };
  const formatted = formatKpiCompactPercent(value);
  const display = formatKpiDisplayValue(formatted);
  return { label: "", value: display.value, valueTitle: display.valueTitle };
}

export function buildCustomerIntelligenceKpiItems(
  report: CustomerIntelligenceReport
): CustomerIntelligenceKpiItem[] {
  const s = report.commercialSummary;
  const f = report.financial;
  const lifetime = report.lifetimeSummary;

  const revenue = formatKpiDisplayValue(formatKpiCompactCurrency(s.revenue), "Receita (filtro)");
  const lifetimeRevenue = formatKpiDisplayValue(
    formatKpiCompactCurrency(lifetime.revenue),
    "Receita histórica"
  );
  const orders = formatKpiDisplayValue(formatKpiCompactNumber(s.ordersCount), "Pedidos (filtro)");
  const lifetimeOrders = formatKpiDisplayValue(
    formatKpiCompactNumber(lifetime.ordersCount),
    "Pedidos históricos"
  );
  const validOrders = formatKpiDisplayValue(
    formatKpiCompactNumber(s.validOrdersCount),
    "Pedidos válidos"
  );
  const ticket = formatOptionalCurrency(s.averageTicket);
  const marginCoverage = s.marginCoverage;
  const margin =
    marginCoverage?.costCoverageStatus === "NONE" || s.averageMarginPercent == null
      ? { label: "", value: "Não informado" }
      : formatOptionalPercent(s.averageMarginPercent);
  const marginHint =
    marginCoverage != null
      ? buildSalesOrderMarginCoverageHint(marginCoverage, (v) =>
          v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
        )
      : undefined;
  const openPortfolio = formatKpiDisplayValue(
    formatKpiCompactCurrency(s.openPortfolioAmount),
    "Carteira comercial em aberto"
  );
  const daysSince = formatOptionalNumber(s.daysSinceLastOrder);

  return [
    {
      label: "Receita (filtro)",
      value: revenue.value,
      valueTitle: revenue.valueTitle,
    },
    {
      label: "Receita histórica",
      value: lifetimeRevenue.value,
      valueTitle: lifetimeRevenue.valueTitle,
    },
    {
      label: "Pedidos (filtro)",
      value: orders.value,
      valueTitle: orders.valueTitle,
    },
    {
      label: "Pedidos históricos",
      value: lifetimeOrders.value,
      valueTitle: lifetimeOrders.valueTitle,
    },
    {
      label: "Pedidos válidos",
      value: validOrders.value,
      valueTitle: validOrders.valueTitle,
    },
    {
      label: "Ticket médio",
      value: ticket.value,
      valueTitle: ticket.valueTitle,
    },
    {
      label: resolveSalesOrderMarginPercentLabel(marginCoverage),
      value: margin.value,
      valueTitle:
        marginCoverage != null
          ? buildOfficialSalesOrderMarginTooltipText({ summary: marginCoverage })
          : margin.valueTitle,
      hint: marginHint,
    },
    {
      label: "Carteira em aberto (AR)",
      value: f.linkedByCnpj
        ? formatOptionalCurrency(f.receivableOpenAmount).value
        : "Não informado",
      valueTitle: f.linkedByCnpj
        ? formatKpiDisplayValue(
            formatKpiCompactCurrency(f.receivableOpenAmount),
            "Carteira em aberto (AR)"
          ).valueTitle
        : undefined,
      hint: f.linkedByCnpj ? "Financeiro canônico" : undefined,
    },
    {
      label: "Valor vencido (AR)",
      value: f.linkedByCnpj ? formatOptionalCurrency(f.overdueAmount).value : "Não informado",
      valueTitle: f.linkedByCnpj
        ? formatKpiDisplayValue(formatKpiCompactCurrency(f.overdueAmount), "Valor vencido (AR)")
            .valueTitle
        : undefined,
      hint: f.linkedByCnpj ? "Financeiro canônico" : undefined,
    },
    {
      label: "Status financeiro",
      value: f.linkedByCnpj
        ? FINANCIAL_STATUS_LABEL_PT[f.financialStatus] ?? f.financialStatus
        : "Não informado",
    },
    {
      label: "Carteira comercial em aberto",
      value: openPortfolio.value,
      valueTitle: openPortfolio.valueTitle,
      hint: "Pedidos sem faturamento",
    },
    {
      label: "Dias desde último pedido",
      value: daysSince.value,
      valueTitle: daysSince.valueTitle,
    },
  ];
}
