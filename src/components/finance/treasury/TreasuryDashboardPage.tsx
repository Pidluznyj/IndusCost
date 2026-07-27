/**
 * Tela principal — Central de Tesouraria (visão geral / dashboard diário).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryDashboardDto,
  TreasuryFinancialAccountDto,
  TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryDashboard } from "@/src/lib/treasury/treasuryDashboardApi.js";
import { canViewTreasuryDashboard } from "@/src/lib/treasury/treasuryDashboardPermissions.js";
import {
  TREASURY_DASHBOARD_PAGE_SUBTITLE,
  TREASURY_DASHBOARD_PAGE_TITLE,
  buildTreasuryDashboardQuery,
  createEmptyTreasuryDashboardFilters,
  findDashboardCompositionItem,
  isTreasuryDashboardPeriod,
  isTreasuryDashboardScenario,
  isTreasuryDashboardRecalculating,
  resolveTreasuryDashboardStaleState,
  resolveTreasuryDashboardViewKind,
  todayCivilDateLocal,
  type TreasuryDashboardFilterState,
} from "@/src/lib/treasury/treasuryDashboardUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryDashboardDetailDrawer } from "./TreasuryDashboardDetailDrawer.js";
import { TreasuryDashboardPanel } from "./TreasuryDashboardPanel.js";

function readFilters(params: URLSearchParams): TreasuryDashboardFilterState {
  const base = createEmptyTreasuryDashboardFilters();
  const date = params.get("date")?.trim() || base.date;
  const periodRaw = params.get("period") ?? "day";
  const scenarioRaw = params.get("scenario") ?? "PROBABLE";
  return {
    date,
    period: isTreasuryDashboardPeriod(periodRaw) ? periodRaw : "day",
    accountId: params.get("accountId") ?? params.get("accountIds") ?? "",
    scenario: isTreasuryDashboardScenario(scenarioRaw)
      ? (scenarioRaw as TreasuryProjectionLayer)
      : "PROBABLE",
  };
}

function filtersToParams(filters: TreasuryDashboardFilterState): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.date.trim()) qs.set("date", filters.date.trim());
  if (filters.period !== "day") qs.set("period", filters.period);
  if (filters.accountId.trim()) qs.set("accountId", filters.accountId.trim());
  if (filters.scenario !== "PROBABLE") qs.set("scenario", filters.scenario);
  return qs;
}

export function TreasuryDashboardPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryDashboard(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const detailKey = searchParams.get("detail");

  const abortRef = useRef<AbortController | null>(null);
  const [dashboard, setDashboard] = useState<TreasuryDashboardDto | null>(null);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const query = useMemo(
    () => buildTreasuryDashboardQuery({ filters }),
    [filters]
  );

  const hasData = Boolean(dashboard);
  const viewKind = resolveTreasuryDashboardViewKind({
    canView,
    loading,
    error,
    hasData:
      hasData &&
      ((dashboard?.accounts.length ?? 0) > 0 ||
        dashboard?.currentBalance != null ||
        dashboard?.observedBalance != null),
    hasFilters: query.hasFilters,
  });

  const staleMessage = resolveTreasuryDashboardStaleState(dashboard);
  const recalculating = isTreasuryDashboardRecalculating({
    loading,
    hasData,
  });

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const [dash, acc] = await Promise.all([
        fetchTreasuryDashboard({
          date: query.date,
          accountIds: query.accountIds,
          scenario: query.scenario,
          signal: controller.signal,
        }),
        fetchTreasuryAccounts({
          page: 1,
          pageSize: 200,
          isActive: true,
          sortBy: "sortOrder",
          sortDirection: "asc",
          signal: controller.signal,
        }).catch(() => null),
      ]);
      if (controller.signal.aborted) return;
      setDashboard(dash);
      if (acc?.rows) setAccounts(acc.rows);
      setHeaderUpdatedAt(dash.asOf ?? new Date().toISOString());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar o dashboard da Tesouraria.",
          err
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, query.accountIds, query.date, query.scenario]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const applyFilters = useCallback(
    (next: TreasuryDashboardFilterState) => {
      const qs = filtersToParams(next);
      if (detailKey) qs.set("detail", detailKey);
      setSearchParams(qs, { replace: true });
    },
    [detailKey, setSearchParams]
  );

  const clearFilters = useCallback(() => {
    applyFilters(createEmptyTreasuryDashboardFilters(todayCivilDateLocal()));
  }, [applyFilters]);

  const openTotal = useCallback(
    (compositionKey: string) => {
      const qs = filtersToParams(filters);
      qs.set("detail", compositionKey);
      setSearchParams(qs, { replace: true });
    },
    [filters, setSearchParams]
  );

  const closeDetail = useCallback(() => {
    const qs = filtersToParams(filters);
    setSearchParams(qs, { replace: true });
  }, [filters, setSearchParams]);

  const detailItem = findDashboardCompositionItem(dashboard, detailKey);

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-dashboard-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_DASHBOARD_PAGE_TITLE}
          subtitle={TREASURY_DASHBOARD_PAGE_SUBTITLE}
          updatedAt={headerUpdatedAt}
          updatedAtLabel="Última atualização em"
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
        />

        <TreasuryDashboardPanel
          viewKind={viewKind}
          dashboard={dashboard}
          accounts={accounts}
          error={error}
          staleMessage={staleMessage}
          recalculating={recalculating}
          filters={filters}
          onFiltersChange={applyFilters}
          onRefresh={() => void load()}
          onClearFilters={clearFilters}
          onOpenTotal={openTotal}
          onDismissError={() => setError(null)}
        />

        <TreasuryDashboardDetailDrawer
          open={Boolean(detailKey)}
          item={detailItem}
          dashboard={dashboard}
          onClose={closeDetail}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
