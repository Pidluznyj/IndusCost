/**
 * Apoio ao Caixa — página read-only (CS-007). Busca dados e delega a
 * apresentação ao `CashSupportPanel` (puramente apresentacional, testável
 * sem rede via SSR estático).
 */

import React, { useEffect, useState } from "react";
import {
  fetchCashSupport,
  type CashSupportFetchParams,
} from "@/src/lib/treasury/cashSupportApi.js";
import type { CashSupportReadModel } from "@/src/lib/treasury/contracts/cashSupportContracts.js";
import { CashSupportPanel } from "./CashSupportPanel.js";

export type CashSupportWorkspacePageProps = {
  civilDateFrom: string;
  civilDateTo: string;
  /** Injeção para teste — em produção usa `fetchCashSupport`. */
  fetcher?: typeof fetchCashSupport;
};

export function CashSupportWorkspacePage({
  civilDateFrom,
  civilDateTo,
  fetcher = fetchCashSupport,
}: CashSupportWorkspacePageProps) {
  const [data, setData] = useState<CashSupportReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params: CashSupportFetchParams = {
      civilDateFrom,
      civilDateTo,
      signal: controller.signal,
    };
    fetcher(params)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Falha ao carregar.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [civilDateFrom, civilDateTo, fetcher]);

  return (
    <CashSupportPanel
      civilDateFrom={civilDateFrom}
      civilDateTo={civilDateTo}
      loading={loading}
      error={error}
      data={data}
    />
  );
}
