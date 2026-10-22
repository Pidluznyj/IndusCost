import React, { useCallback, useEffect, useState } from "react";
import { MarketGlobalIndicatorsTrendsPanel } from "@/src/components/materials/MarketGlobalIndicatorsTrendsPanel";
import { useMarketGlobalIndicatorsRefresh } from "@/src/components/materials/marketGlobalIndicatorsRefresh";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MARKET_GLOBAL_INDICATORS_HISTORY_API,
  MARKET_TRENDS_ERROR_MESSAGE,
  type MarketGlobalIndicatorsHistoryDto,
  type MarketHistoryRange,
} from "@/src/lib/marketGlobalIndicatorsHistory";

export function MarketGlobalIndicatorsTrendsSection() {
  const refresh = useMarketGlobalIndicatorsRefresh();
  const [range, setRange] = useState<MarketHistoryRange>("30d");
  const [data, setData] = useState<MarketGlobalIndicatorsHistoryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<MarketGlobalIndicatorsHistoryDto>(
        `${MARKET_GLOBAL_INDICATORS_HISTORY_API}?range=${range}`
      );
      setData(payload);
    } catch {
      if (!silent) {
        setError(MARKET_TRENDS_ERROR_MESSAGE);
        setData(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [range, refresh?.revision]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return (
    <MarketGlobalIndicatorsTrendsPanel
      range={range}
      onRangeChange={setRange}
      loading={loading}
      error={error}
      onRetry={() => void load()}
      data={data}
    />
  );
}
