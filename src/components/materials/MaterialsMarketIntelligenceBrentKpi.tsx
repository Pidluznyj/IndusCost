import React, { useCallback, useEffect, useState } from "react";
import { Droplets, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { cn, formatNumber } from "@/src/lib/utils";
import type { BrentSnapshotApiItem } from "@/src/lib/brentCommodityCollection";
import { BRENT_COMMODITY_LATEST_API } from "@/src/lib/materialsNavigation";

function formatQuoteDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function formatVariation(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 2)}%`;
}

export function MaterialsMarketIntelligenceBrentKpi() {
  const [snapshot, setSnapshot] = useState<BrentSnapshotApiItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMissing(false);
    try {
      const data = await fetchJsonOk<BrentSnapshotApiItem>(BRENT_COMMODITY_LATEST_API);
      setSnapshot(data);
    } catch (e: unknown) {
      if (e instanceof HttpError && e.status === 404) {
        setSnapshot(null);
        setMissing(true);
      } else {
        setSnapshot(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div
        className="flex items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4"
        data-testid="materials-market-intelligence-brent-kpi-loading"
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">Carregando Brent…</span>
      </div>
    );
  }

  if (missing || !snapshot || snapshot.status !== "SUCCESS" || snapshot.priceUSD == null) {
    return (
      <div
        className="flex items-start gap-3 rounded-2xl border border-dashed border-border bg-muted/20 px-5 py-4"
        data-testid="materials-market-intelligence-brent-kpi-empty"
      >
        <Droplets className="mt-0.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-foreground">Brent (USD/bbl)</p>
          <p className="text-xs text-muted-foreground">
            Nenhuma cotação Brent coletada ainda. Execute a coleta manual para exibir o indicador.
          </p>
        </div>
      </div>
    );
  }

  const variation = snapshot.variationFromPrevious;
  const variationUp = variation != null && variation > 0;
  const variationDown = variation != null && variation < 0;
  const VariationIcon = variationUp ? TrendingUp : variationDown ? TrendingDown : null;

  return (
    <div
      className="rounded-2xl border border-border bg-card px-5 py-4 shadow-sm"
      data-testid="materials-market-intelligence-brent-kpi"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Droplets className="h-5 w-5 text-primary" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Brent
            </p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              US$ {formatNumber(snapshot.priceUSD, 2)}
            </p>
          </div>
        </div>
        {variation != null && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              variationUp && "bg-emerald-50 text-emerald-800",
              variationDown && "bg-red-50 text-red-800",
              !variationUp && !variationDown && "bg-muted text-muted-foreground"
            )}
          >
            {VariationIcon ? <VariationIcon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {formatVariation(variation)}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Referência {formatQuoteDate(snapshot.quoteDate)} · fonte {snapshot.source ?? "—"}
      </p>
    </div>
  );
}
