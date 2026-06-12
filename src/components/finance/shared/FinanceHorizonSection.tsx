import React from "react";
import { CalendarRange } from "lucide-react";
import { FinanceKpiCard, type FinanceKpiCardProps } from "@/src/components/finance/shared/FinanceKpiCard";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import type { FinanceHorizonBucketKey, FinanceHorizonBucketValue } from "@/src/lib/financeHorizonBuckets";
import type { FinanceHorizonSummary } from "@/src/lib/financeHorizonAggregation";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import {
  FINANCE_HORIZON_AP_BUCKET_TOOLTIPS,
  FINANCE_HORIZON_AR_BUCKET_TOOLTIPS,
  FINANCE_HORIZON_BILLING_BUCKET_TOOLTIPS,
  FINANCE_HORIZON_TOTAL_TOOLTIP,
} from "@/src/lib/financeKpiTooltips";

type FinanceHorizonVariant = "ap" | "ar" | "billing";

const BUCKET_TOOLTIPS: Record<FinanceHorizonVariant, Record<string, string>> = {
  ap: FINANCE_HORIZON_AP_BUCKET_TOOLTIPS,
  ar: FINANCE_HORIZON_AR_BUCKET_TOOLTIPS,
  billing: FINANCE_HORIZON_BILLING_BUCKET_TOOLTIPS,
};

type HorizonSkeletonCard = FinanceKpiCardProps & { id: string };

const HORIZON_SKELETON_CARDS: HorizonSkeletonCard[] = Array.from({ length: 6 }, (_, index) => ({
  id: `horizon-skeleton-${index}`,
  icon: CalendarRange,
  label: "…",
  value: "…",
  loading: true,
  compact: true,
}));

function bucketHelper(variant: FinanceHorizonVariant, key: FinanceHorizonBucketKey): string {
  if (key === "total_60") return FINANCE_HORIZON_TOTAL_TOOLTIP;
  return BUCKET_TOOLTIPS[variant][key] ?? FINANCE_HORIZON_TOTAL_TOOLTIP;
}

function HorizonCard({
  bucket,
  countUnitLabel,
  variant,
  loading,
}: {
  bucket: FinanceHorizonBucketValue;
  countUnitLabel: string;
  variant: FinanceHorizonVariant;
  loading?: boolean;
}) {
  const countLabel =
    bucket.count > 0 ? `${bucket.count} ${countUnitLabel}` : bucket.key === "total_60" ? "Soma das faixas" : "—";

  return (
    <FinanceKpiCard
      icon={CalendarRange}
      label={bucket.label}
      value={loading ? "…" : formatFinanceKpiCurrency(bucket.amount)}
      subtitle={countLabel}
      helperText={bucketHelper(variant, bucket.key)}
      compact
      loading={loading}
    />
  );
}

export function FinanceHorizonSection({
  summary,
  variant,
  loading = false,
}: {
  summary: FinanceHorizonSummary | null | undefined;
  variant: FinanceHorizonVariant;
  loading?: boolean;
}) {
  if (!summary && !loading) return null;

  const cards = summary ? [...summary.buckets, summary.total] : [];

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
      <div className="p-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6">
        {loading && !summary
          ? HORIZON_SKELETON_CARDS.map(({ id, ...cardProps }) => (
              <React.Fragment key={id}>
                <FinanceKpiCard {...cardProps} />
              </React.Fragment>
            ))
          : cards.map((bucket) => (
              <React.Fragment key={bucket.key}>
                <HorizonCard
                  bucket={bucket}
                  countUnitLabel={summary?.countUnitLabel ?? "item(ns)"}
                  variant={variant}
                  loading={loading}
                />
              </React.Fragment>
            ))}
      </div>
    </section>
  );
}
