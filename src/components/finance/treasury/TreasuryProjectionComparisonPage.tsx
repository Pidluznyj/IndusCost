/**
 * Tela — Comparação de cenários de projeção (contratual / provável / confirmado).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryFinancialAccountDto,
  TreasuryProjectionComparisonDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { canViewTreasuryDashboard } from "@/src/lib/treasury/treasuryDashboardPermissions.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryAgendaUi.js";
import { fetchTreasuryProjectionComparison } from "@/src/lib/treasury/treasuryProjectionComparisonApi.js";
import { calculateTreasuryProjection } from "@/src/lib/treasury/treasuryProjectionCalculateApi.js";
import {
  TREASURY_COMPARISON_PAGE_SUBTITLE,
  TREASURY_COMPARISON_PAGE_TITLE,
  buildTreasuryComparisonQuery,
  createEmptyTreasuryComparisonFilters,
  isTreasuryAgendaPeriodPreset,
  parseVisibleScenariosParam,
  resolveTreasuryComparisonStaleState,
  resolveTreasuryComparisonViewKind,
  treasuryComparisonFetchKey,
  type TreasuryComparisonFilterState,
} from "@/src/lib/treasury/treasuryProjectionComparisonUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryProjectionComparisonPanel } from "./TreasuryProjectionComparisonPanel.js";

function readFilters(params: URLSearchParams): TreasuryComparisonFilterState {
  const base = createEmptyTreasuryComparisonFilters();
  const periodRaw = params.get("period") ?? base.period;
  return {
    period: isTreasuryAgendaPeriodPreset(periodRaw) ? periodRaw : base.period,
    baseDate: params.get("baseDate")?.trim() || base.baseDate,
    endDate: params.get("endDate")?.trim() || base.endDate,
    accountId: params.get("accountId") ?? "",
    companyCode: params.get("companyCode") ?? "",
    visibleScenarios: parseVisibleScenariosParam(params.get("scenarios")),
  };
}

function filtersToParams(filters: TreasuryComparisonFilterState): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.period !== "30d") qs.set("period", filters.period);
  if (filters.period === "custom") {
    if (filters.baseDate.trim()) qs.set("baseDate", filters.baseDate.trim());
    if (filters.endDate.trim()) qs.set("endDate", filters.endDate.trim());
  }
  if (filters.accountId.trim()) qs.set("accountId", filters.accountId.trim());
  if (filters.companyCode.trim()) {
    qs.set("companyCode", filters.companyCode.trim());
  }
  if (filters.visibleScenarios.length !== 3) {
    qs.set("scenarios", filters.visibleScenarios.join(","));
  }
  return qs;
}

export function TreasuryProjectionComparisonPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryDashboard(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const abortRef = useRef<AbortController | null>(null);
  const [comparison, setComparison] =
    useState<TreasuryProjectionComparisonDto | null>(null);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  /** Exclui visibleScenarios — toggle local não refetch. */
  const fetchKey = useMemo(() => {
    const q = buildTreasuryComparisonQuery({ filters, accounts });
    return treasuryComparisonFetchKey(q);
  }, [
    accounts,
    filters.period,
    filters.baseDate,
    filters.endDate,
    filters.accountId,
    filters.companyCode,
  ]);

  const hasData = Boolean(comparison && comparison.days.length > 0);
  const viewKind = resolveTreasuryComparisonViewKind({
    canView,
    loading,
    error,
    hasData,
  });
  const staleMessage = resolveTreasuryComparisonStaleState(comparison);

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const acc = await fetchTreasuryAccounts({
        page: 1,
        pageSize: 200,
        isActive: true,
        sortBy: "sortOrder",
        sortDirection: "asc",
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      const nextAccounts = acc?.rows ?? [];
      setAccounts(nextAccounts);

      // visibleScenarios intencionalmente ignorado no fetch.
      const q = buildTreasuryComparisonQuery({
        filters: {
          period: filters.period,
          baseDate: filters.baseDate,
          endDate: filters.endDate,
          accountId: filters.accountId,
          companyCode: filters.companyCode,
          visibleScenarios: filters.visibleScenarios,
        },
        accounts: nextAccounts,
      });
      const payload = await fetchTreasuryProjectionComparison({
        companyCode: q.companyCode,
        baseDate: q.baseDate,
        endDate: q.endDate,
        accountIds: q.accountIds,
        consolidated: q.consolidated,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setComparison(payload);
      setHeaderUpdatedAt(payload.freshness?.asOf ?? new Date().toISOString());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar a comparação de cenários.",
          err
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [
    canView,
    filters.period,
    filters.baseDate,
    filters.endDate,
    filters.accountId,
    filters.companyCode,
  ]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load, fetchKey]);

  const applyFilters = useCallback(
    (next: TreasuryComparisonFilterState) => {
      setSearchParams(filtersToParams(next), { replace: true });
    },
    [setSearchParams]
  );

  const clearFilters = useCallback(() => {
    applyFilters(createEmptyTreasuryComparisonFilters(todayCivilDateLocal()));
  }, [applyFilters]);

  const onCalculate = useCallback(async () => {
    if (!canView || calculating) return;
    setCalculating(true);
    setError(null);
    try {
      const q = buildTreasuryComparisonQuery({
        filters,
        accounts,
      });
      const scenarios = ["CONTRACTUAL", "PROBABLE", "CONFIRMED"] as const;
      for (const scenario of scenarios) {
        await calculateTreasuryProjection({
          companyCode: q.companyCode || "LAZARIOS",
          baseDate: q.baseDate,
          endDate: q.endDate,
          scenario,
          accountIds: q.accountIds,
          consolidated: q.consolidated,
          includeDayDetail: false,
        });
      }
      await load();
    } catch (err) {
      setError(
        buildFinanceTabLoadError(
          "Não foi possível recalcular as projeções.",
          err
        )
      );
    } finally {
      setCalculating(false);
    }
  }, [accounts, calculating, canView, filters, load]);

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-comparison-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_COMPARISON_PAGE_TITLE}
          subtitle={TREASURY_COMPARISON_PAGE_SUBTITLE}
          updatedAt={headerUpdatedAt}
          updatedAtLabel="Última atualização em"
          actions={[
            {
              id: "calculate",
              label: calculating ? "Calculando…" : "Recalcular projeções",
              onClick: () => void onCalculate(),
              disabled: calculating || !canView,
            },
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
        />

        <TreasuryProjectionComparisonPanel
          viewKind={viewKind}
          comparison={comparison}
          accounts={accounts}
          error={error}
          staleMessage={staleMessage}
          filters={filters}
          onFiltersChange={applyFilters}
          onRefresh={() => void load()}
          onClearFilters={clearFilters}
          onDismissError={() => setError(null)}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
