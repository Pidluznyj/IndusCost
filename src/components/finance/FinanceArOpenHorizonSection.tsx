import React, { useMemo, useState } from "react";
import { AlertTriangle, CalendarRange } from "lucide-react";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import type {
  AccountsReceivableOpenHorizon,
  AccountsReceivableOpenHorizonBucket,
  AccountsReceivableOpenHorizonBucketKey,
} from "@/src/lib/financeAccountsReceivableHorizon";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

function bucketSelectionLabel(bucket: AccountsReceivableOpenHorizonBucket): string {
  if (bucket.key === "overdue") {
    return `Exibindo ${bucket.titlesCount} título(s) vencidos com saldo em aberto.`;
  }
  if (bucket.key === "total_60") {
    return `Exibindo ${bucket.titlesCount} título(s) com vencimento nos próximos 60 dias.`;
  }
  if (bucket.fromDays != null && bucket.toDays != null) {
    return `Exibindo ${bucket.titlesCount} título(s) com vencimento entre ${bucket.fromDays} e ${bucket.toDays} dias.`;
  }
  return `Exibindo ${bucket.titlesCount} título(s) do bucket ${bucket.label}.`;
}

function HorizonBucketCard({
  bucket,
  active,
  loading,
  onSelect,
}: {
  bucket: AccountsReceivableOpenHorizonBucket;
  active: boolean;
  loading?: boolean;
  onSelect: () => void;
}) {
  const subtitleParts = [
    bucket.titlesCount > 0 ? `${bucket.titlesCount} título(s)` : "—",
    bucket.shareOfTotal60 != null && bucket.shareOfTotal60 > 0
      ? `${bucket.shareOfTotal60.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do horizonte`
      : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "text-left rounded-xl transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        active && "ring-2 ring-[#2563EB] shadow-sm"
      )}
    >
      <FinanceKpiCard
        icon={bucket.key === "overdue" ? AlertTriangle : CalendarRange}
        label={bucket.label}
        value={loading ? "…" : formatFinanceKpiCurrency(bucket.amount)}
        subtitle={subtitleParts.join(" · ")}
        helperText={bucket.tooltip}
        tone={bucket.key === "overdue" && bucket.amount > 0 ? "danger" : "neutral"}
        compact
        loading={loading}
      />
    </button>
  );
}

function HorizonDistributionBar({ horizon }: { horizon: AccountsReceivableOpenHorizon }) {
  const segments = useMemo(() => {
    const items = [...horizon.buckets, horizon.total60];
    const max = Math.max(...items.map((b) => b.amount), 1);
    return items.map((b) => ({ ...b, widthPercent: (b.amount / max) * 100 }));
  }, [horizon]);

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
  const [selectedKey, setSelectedKey] = useState<AccountsReceivableOpenHorizonBucketKey | null>(null);

  const allCards = useMemo(() => {
    if (!horizon) return [];
    return [horizon.overdue, ...horizon.buckets, horizon.total60];
  }, [horizon]);

  const activeKey = selectedKey ?? (horizon ? "total_60" : null);
  const activeBucket = allCards.find((b) => b.key === activeKey) ?? null;
  const activeTitles = horizon && activeKey ? horizon.titlesByBucket[activeKey] ?? [] : [];

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
        <div className="indus-kpi-grid indus-kpi-grid--wide">
          {loading && !horizon
            ? Array.from({ length: 7 }, (_, index) => (
                <React.Fragment key={`horizon-skeleton-${index}`}>
                  <FinanceKpiCard icon={CalendarRange} label="…" value="…" loading compact />
                </React.Fragment>
              ))
            : allCards.map((bucket) => (
                <React.Fragment key={bucket.key}>
                  <HorizonBucketCard
                    bucket={bucket}
                    active={activeKey === bucket.key}
                    loading={loading}
                    onSelect={() => setSelectedKey(bucket.key)}
                  />
                </React.Fragment>
              ))}
        </div>

        {horizon ? <HorizonDistributionBar horizon={horizon} /> : null}

        {activeBucket && activeTitles.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] text-[#6B7280]">{bucketSelectionLabel(activeBucket)}</p>
            <div className="overflow-x-auto rounded-lg border border-[#E5E7EB]">
              <table className="min-w-full text-[11px]">
                <thead className="bg-[#F9FAFB] text-[#6B7280]">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Vencimento</th>
                    <th className="px-3 py-2 text-left font-semibold">Cliente</th>
                    <th className="px-3 py-2 text-left font-semibold">NF/Título</th>
                    <th className="px-3 py-2 text-right font-semibold">Valor em aberto</th>
                    <th className="px-3 py-2 text-right font-semibold">Dias</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTitles.slice(0, 25).map((title) => (
                    <tr key={title.id} className="border-t border-[#F3F4F6]">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {title.dueDate
                          ? new Date(title.dueDate).toLocaleDateString("pt-BR")
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{title.customerName ?? "—"}</td>
                      <td className="px-3 py-2">
                        {title.invoiceNumber?.trim() || title.titleNumber?.trim() || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatFinanceKpiCurrency(title.amountOpen)}
                      </td>
                      <td className="px-3 py-2 text-right">{title.daysUntilDue}</td>
                      <td className="px-3 py-2">{title.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
