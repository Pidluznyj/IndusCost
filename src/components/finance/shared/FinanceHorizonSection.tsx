import React from "react";
import { CalendarRange } from "lucide-react";
import { FinanceKpiCard, type FinanceKpiCardProps } from "@/src/components/finance/shared/FinanceKpiCard";
import type { FinanceHorizonSummary } from "@/src/lib/financeHorizonAggregation";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceAgingBucketDrilldownSection } from "@/src/components/finance/shared/FinanceAgingBucketDrilldownSection";
import { mapHorizonBucketsToCards } from "@/src/lib/financeAgingBucketDrilldownTypes";
import type { FinanceApUiFilters } from "@/src/lib/financeAccountsPayableDashboardTypes";
import type { FinanceArUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";

type FinanceHorizonVariant = "ap" | "ar" | "billing";

type HorizonSkeletonCard = FinanceKpiCardProps & { id: string };

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
  filters?: FinanceApUiFilters | FinanceArUiFilters;
  enableDrilldown?: boolean;
}) {
  if (!summary && !loading) return null;

  const cards = summary ? mapHorizonBucketsToCards(summary.buckets, summary.total) : [];

  return (
    <section className={financeBiSectionClass}>
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-sm font-bold text-[#111827]">
          {summary?.title ?? "Horizonte financeiro — próximos 60 dias"}
        </h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          {summary?.subtitle ??
            "Distribuição por janela operacional a partir de hoje. Valores não acumulativos."}
        </p>
        {summary?.scopeNote ? (
          <p className="text-[10px] text-[#9CA3AF] mt-1 leading-snug">{summary.scopeNote}</p>
        ) : null}
      </div>
      <div className="p-5">
        {enableDrilldown && variant === "ap" && filters ? (
          <FinanceAgingBucketDrilldownSection
            module="ap"
            cards={cards}
            filters={filters}
            horizonMode
            loadingCards={loading && !summary}
          />
        ) : loading && !summary ? (
          <div className="indus-kpi-grid indus-kpi-grid--wide">
            {HORIZON_SKELETON_CARDS.map(({ id, ...cardProps }) => (
              <React.Fragment key={id}>
                <FinanceKpiCard {...cardProps} />
              </React.Fragment>
            ))}
          </div>
        ) : (
          <div className="indus-kpi-grid indus-kpi-grid--wide">
            {cards.map((bucket) => (
              <React.Fragment key={bucket.key}>
                <FinanceKpiCard
                  icon={CalendarRange}
                  label={bucket.label}
                  value={formatFinanceKpiCurrency(bucket.amount)}
                  subtitle={bucket.count > 0 ? `${bucket.count} título(s)` : "—"}
                  compact
                />
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
