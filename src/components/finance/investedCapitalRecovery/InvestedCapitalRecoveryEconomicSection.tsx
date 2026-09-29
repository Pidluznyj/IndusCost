/**
 * Bloco 1 — Economia dos pedidos: como o valor vendido se divide entre capital
 * investido (custo industrial + imposto) e margem econômica. Só renderiza o
 * DTO: nenhuma soma ou subtração acontece aqui — as igualdades já vêm
 * reconciliadas do backend (população comparável = pedidos com custo).
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_KPI_ICR_COMPARABLE_SALE,
  FINANCE_KPI_ICR_ECONOMIC_MARGIN,
  FINANCE_KPI_ICR_INDUSTRIAL_COST,
  FINANCE_KPI_ICR_INSUFFICIENT_DATA,
  FINANCE_KPI_ICR_INVESTED_CAPITAL,
  FINANCE_KPI_ICR_SOLD,
  FINANCE_KPI_ICR_TAXES,
} from "@/src/lib/financeKpiTooltips";
import { InvestedCapitalRecoveryFormulaStrip } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryFormulaStrip";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

export function InvestedCapitalRecoveryEconomicSection({
  kpis,
  ordersCount,
}: {
  kpis: InvestedCapitalRecoveryPayload["kpis"];
  ordersCount: number;
}) {
  const marginNegative = kpis.economicMarginTotal < 0;
  return (
    <ExecutiveSummarySection
      eyebrow="1 · Economia dos pedidos"
      title="Como o valor vendido se divide"
      testId="icr-economic-section"
    >
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-sold"
          label="Vendemos"
          amount={kpis.totalSaleValueAnalyzed}
          amountFormat="currency"
          tone="info"
          sub={`Valor líquido de ${formatFinanceInteger(ordersCount)} pedido(s) · não é NF-e nem recebido`}
          hint={FINANCE_KPI_ICR_SOLD}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-invested-capital"
          label="Capital investido"
          amount={kpis.investedCapitalAnalyzedTotal}
          amountFormat="currency"
          tone="warning"
          sub="Custo industrial + imposto, nos pedidos com custo resolvido"
          hint={FINANCE_KPI_ICR_INVESTED_CAPITAL}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-economic-margin"
          label="Margem econômica dos PVs"
          amount={kpis.economicMarginTotal}
          amountFormat="currency"
          tone={marginNegative ? "danger" : "success"}
          sub={
            marginNegative
              ? "Venda comparável − capital investido · negativa"
              : "Venda comparável − capital investido"
          }
          hint={FINANCE_KPI_ICR_ECONOMIC_MARGIN}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-insufficient-data"
          label="Dados insuficientes"
          value={formatFinanceInteger(kpis.ordersInsufficientDataCount)}
          tone={kpis.ordersInsufficientDataCount > 0 ? "warning" : "neutral"}
          sub="PVs sem custo resolvido · fora da margem econômica"
          hint={FINANCE_KPI_ICR_INSUFFICIENT_DATA}
        />
      </SummaryKpiGrid>

      <div className="grid gap-2 xl:grid-cols-2">
        <InvestedCapitalRecoveryFormulaStrip
          testId="icr-formula-sale"
          result={{ label: "Venda comparável", amount: kpis.comparableSaleValueTotal, hint: FINANCE_KPI_ICR_COMPARABLE_SALE }}
          terms={[
            { label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal },
            { label: "Margem econômica", amount: kpis.economicMarginTotal },
          ]}
          note={`Só os ${formatFinanceInteger(kpis.ordersComparableCount)} pedido(s) com custo resolvido — a mesma população do capital investido.`}
        />
        <InvestedCapitalRecoveryFormulaStrip
          testId="icr-formula-capital"
          result={{ label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal }}
          terms={[
            { label: "Custo industrial", amount: kpis.totalIndustrialCostAnalyzed, hint: FINANCE_KPI_ICR_INDUSTRIAL_COST },
            { label: "Imposto", amount: kpis.totalTaxesAnalyzed, hint: FINANCE_KPI_ICR_TAXES },
          ]}
          note="Imposto usado na margem comercial do pedido — já incluído no capital."
        />
      </div>
    </ExecutiveSummarySection>
  );
}
