import React, { memo } from "react";
import { BadgePercent, Percent, Receipt, Scale, ShoppingBag, Ticket } from "lucide-react";
import {
  SYSTEM_TOTALIZER_GRID_CLASS,
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { formatCompactCurrency } from "@/src/lib/formatFinancialMetric";
import { formatSalesOrderMarginPercent } from "@/src/lib/salesOrderMarginDisplay";

export type ProposalListSummary = {
  totalProposals: number;
  totalNetAmount: number;
  totalGrossAmount: number;
  totalTaxAmount: number;
  totalCostAmount: number;
  totalMarginAmount: number;
  averageNetValue: number | null;
  totalMarginPercent: number | null;
};

export const ProposalListSummaryCards = memo(function ProposalListSummaryCards({
  summary,
  loading,
}: {
  summary: ProposalListSummary | null;
  loading: boolean;
}) {
  const totalProposals = summary?.totalProposals ?? 0;
  const totalNetAmount = summary?.totalNetAmount ?? 0;
  const totalTaxAmount = summary?.totalTaxAmount ?? 0;
  const totalCostAmount = summary?.totalCostAmount ?? 0;
  const totalMarginAmount = summary?.totalMarginAmount ?? 0;
  const averageNetValue = summary?.averageNetValue ?? null;
  const totalMarginPercent = summary?.totalMarginPercent ?? null;

  const taxShareOfNet = totalNetAmount > 0 ? (totalTaxAmount / totalNetAmount) * 100 : null;
  const costShareOfNet = totalNetAmount > 0 ? (totalCostAmount / totalNetAmount) * 100 : null;

  const taxSubtitle =
    taxShareOfNet != null ? `${formatSalesOrderMarginPercent(taxShareOfNet)} do valor proposto` : undefined;
  const costSubtitle =
    costShareOfNet != null ? `${formatSalesOrderMarginPercent(costShareOfNet)} do valor proposto` : undefined;

  const marginPercentLabel =
    totalMarginPercent != null ? formatSalesOrderMarginPercent(totalMarginPercent) : "—";
  const marginMoneyLabel =
    totalMarginAmount !== 0 ? formatCompactCurrency(totalMarginAmount) : "—";

  return (
    <div className="my-4" data-testid="proposal-list-summary-cards">
      <SummaryKpiGrid
        minColumnWidth={152}
        className={`${SYSTEM_TOTALIZER_GRID_CLASS} proposal-list-summary-grid`}
      >
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Propostas filtradas"
          amount={loading ? null : totalProposals}
          amountFormat="number"
          tone="info"
          icon={ShoppingBag}
          helperText="Quantidade de propostas que atendem aos filtros aplicados."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Valor proposto"
          amount={loading ? null : totalNetAmount}
          amountFormat="currency"
          tone="money"
          icon={Receipt}
          helperText="Soma do valor líquido das propostas filtradas."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Imposto estimado"
          amount={loading ? null : totalTaxAmount}
          amountFormat="currency"
          subtitle={loading ? undefined : taxSubtitle}
          tone="warning"
          icon={Percent}
          helperText="Total de impostos estimados das propostas filtradas."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Custo estimado"
          amount={loading ? null : totalCostAmount}
          amountFormat="currency"
          subtitle={loading ? undefined : costSubtitle}
          tone="internal"
          icon={Scale}
          helperText="Custo industrial/produção estimado das propostas filtradas."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Ticket médio"
          amount={loading ? null : averageNetValue}
          amountFormat="currency"
          tone="neutral"
          icon={Ticket}
          helperText="Valor líquido médio por proposta no filtro."
          loading={loading}
        />
        <SystemTotalizerCard
          className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
          label="Margem comercial"
          value={loading ? undefined : marginPercentLabel}
          subtitle={loading ? undefined : `R$ ${marginMoneyLabel}`}
          tone="highlight"
          icon={BadgePercent}
          helperText="Margem comercial ponderada das propostas filtradas."
          loading={loading}
        />
      </SummaryKpiGrid>
    </div>
  );
});
