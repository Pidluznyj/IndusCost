/**
 * Bloco 2 — O que já aconteceu: dinheiro que já entrou (CR real baixado),
 * separado em retorno de capital e ganho realizado, e a barra de recuperação
 * do capital. Só renderiza o DTO — percentuais e igualdades vêm do backend.
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_KPI_ICR_CAPITAL_RECOVERED,
  FINANCE_KPI_ICR_MONEY_ON_STREET,
  FINANCE_KPI_ICR_REALIZED_GAIN,
  FINANCE_KPI_ICR_RECEIVED_COMPARABLE,
} from "@/src/lib/financeKpiTooltips";
import { InvestedCapitalRecoveryFormulaStrip } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryFormulaStrip";
import { InvestedCapitalRecoveryRecoveryBar } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRecoveryBar";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

export function InvestedCapitalRecoveryRealizedSection({
  kpis,
}: {
  kpis: InvestedCapitalRecoveryPayload["kpis"];
}) {
  return (
    <ExecutiveSummarySection
      eyebrow="2 · O que já aconteceu"
      title="Dinheiro que já entrou: retorno de capital e ganho realizado"
      testId="icr-realized-section"
    >
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-capital-recovered"
          label="Capital recuperado"
          amount={kpis.capitalRecoveredTotal}
          amountFormat="currency"
          tone="success"
          sub="Parte do recebido que devolveu o capital"
          hint={FINANCE_KPI_ICR_CAPITAL_RECOVERED}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-realized-gain"
          label="Ganho já realizado"
          amount={kpis.realizedGainTotal}
          amountFormat="currency"
          tone="success"
          sub="Recebido acima do capital, pedido a pedido"
          hint={FINANCE_KPI_ICR_REALIZED_GAIN}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-received-comparable"
          label="Total recebido"
          amount={kpis.actualReceivedComparableTotal}
          amountFormat="currency"
          tone="info"
          sub="CR real baixado dos pedidos com custo resolvido"
          hint={FINANCE_KPI_ICR_RECEIVED_COMPARABLE}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-money-on-street"
          label="Capital na rua hoje"
          amount={kpis.moneyOnStreetToday}
          amountFormat="currency"
          tone="warning"
          sub="Investimento que ainda não voltou"
          hint={FINANCE_KPI_ICR_MONEY_ON_STREET}
        />
      </SummaryKpiGrid>

      <InvestedCapitalRecoveryRecoveryBar
        investedCapital={kpis.investedCapitalAnalyzedTotal}
        capitalRecovered={kpis.capitalRecoveredTotal}
        moneyOnStreet={kpis.moneyOnStreetToday}
        recoveredPercent={kpis.capitalRecoveredPercent}
        moneyOnStreetPercent={kpis.moneyOnStreetPercent}
      />

      <InvestedCapitalRecoveryFormulaStrip
        testId="icr-formula-received"
        result={{ label: "Recebido comparável", amount: kpis.actualReceivedComparableTotal }}
        terms={[
          { label: "Capital recuperado", amount: kpis.capitalRecoveredTotal },
          { label: "Ganho realizado", amount: kpis.realizedGainTotal },
        ]}
        note={`Recebido de todos os pedidos do filtro, inclusive sem custo resolvido: ${formatFinanceCurrency(kpis.actualReceivedTotal)}.`}
      />
    </ExecutiveSummarySection>
  );
}
