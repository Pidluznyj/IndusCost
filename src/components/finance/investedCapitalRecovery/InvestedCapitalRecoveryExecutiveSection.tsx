/**
 * Bloco 4 — Leitura gerencial: os quatro números da conversa de conselho com
 * explicações curtas, mais os indicadores de contagem e o prazo médio
 * realizado (que segue null até existir evidência canônica de saída — o
 * backend decide, a tela só mostra "—").
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_KPI_ICR_AVERAGE_DAYS,
  FINANCE_KPI_ICR_GAIN_RECEIVABLE,
  FINANCE_KPI_ICR_INSUFFICIENT_DATA,
  FINANCE_KPI_ICR_INVESTED_CAPITAL,
  FINANCE_KPI_ICR_MONEY_ON_STREET,
  FINANCE_KPI_ICR_SOLD,
} from "@/src/lib/financeKpiTooltips";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

export function InvestedCapitalRecoveryExecutiveSection({
  kpis,
}: {
  kpis: InvestedCapitalRecoveryPayload["kpis"];
}) {
  return (
    <ExecutiveSummarySection
      eyebrow="4 · Leitura gerencial"
      title="Onde está o dinheiro"
      testId="icr-executive-section"
    >
      <SummaryKpiGrid minColumnWidth={168} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-sold"
          label="Vendemos"
          amount={kpis.totalSaleValueAnalyzed}
          amountFormat="currency"
          tone="info"
          sub="Soma do valor dos PVs"
          hint={FINANCE_KPI_ICR_SOLD}
        />
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-invested"
          label="Investimos"
          amount={kpis.investedCapitalAnalyzedTotal}
          amountFormat="currency"
          tone="warning"
          sub="Custo industrial + imposto"
          hint={FINANCE_KPI_ICR_INVESTED_CAPITAL}
        />
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-money-on-street"
          label="Capital na rua"
          amount={kpis.moneyOnStreetToday}
          amountFormat="currency"
          tone="danger"
          sub="Parte do investimento que ainda não voltou"
          hint={FINANCE_KPI_ICR_MONEY_ON_STREET}
        />
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-gain-receivable"
          label="Ganho a receber"
          amount={kpis.gainReceivableTotal}
          amountFormat="currency"
          tone="success"
          sub="Parte do CR aberto que excede o capital exposto"
          hint={FINANCE_KPI_ICR_GAIN_RECEIVABLE}
        />
      </SummaryKpiGrid>

      <SummaryKpiGrid minColumnWidth={168} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-fully-recovered"
          label="Recuperaram capital"
          value={formatFinanceInteger(kpis.ordersFullyRecoveredCount)}
          tone="success"
          sub="Pedidos com o capital de volta"
        />
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-partially-recovered"
          label="Parcialmente recuperados"
          value={formatFinanceInteger(kpis.ordersPartiallyRecoveredCount)}
          tone="warning"
          sub="Pedidos com parte do capital na rua"
        />
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-insufficient"
          label="Dados insuficientes"
          value={formatFinanceInteger(kpis.ordersInsufficientDataCount)}
          tone={kpis.ordersInsufficientDataCount > 0 ? "warning" : "neutral"}
          sub="Pedidos sem custo resolvido"
          hint={FINANCE_KPI_ICR_INSUFFICIENT_DATA}
        />
        <FinanceExecutiveTotalizerCard
          compact
          testId="icr-exec-average-days"
          label="Prazo médio realizado"
          value={
            kpis.averageDaysToRecoverCapital == null
              ? "—"
              : `${formatFinanceInteger(kpis.averageDaysToRecoverCapital)} dias`
          }
          tone="neutral"
          sub={kpis.averageDaysToRecoverCapital == null ? "Indisponível: sem evidência de data de saída" : "Da saída à recuperação do capital"}
          hint={FINANCE_KPI_ICR_AVERAGE_DAYS}
        />
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}
