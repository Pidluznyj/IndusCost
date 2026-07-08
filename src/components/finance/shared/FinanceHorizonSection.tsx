import React from "react";
import { CalendarRange } from "lucide-react";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceExecutiveTotalizerCard, type FinanceExecutiveTotalizerCardProps } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import type { FinanceHorizonSummary } from "@/src/lib/financeHorizonAggregation";
import { FinanceBillingHorizonDrilldownSection } from "@/src/components/finance/billing/FinanceBillingHorizonDrilldownSection";
import { FinanceAgingBucketDrilldownSection } from "@/src/components/finance/shared/FinanceAgingBucketDrilldownSection";
import { mapHorizonBucketsToCards } from "@/src/lib/financeAgingBucketDrilldownTypes";
import type { FinanceApUiFilters } from "@/src/lib/financeAccountsPayableDashboardTypes";
import type { FinanceArUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import type { FinanceBillingHorizonDrilldownFilters } from "@/src/lib/financeBillingHorizonDrilldownTypes";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";

type FinanceHorizonVariant = "ap" | "ar" | "billing";

type HorizonSkeletonCard = FinanceExecutiveTotalizerCardProps & { id: string };

const HORIZON_SKELETON_CARDS: HorizonSkeletonCard[] = Array.from({ length: 6 }, (_, index) => ({
  id: `horizon-skeleton-${index}`,
  icon: CalendarRange,
  label: "…",
  value: "…",
  loading: true,
  compact: true,
}));

export function FinanceHorizonSection({
  summary,
  variant,
  loading = false,
  filters,
  enableDrilldown = false,
}: {
  summary: FinanceHorizonSummary | null | undefined;
  variant: FinanceHorizonVariant;
  loading?: boolean;
  filters?: FinanceApUiFilters | FinanceArUiFilters | FinanceBillingHorizonDrilldownFilters;
  enableDrilldown?: boolean;
}) {
  if (!summary && !loading) return null;

  const cards = summary ? mapHorizonBucketsToCards(summary.buckets, summary.total) : [];
  const title = summary?.title ?? "Horizonte financeiro — próximos 60 dias";
  const eyebrow =
    summary?.subtitle ??
    "Distribuição por janela operacional a partir de hoje. Valores não acumulativos.";

  return (
    <ExecutiveSummarySection
      title={title}
      eyebrow={eyebrow}
      footer={summary?.scopeNote ? <span>{summary.scopeNote}</span> : undefined}
      testId={`finance-${variant}-horizon-summary`}
    >
      {enableDrilldown && variant === "ap" && filters ? (
        <FinanceAgingBucketDrilldownSection
          module="ap"
          cards={cards}
          filters={filters as FinanceApUiFilters}
          horizonMode
          loadingCards={loading && !summary}
        />
      ) : enableDrilldown && variant === "billing" && filters ? (
        <FinanceBillingHorizonDrilldownSection
          cards={cards}
          filters={filters as FinanceBillingHorizonDrilldownFilters}
          countUnitLabel={summary?.countUnitLabel ?? "pedido(s)"}
          loadingCards={loading && !summary}
        />
      ) : loading && !summary ? (
        <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          {HORIZON_SKELETON_CARDS.map(({ id, ...cardProps }) => (
            <FinanceExecutiveTotalizerCard key={id} {...cardProps} />
          ))}
        </SummaryKpiGrid>
      ) : (
        <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          {cards.map((bucket) => (
            <FinanceExecutiveTotalizerCard
              key={bucket.key}
              icon={CalendarRange}
              label={bucket.label}
              value={formatFinanceKpiCurrency(bucket.amount)}
              subtitle={
                bucket.count > 0
                  ? `${bucket.count} ${summary?.countUnitLabel ?? "título(s)"}`
                  : "—"
              }
              compact
            />
          ))}
        </SummaryKpiGrid>
      )}
    </ExecutiveSummarySection>
  );
}
