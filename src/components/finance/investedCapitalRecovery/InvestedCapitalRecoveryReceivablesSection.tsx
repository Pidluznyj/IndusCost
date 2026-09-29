/**
 * Bloco 3 — O que ainda tem para entrar: o CR real em aberto separado em
 * recuperação de capital e ganho a receber, e o capital na rua que ainda nem
 * tem CR aberto. Só renderiza o DTO — nenhuma conta aqui.
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import {
  FINANCE_KPI_ICR_CAPITAL_RECEIVABLE_COVERED,
  FINANCE_KPI_ICR_CAPITAL_WITHOUT_OPEN_RECEIVABLE,
  FINANCE_KPI_ICR_GAIN_RECEIVABLE,
  FINANCE_KPI_ICR_OUTSTANDING,
  FINANCE_KPI_ICR_OUTSTANDING_UNCLASSIFIED,
} from "@/src/lib/financeKpiTooltips";
import { InvestedCapitalRecoveryFormulaStrip } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryFormulaStrip";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

export function InvestedCapitalRecoveryReceivablesSection({
  kpis,
  children,
}: {
  kpis: InvestedCapitalRecoveryPayload["kpis"];
  /** Aging do capital na rua e top clientes — já existentes, ficam neste bloco. */
  children?: React.ReactNode;
}) {
  return (
    <ExecutiveSummarySection
      eyebrow="3 · O que ainda tem para entrar"
      title="CR real em aberto: retorno de capital e ganho futuro"
      testId="icr-receivables-section"
    >
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-outstanding"
          label="Falta receber"
          amount={kpis.totalOutstandingReceivable}
          amountFormat="currency"
          tone="info"
          sub="CR real em aberto de todos os pedidos do filtro"
          hint={FINANCE_KPI_ICR_OUTSTANDING}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-capital-receivable-covered"
          label="Capital a recuperar nos recebíveis"
          amount={kpis.capitalReceivableCoveredTotal}
          amountFormat="currency"
          tone="warning"
          sub="Parte do CR aberto que ainda é retorno de capital"
          hint={FINANCE_KPI_ICR_CAPITAL_RECEIVABLE_COVERED}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-gain-receivable"
          label="Ganho a receber"
          amount={kpis.gainReceivableTotal}
          amountFormat="currency"
          tone="success"
          sub="Parte do CR aberto que excede o capital exposto"
          hint={FINANCE_KPI_ICR_GAIN_RECEIVABLE}
        />
        <FinanceExecutiveTotalizerCard
          testId="icr-kpi-capital-without-open-receivable"
          label="Capital na rua sem CR aberto"
          amount={kpis.capitalWithoutOpenReceivableTotal}
          amountFormat="currency"
          tone="danger"
          sub="Exposto e ainda sem título real que o cubra"
          hint={FINANCE_KPI_ICR_CAPITAL_WITHOUT_OPEN_RECEIVABLE}
        />
      </SummaryKpiGrid>

      <div className="grid gap-2 xl:grid-cols-2">
        <InvestedCapitalRecoveryFormulaStrip
          testId="icr-formula-outstanding"
          result={{ label: "Recebíveis em aberto", amount: kpis.totalOutstandingReceivable }}
          terms={[
            { label: "Capital a recuperar", amount: kpis.capitalReceivableCoveredTotal },
            { label: "Ganho a receber", amount: kpis.gainReceivableTotal },
            {
              label: "Não classificado",
              amount: kpis.outstandingReceivableUnclassifiedTotal,
              hint: FINANCE_KPI_ICR_OUTSTANDING_UNCLASSIFIED,
            },
          ]}
          note="Não classificado = CR aberto de pedidos sem custo resolvido; não vira capital nem ganho."
        />
        <InvestedCapitalRecoveryFormulaStrip
          testId="icr-formula-money-on-street"
          result={{ label: "Capital na rua", amount: kpis.moneyOnStreetToday }}
          terms={[
            { label: "Capital no CR aberto", amount: kpis.capitalReceivableCoveredTotal },
            { label: "Capital sem CR aberto", amount: kpis.capitalWithoutOpenReceivableTotal },
          ]}
          note="Pedido a pedido: MIN(CR aberto, capital na rua) + MAX(capital na rua − CR aberto, 0)."
        />
      </div>

      {children}
    </ExecutiveSummarySection>
  );
}
