/**
 * Bloco 3 — O que ainda tem para entrar: o CR real em aberto separado em
 * recuperação de capital e ganho a receber, e o capital na rua que ainda nem
 * tem CR aberto. Só renderiza o DTO — nenhuma conta aqui.
 */
import React from "react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import {
  FINANCE_KPI_ICR_CAPITAL_RECEIVABLE_COVERED,
  FINANCE_KPI_ICR_CAPITAL_WITHOUT_OPEN_RECEIVABLE,
  FINANCE_KPI_ICR_GAIN_RECEIVABLE,
  FINANCE_KPI_ICR_OUTSTANDING,
} from "@/src/lib/financeKpiTooltips";
import { InvestedCapitalRecoveryFormulaStrip } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryFormulaStrip";
import { InvestedCapitalRecoveryReceivablesBar } from "@/src/components/finance/investedCapitalRecovery/InvestedCapitalRecoveryRecoveryBar";
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
      eyebrow="Bloco 3"
      title="3. O que ainda tem para entrar"
      actions={
        <p className="max-w-xs text-right text-[11px] text-[#6B7280]">
          Dos CRs abertos, quanto é retorno do seu dinheiro e quanto é ganho.
        </p>
      }
      testId="icr-receivables-section"
    >
      <SummaryKpiGrid minColumnWidth={200} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-outstanding"
          label="Falta receber"
          amount={kpis.totalOutstandingReceivable}
          amountFormat="currency"
          tone="danger"
          subtitle="Saldo dos Contas a Receber reais vinculados aos PVs"
          helperText={FINANCE_KPI_ICR_OUTSTANDING}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-capital-receivable-covered"
          label="Capital a recuperar nos CRs"
          amount={kpis.capitalReceivableCoveredTotal}
          amountFormat="currency"
          tone="info"
          subtitle="Parte do CR aberto que ainda representa capital investido"
          helperText={FINANCE_KPI_ICR_CAPITAL_RECEIVABLE_COVERED}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-gain-receivable"
          label="Ganho a receber"
          amount={kpis.gainReceivableTotal}
          amountFormat="currency"
          tone="margin"
          subtitle="Parte do CR aberto que excede o capital ainda não recuperado"
          helperText={FINANCE_KPI_ICR_GAIN_RECEIVABLE}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-kpi-capital-without-open-receivable"
          label="Capital na rua sem CR aberto"
          amount={kpis.capitalWithoutOpenReceivableTotal}
          amountFormat="currency"
          tone="warning"
          subtitle="Capital ainda exposto que não está coberto por CR real em aberto"
          helperText={FINANCE_KPI_ICR_CAPITAL_WITHOUT_OPEN_RECEIVABLE}
        />
      </SummaryKpiGrid>

      <InvestedCapitalRecoveryReceivablesBar
        outstandingTotal={kpis.totalOutstandingReceivable}
        capitalReceivableCovered={kpis.capitalReceivableCoveredTotal}
        gainReceivable={kpis.gainReceivableTotal}
        unclassified={kpis.outstandingReceivableUnclassifiedTotal}
      />

      <p className="rounded-lg border border-dashed border-[#B9C6D8] bg-[#FBFCFE] px-3 py-2 text-xs text-[#43526A]" data-testid="icr-receivables-rule">
        <strong className="text-[#111827]">Regra por PV:</strong> capital a recuperar = MIN(falta receber, capital na rua).
        Ganho a receber = MAX(falta receber − capital na rua, 0). A soma é feita pedido a pedido, nunca pela
        diferença direta dos totais.
      </p>

      <InvestedCapitalRecoveryFormulaStrip
        testId="icr-formula-money-on-street"
        title="Onde está o capital na rua"
        result={{ label: "Capital na rua", amount: kpis.moneyOnStreetToday, detail: "investimento que ainda não voltou" }}
        terms={[
          { label: "Capital no CR aberto", amount: kpis.capitalReceivableCoveredTotal, detail: "coberto por título real" },
          { label: "Capital sem CR aberto", amount: kpis.capitalWithoutOpenReceivableTotal, detail: "exposto, ainda sem título" },
        ]}
      />

      {children}
    </ExecutiveSummarySection>
  );
}
