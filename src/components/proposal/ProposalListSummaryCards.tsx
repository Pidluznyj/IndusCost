import React, { memo } from "react";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Hourglass,
  Receipt,
  Ticket,
} from "lucide-react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { formatCompactCurrency, formatFullCurrency } from "@/src/lib/formatFinancialMetric";

export type ProposalListSummary = {
  totalProposals: number;
  totalNetAmount: number;
  totalGrossAmount: number;
  averageNetValue: number | null;
  yearToDateCount: number;
  monthToDateCount: number;
  openProposalsCount: number;
  openProposalsAmount: number;
  convertedProposalsCount: number;
  convertedProposalsAmount: number;
  conversionRate: number | null;
  /** Propostas Nomus sem valor comercial escondidas do grid pelos filtros atuais (fora dos indicadores). */
  hiddenWithoutCommercialValueCount?: number;
};

export const ProposalListSummaryCards = memo(function ProposalListSummaryCards({
  summary,
  loading,
}: {
  summary: ProposalListSummary | null;
  loading: boolean;
}) {
  const yearToDateCount = summary?.yearToDateCount ?? 0;
  const monthToDateCount = summary?.monthToDateCount ?? 0;
  const openProposalsCount = summary?.openProposalsCount ?? 0;
  const openProposalsAmount = summary?.openProposalsAmount ?? 0;
  const totalNetAmount = summary?.totalNetAmount ?? 0;
  const averageNetValue = summary?.averageNetValue ?? null;
  const convertedProposalsCount = summary?.convertedProposalsCount ?? 0;
  const convertedProposalsAmount = summary?.convertedProposalsAmount ?? 0;
  const conversionRate = summary?.conversionRate ?? null;

  const openSubtitle =
    openProposalsAmount > 0
      ? `${formatCompactCurrency(openProposalsAmount)} em aberto`
      : "Sem valor em aberto";

  const pipelineSubtitle =
    averageNetValue != null
      ? `Ticket médio: ${formatCompactCurrency(averageNetValue)}`
      : undefined;

  const convertedDetail =
    conversionRate != null ? (
      <div
        className="space-y-0.5 text-[11px] leading-snug text-[#64748b]"
        data-testid="proposal-converted-indicator-detail"
      >
        <div>{convertedProposalsCount.toLocaleString("pt-BR")} propostas</div>
        <div title={formatFullCurrency(convertedProposalsAmount)}>
          {formatCompactCurrency(convertedProposalsAmount)}
        </div>
      </div>
    ) : (
      <div className="text-[11px] leading-snug text-[#64748b]">Nenhuma proposta no filtro</div>
    );

  return (
    <div className="my-4" data-testid="proposal-list-summary-cards">
      <SummaryKpiGrid
        minColumnWidth={152}
        className={`${SYSTEM_TOTALIZER_GRID_CLASS} proposal-list-summary-grid`}
      >
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Propostas no ano"
          amount={loading ? null : yearToDateCount}
          amountFormat="number"
          subtitle={loading ? undefined : `${monthToDateCount} no mês atual`}
          tone="info"
          icon={Calendar}
          helperText="Quantidade total de propostas geradas no ano civil corrente."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Propostas no mês"
          amount={loading ? null : monthToDateCount}
          amountFormat="number"
          subtitle="Mês corrente"
          tone="neutral"
          icon={Clock}
          helperText="Quantidade de propostas comerciais geradas no mês atual."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Sem pedido de venda"
          amount={loading ? null : openProposalsCount}
          amountFormat="number"
          subtitle={loading ? undefined : openSubtitle}
          tone="warning"
          icon={Hourglass}
          helperText="Propostas em aberto/negociação que ainda não viraram Pedido de Venda."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Valor proposto"
          amount={loading ? null : totalNetAmount}
          amountFormat="currency"
          subtitle={loading ? undefined : pipelineSubtitle}
          tone="money"
          icon={Receipt}
          helperText="Valor líquido total do pipeline de propostas no filtro."
          loading={loading}
        />
        <SystemTotalizerCard
          testId="proposal-converted-indicator"
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Conversão em PV"
          amount={loading ? null : conversionRate}
          amountFormat="percent"
          footer={loading ? undefined : convertedDetail}
          tone="success"
          icon={CheckCircle2}
          helperText="Taxa do filtro atual: propostas com pedido de venda ou aprovadas, divididas pelo total de propostas. A quantidade e o valor líquido convertido ficam abaixo do percentual."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Ticket médio"
          amount={loading ? null : averageNetValue}
          amountFormat="currency"
          tone="highlight"
          icon={Ticket}
          helperText="Valor líquido médio por proposta comercial."
          loading={loading}
        />
      </SummaryKpiGrid>
    </div>
  );
});
