/**
 * Página — Tesouraria de hoje (experiência guiada).
 * Um único endpoint agregado; detalhes sob demanda nas rotas de continuar/abrir conta.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { TreasuryGuidedTodayDto } from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryToday } from "@/src/lib/treasury/treasuryTodayApi.js";
import { canViewTreasuryToday } from "@/src/lib/treasury/treasuryTodayPermissions.js";
import { buildTreasurySimpleRefreshHeaderAction } from "@/src/lib/treasury/treasurySimpleUiShared.js";
import {
  TREASURY_TODAY_PAGE_SUBTITLE,
  TREASURY_TODAY_PAGE_TITLE,
  buildTreasuryTodayQuery,
  resolveTreasuryTodayViewKind,
  todayCivilDateLocal,
} from "@/src/lib/treasury/treasuryTodayUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryTodayPanel } from "./TreasuryTodayPanel.js";

export function TreasuryTodayPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryToday(permCheck);

  const abortRef = useRef<AbortController | null>(null);
  const [data, setData] = useState<TreasuryGuidedTodayDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const query = useMemo(
    () => buildTreasuryTodayQuery({ date: todayCivilDateLocal() }),
    []
  );

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryToday({
        ...query,
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setData(payload);
      setHeaderUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(
        buildFinanceTabLoadError("Não foi possível carregar a Tesouraria de hoje.", err)
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canView, query]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const viewKind = resolveTreasuryTodayViewKind({
    canView,
    loading,
    error,
    data,
  });

  return (
    <FinanceBiDashboardShell
      header={
        <FinanceExecutivePageHeader
          title={TREASURY_TODAY_PAGE_TITLE}
          subtitle={TREASURY_TODAY_PAGE_SUBTITLE}
          updatedAt={headerUpdatedAt}
          actions={[
            buildTreasurySimpleRefreshHeaderAction({
              onClick: () => void load(),
              disabled: loading || !canView,
            }),
          ]}
        />
      }
    >
      <TreasuryTodayPanel
        viewKind={viewKind}
        data={data}
        error={error}
        onRefresh={() => void load()}
        onDismissError={() => setError(null)}
      />
    </FinanceBiDashboardShell>
  );
}
