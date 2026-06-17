import React from "react";
import { formatCurrency, formatNumber } from "@/src/lib/utils";
import { FINANCIAL_STATUS_LABEL_PT } from "@/src/lib/customerIntelligenceNavigation";
import type { CustomerIntelligenceReport } from "@/src/lib/customerIntelligenceTypes";

type KpiItem = {
  label: string;
  value: string;
  hint?: string;
};

function formatOptionalCurrency(value: number | null | undefined): string {
  if (value == null) return "Não informado";
  return formatCurrency(value);
}

function formatOptionalNumber(value: number | null | undefined): string {
  if (value == null) return "Não informado";
  return formatNumber(value);
}

function formatOptionalPercent(value: number | null | undefined): string {
  if (value == null) return "Não informado";
  return `${value.toFixed(1)}%`;
}

export function buildCustomerIntelligenceKpiItems(
  report: CustomerIntelligenceReport
): KpiItem[] {
  const s = report.commercialSummary;
  const f = report.financial;

  return [
    { label: "Receita (filtro)", value: formatCurrency(s.revenue) },
    { label: "Pedidos (filtro)", value: formatNumber(s.ordersCount) },
    { label: "Pedidos válidos", value: formatNumber(s.validOrdersCount) },
    {
      label: "Ticket médio",
      value: formatOptionalCurrency(s.averageTicket),
    },
    {
      label: "Margem média",
      value: formatOptionalPercent(s.averageMarginPercent),
    },
    {
      label: "Carteira em aberto (AR)",
      value: f.linkedByCnpj ? formatOptionalCurrency(f.receivableOpenAmount) : "Não informado",
      hint: f.linkedByCnpj ? "Financeiro canônico" : undefined,
    },
    {
      label: "Valor vencido (AR)",
      value: f.linkedByCnpj ? formatOptionalCurrency(f.overdueAmount) : "Não informado",
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
      value: formatCurrency(s.openPortfolioAmount),
      hint: "Pedidos sem faturamento",
    },
    {
      label: "Dias desde último pedido",
      value: formatOptionalNumber(s.daysSinceLastOrder),
    },
  ];
}

export function CustomerIntelligenceKpiGrid({ report }: { report: CustomerIntelligenceReport }) {
  const items = buildCustomerIntelligenceKpiItems(report);

  return (
    <section className="customer-intelligence-kpi-grid" aria-label="Indicadores principais">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-border bg-card px-3 py-3 shadow-sm min-w-0"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
            {item.label}
          </p>
          <p className="text-lg font-bold mt-1 truncate" title={item.value}>
            {item.value}
          </p>
          {item.hint ? <p className="text-[10px] text-muted-foreground mt-0.5">{item.hint}</p> : null}
        </div>
      ))}
    </section>
  );
}
