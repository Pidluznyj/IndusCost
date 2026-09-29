/**
 * Bloco 1 — Economia dos pedidos: como o valor vendido se divide entre capital
 * investido (custo industrial + imposto) e margem econômica. Só renderiza o
 * DTO: nenhuma soma ou subtração acontece aqui — as igualdades já vêm
 * reconciliadas do backend (população comparável = pedidos com custo).
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_KPI_ICR_COMPARABLE_SALE,
  FINANCE_KPI_ICR_ECONOMIC_MARGIN,
  FINANCE_KPI_ICR_INDUSTRIAL_COST,
  FINANCE_KPI_ICR_INSUFFICIENT_DATA,
  FINANCE_KPI_ICR_INVESTED_CAPITAL,
  FINANCE_KPI_ICR_SALE_UNRESOLVED_COST,
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
      eyebrow="Bloco 1"
      title="1. Economia dos pedidos"
      actions={
        <p className="max-w-xs text-right text-[11px] text-[#6B7280]">
          O que foi vendido e quanto dessa venda representa capital × margem.
        </p>
      }
      testId="icr-economic-section"
    >
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-sold"
          label="Vendemos"
          amount={kpis.totalSaleValueAnalyzed}
          amountFormat="currency"
          tone="info"
          subtitle={`Soma do valor líquido de ${formatFinanceInteger(ordersCount)} PV(s) da população filtrada`}
          helperText={FINANCE_KPI_ICR_SOLD}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-invested-capital"
          label="Capital investido"
          amount={kpis.investedCapitalAnalyzedTotal}
          amountFormat="currency"
          tone="warning"
          subtitle="Custo industrial + imposto dos pedidos com capital resolvido"
          helperText={FINANCE_KPI_ICR_INVESTED_CAPITAL}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-economic-margin"
          label="Margem econômica dos PVs"
          amount={kpis.economicMarginTotal}
          amountFormat="currency"
          tone={marginNegative ? "danger" : "margin"}
          subtitle={
            marginNegative
              ? "Venda − capital investido, na mesma população comparável · negativa"
              : "Venda − capital investido, na mesma população comparável"
          }
          helperText={FINANCE_KPI_ICR_ECONOMIC_MARGIN}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-insufficient-data"
          label="Pedidos com dados insuficientes"
          value={formatFinanceInteger(kpis.ordersInsufficientDataCount)}
          tone={kpis.ordersInsufficientDataCount > 0 ? "warning" : "neutral"}
          subtitle="Não entram no cálculo oficial da margem até o custo ser resolvido"
          helperText={FINANCE_KPI_ICR_INSUFFICIENT_DATA}
        />
      </SummaryKpiGrid>

      {/* Reconciliação total × comparável: a venda total inclui os PVs sem custo, que nunca viram capital nem margem. */}
      <InvestedCapitalRecoveryFormulaStrip
        testId="icr-formula-sale-total"
        title="Reconciliação da venda"
        result={{ label: "Venda total", amount: kpis.totalSaleValueAnalyzed, detail: `${formatFinanceInteger(ordersCount)} PV(s) do filtro`, hint: FINANCE_KPI_ICR_SOLD }}
        terms={[
          { label: "Venda comparável", amount: kpis.comparableSaleValueTotal, detail: `${formatFinanceInteger(kpis.ordersComparableCount)} PV(s) com custo resolvido`, hint: FINANCE_KPI_ICR_COMPARABLE_SALE },
          { label: "Venda sem custo resolvido", amount: kpis.saleValueUnresolvedCostTotal, detail: `${formatFinanceInteger(kpis.ordersUnresolvedCostCount)} PV(s) · fora de capital e margem`, hint: FINANCE_KPI_ICR_SALE_UNRESOLVED_COST },
        ]}
      />

      <div className="grid gap-2 xl:grid-cols-2">
        <InvestedCapitalRecoveryFormulaStrip
          testId="icr-formula-capital"
          title="Composição do capital investido"
          result={{ label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal, detail: "dinheiro colocado" }}
          terms={[
            { label: "Custo industrial", amount: kpis.totalIndustrialCostAnalyzed, detail: "custo oficial de produção", hint: FINANCE_KPI_ICR_INDUSTRIAL_COST },
            { label: "Imposto", amount: kpis.totalTaxesAnalyzed, detail: "da margem comercial, já incluído no capital", hint: FINANCE_KPI_ICR_TAXES },
          ]}
        />
        <InvestedCapitalRecoveryFormulaStrip
          testId="icr-formula-sale"
          title="Leitura econômica"
          result={{ label: "Venda comparável", amount: kpis.comparableSaleValueTotal, detail: "pedidos com custo válido", hint: FINANCE_KPI_ICR_COMPARABLE_SALE }}
          terms={[
            { label: "Capital investido", amount: kpis.investedCapitalAnalyzedTotal, detail: "dinheiro colocado" },
            { label: "Margem econômica", amount: kpis.economicMarginTotal, detail: "excedente da venda" },
          ]}
          note={`Só os ${formatFinanceInteger(kpis.ordersComparableCount)} pedido(s) com custo resolvido — a mesma população do capital investido.`}
        />
      </div>
    </ExecutiveSummarySection>
  );
}
