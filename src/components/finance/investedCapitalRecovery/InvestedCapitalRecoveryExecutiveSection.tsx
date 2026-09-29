/**
 * Bloco 4 — Leitura gerencial: as quatro definições curtas da conversa de
 * conselho e os indicadores de contagem, incluindo o prazo médio realizado
 * (segue null até existir evidência canônica de saída — o backend decide, a
 * tela só mostra "—").
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
  FINANCE_KPI_ICR_AVERAGE_DAYS,
  FINANCE_KPI_ICR_INSUFFICIENT_DATA,
} from "@/src/lib/financeKpiTooltips";
import type { InvestedCapitalRecoveryPayload } from "@/src/components/finance/investedCapitalRecovery/investedCapitalRecoveryTypes";

const LEGENDS: Array<{ term: string; meaning: string }> = [
  { term: "Vendemos", meaning: "Soma do valor dos PVs." },
  { term: "Investimos", meaning: "Custo industrial + imposto." },
  { term: "Capital na rua", meaning: "Parte do investimento que ainda não voltou." },
  { term: "Ganho a receber", meaning: "Parte do CR aberto acima do capital ainda exposto." },
];

export function InvestedCapitalRecoveryExecutiveSection({
  kpis,
}: {
  kpis: InvestedCapitalRecoveryPayload["kpis"];
}) {
  return (
    <ExecutiveSummarySection
      eyebrow="Bloco 4"
      title="4. Leitura gerencial"
      actions={
        <p className="max-w-xs text-right text-[11px] text-[#6B7280]">Resumo rápido para interpretação executiva.</p>
      }
      testId="icr-executive-section"
    >
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="icr-executive-legends">
        {LEGENDS.map((legend) => (
          <div key={legend.term} className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[11px] leading-snug text-[#43526A]">
            <p className="text-xs font-bold text-[#111827]">{legend.term}</p>
            <p>{legend.meaning}</p>
          </div>
        ))}
      </div>

      <SummaryKpiGrid minColumnWidth={168} className={SYSTEM_TOTALIZER_GRID_CLASS}>
        <SystemTotalizerCard
          compact
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-exec-fully-recovered"
          label="Recuperaram capital"
          value={formatFinanceInteger(kpis.ordersFullyRecoveredCount)}
          tone="success"
          subtitle="Pedidos com o capital de volta"
        />
        <SystemTotalizerCard
          compact
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-exec-partially-recovered"
          label="Parcialmente recuperados"
          value={formatFinanceInteger(kpis.ordersPartiallyRecoveredCount)}
          tone="warning"
          subtitle="Pedidos com parte do capital na rua"
        />
        <SystemTotalizerCard
          compact
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-exec-insufficient"
          label="Dados insuficientes"
          value={formatFinanceInteger(kpis.ordersInsufficientDataCount)}
          tone={kpis.ordersInsufficientDataCount > 0 ? "warning" : "neutral"}
          subtitle="Pedidos sem custo resolvido"
          helperText={FINANCE_KPI_ICR_INSUFFICIENT_DATA}
        />
        <SystemTotalizerCard
          compact
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          testId="icr-exec-average-days"
          label="Prazo médio realizado"
          value={
            kpis.averageDaysToRecoverCapital == null
              ? "—"
              : `${formatFinanceInteger(kpis.averageDaysToRecoverCapital)} dias`
          }
          tone="neutral"
          subtitle={kpis.averageDaysToRecoverCapital == null ? "Indisponível: sem evidência de data de saída" : "Da saída à recuperação do capital"}
          helperText={FINANCE_KPI_ICR_AVERAGE_DAYS}
        />
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}
