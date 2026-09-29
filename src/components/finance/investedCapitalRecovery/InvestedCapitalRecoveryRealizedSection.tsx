/**
 * Bloco 2 — O que já aconteceu: dinheiro que já entrou (CR real baixado),
 * separado em retorno de capital e ganho realizado, e a barra de recuperação
 * do capital. Só renderiza o DTO — percentuais e igualdades vêm do backend.
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_KPI_ICR_CAPITAL_RECOVERED,
  FINANCE_KPI_ICR_REALIZED_GAIN,
  FINANCE_KPI_ICR_RECEIVED_COMPARABLE,
} from "@/src/lib/financeKpiTooltips";
import { InvestedCapitalRecoveryRecoveryBar } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRecoveryBar";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

export function InvestedCapitalRecoveryRealizedSection({
  kpis,
}: {
  kpis: InvestedCapitalRecoveryPayload["kpis"];
}) {
  return (
    <ExecutiveSummarySection
      eyebrow="Bloco 2"
      title="2. O que já aconteceu"
      actions={
        <p className="max-w-xs text-right text-[11px] text-[#6B7280]">
          O dinheiro que já entrou no caixa, separado entre retorno do capital e ganho.
        </p>
      }
      footer={`Recebido de todos os pedidos do filtro, inclusive sem custo resolvido: ${formatFinanceCurrency(kpis.actualReceivedTotal)}. A separação em capital e ganho só vale para os pedidos com custo.`}
      testId="icr-realized-section"
    >
      <SummaryKpiGrid minColumnWidth={220} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-capital-recovered"
          label="Capital recuperado"
          amount={kpis.capitalRecoveredTotal}
          amountFormat="currency"
          tone="success"
          subtitle="Parte do capital investido que já voltou através de CR real baixado"
          helperText={FINANCE_KPI_ICR_CAPITAL_RECOVERED}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-realized-gain"
          label="Ganho já realizado"
          amount={kpis.realizedGainTotal}
          amountFormat="currency"
          tone="margin"
          subtitle="Recebimentos que excederam o capital investido, calculados PV a PV"
          helperText={FINANCE_KPI_ICR_REALIZED_GAIN}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-received-comparable"
          label="Total recebido"
          amount={kpis.actualReceivedComparableTotal}
          amountFormat="currency"
          tone="neutral"
          subtitle="Capital recuperado + ganho já realizado (pedidos com custo resolvido)"
          helperText={FINANCE_KPI_ICR_RECEIVED_COMPARABLE}
        />
      </SummaryKpiGrid>

      <InvestedCapitalRecoveryRecoveryBar
        investedCapital={kpis.investedCapitalAnalyzedTotal}
        capitalRecovered={kpis.capitalRecoveredTotal}
        moneyOnStreet={kpis.moneyOnStreetToday}
        recoveredPercent={kpis.capitalRecoveredPercent}
        moneyOnStreetPercent={kpis.moneyOnStreetPercent}
      />
    </ExecutiveSummarySection>
  );
}
