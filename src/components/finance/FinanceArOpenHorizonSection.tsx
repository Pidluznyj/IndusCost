import React, { useMemo } from "react";
import { CalendarRange } from "lucide-react";
import type {
  AccountsReceivableOpenHorizon,
} from "@/src/lib/financeAccountsReceivableHorizon";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { FinanceAgingBucketDrilldownSection } from "@/src/components/finance/shared/FinanceAgingBucketDrilldownSection";
import { createDefaultFinanceArUiFilters } from "@/src/lib/financeAccountsReceivableDashboardTypes";
import type { FinanceAgingBucketCardSource } from "@/src/lib/financeAgingBucketDrilldownTypes";

function HorizonDistributionBar({
  segments,
}: {
  segments: Array<{ key: string; label: string; amount: number; widthPercent: number }>;
}) {
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-[#F3F4F6]">
        {segments.map((segment) =>
          segment.amount > 0 ? (
            <div
              key={segment.key}
              className={cn(
                "h-full",
                segment.key === "overdue" ? "bg-[#DC2626]" : "bg-[#2563EB]"
              )}
              style={{ width: `${segment.widthPercent}%` }}
              title={`${segment.label}: ${formatFinanceKpiCurrency(segment.amount)}`}
            />
          ) : null
        )}
      </div>
    </div>
  );
}

export function FinanceArOpenHorizonSection({
  horizon,
  loading = false,
}: {
  horizon: AccountsReceivableOpenHorizon | null | undefined;
  loading?: boolean;
}) {
  const cards = useMemo((): FinanceAgingBucketCardSource[] => {
    if (!horizon) return [];
    return [horizon.overdue, ...horizon.buckets, horizon.total60].map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      amount: bucket.amount,
      count: bucket.titlesCount,
    }));
  }, [horizon]);

  const distributionSegments = useMemo(() => {
    if (!horizon) return [];
    const items = [...horizon.buckets, horizon.total60];
    const max = Math.max(...items.map((b) => b.amount), 1);
    return items.map((b) => ({
      key: b.key,
      label: b.label,
      amount: b.amount,
      widthPercent: (b.amount / max) * 100,
    }));
  }, [horizon]);

  if (!horizon && !loading) return null;

  return (
    <section className={financeBiSectionClass}>
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h2 className="text-sm font-bold text-[#111827]">
          {horizon?.title ?? "Horizonte financeiro — carteira aberta"}
        </h2>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          {horizon?.subtitle ?? "Próximos 60 dias a partir de hoje"}
        </p>
        {horizon?.scopeNote ? (
          <p className="text-[10px] text-[#9CA3AF] mt-1 leading-snug">{horizon.scopeNote}</p>
        ) : null}
        {horizon?.overdueNote ? (
          <p className="text-[10px] text-[#9CA3AF] mt-0.5 leading-snug">{horizon.overdueNote}</p>
        ) : null}
        {horizon?.insights.length ? (
          <ul className="mt-2 space-y-0.5">
            {horizon.insights.map((insight) => (
              <li key={insight} className="text-[10px] text-[#4B5563]">
                {insight}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="p-5 space-y-4">
        <FinanceAgingBucketDrilldownSection
          module="ar"
          cards={cards}
          filters={createDefaultFinanceArUiFilters()}
          horizonMode
          loadingCards={loading && !horizon}
          cardTone={(key) => (key === "overdue" ? "danger" : "neutral")}
        />

        {horizon ? <HorizonDistributionBar segments={distributionSegments} /> : null}
      </div>
    </section>
  );
}
