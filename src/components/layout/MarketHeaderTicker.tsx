import React, { memo, useEffect, useState } from "react";
import { DollarSign, Droplets, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { formatNumber } from "@/src/lib/utils";
import { cn } from "@/src/lib/utils";
import {
  buildMarketHeaderBrentTooltip,
  buildMarketHeaderPtaxTooltip,
  MARKET_HEADER_TICKER_API,
  MARKET_HEADER_TICKER_POLL_MS,
  type MarketHeaderTickerPayload,
} from "@/src/lib/marketHeaderTicker";

function formatPtaxDisplay(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `R$ ${formatNumber(value, 2)}`;
}

function formatBrentDisplay(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `US$ ${formatNumber(value, 2)}`;
}

function VariationIcon({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return <Minus className="h-3 w-3 text-muted-foreground/70" aria-hidden />;
  }
  if (value > 0) {
    return <TrendingUp className="h-3 w-3 text-emerald-600/80" aria-hidden />;
  }
  return <TrendingDown className="h-3 w-3 text-rose-600/80" aria-hidden />;
}

function TickerPill({
  testId,
  icon: Icon,
  label,
  compactLabel,
  value,
  tooltip,
  stale,
  loading,
  variation,
}: {
  testId: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  compactLabel: string;
  value: string;
  tooltip: string;
  stale?: boolean;
  loading?: boolean;
  variation?: number | null;
}) {
  return (
    <div
      data-testid={testId}
      title={tooltip}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] leading-none",
        "bg-background/80 border-border/70 text-foreground/90 shadow-sm",
        stale && "border-amber-300/60 bg-amber-50/40"
      )}
    >
      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
      <span className="hidden md:inline font-medium text-muted-foreground">{label}</span>
      <span className="md:hidden font-medium text-muted-foreground">{compactLabel}</span>
      <span className="font-semibold tabular-nums whitespace-nowrap">
        {loading ? "…" : value}
      </span>
      {variation !== undefined ? <VariationIcon value={variation} /> : null}
    </div>
  );
}

export const MarketHeaderTicker = memo(function MarketHeaderTicker() {
  const [data, setData] = useState<MarketHeaderTickerPayload | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const payload = await fetchJsonOk<MarketHeaderTickerPayload>(MARKET_HEADER_TICKER_API);
        if (!cancelled) {
          setData(payload);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setData(null);
          setLoading(false);
        }
      }
    };

    void load();
    const timer = window.setInterval(load, MARKET_HEADER_TICKER_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const ptax = data?.ptax ?? { available: false };
  const brent = data?.brent ?? { available: false };

  return (
    <div
      data-testid="market-header-ticker"
      className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink"
    >
      <TickerPill
        testId="market-header-ticker-ptax"
        icon={DollarSign}
        label="USD/PTAX"
        compactLabel="USD"
        value={ptax.available ? formatPtaxDisplay(ptax.sell) : "—"}
        tooltip={buildMarketHeaderPtaxTooltip(ptax)}
        stale={ptax.stale}
        loading={loading}
      />
      <TickerPill
        testId="market-header-ticker-brent"
        icon={Droplets}
        label="Brent"
        compactLabel="Brent"
        value={brent.available ? formatBrentDisplay(brent.priceUsd) : "—"}
        tooltip={buildMarketHeaderBrentTooltip(brent)}
        stale={brent.stale}
        loading={loading}
        variation={brent.changePercent ?? null}
      />
    </div>
  );
});
