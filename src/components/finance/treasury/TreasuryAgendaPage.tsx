/**
 * Tela — Agenda financeira da Central de Tesouraria.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type {
  TreasuryAgendaDto,
  TreasuryFinancialAccountDto,
  TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import { canViewTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaPermissions.js";
import {
  TREASURY_AGENDA_PAGE_SUBTITLE,
  TREASURY_AGENDA_PAGE_TITLE,
  buildTreasuryAgendaQuery,
  createEmptyTreasuryAgendaFilters,
  isTreasuryAgendaPeriodPreset,
  isTreasuryAgendaScenario,
  isTreasuryAgendaViewMode,
  resolveTreasuryAgendaStaleState,
  resolveTreasuryAgendaViewKind,
  todayCivilDateLocal,
  type TreasuryAgendaFilterState,
} from "@/src/lib/treasury/treasuryAgendaUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryAgendaPanel } from "./TreasuryAgendaPanel.js";

function readFilters(params: URLSearchParams): TreasuryAgendaFilterState {
  const base = createEmptyTreasuryAgendaFilters();
  const periodRaw = params.get("period") ?? base.period;
  const viewRaw = params.get("view") ?? base.viewMode;
  const scenarioRaw = params.get("scenario") ?? base.scenario;
  return {
    period: isTreasuryAgendaPeriodPreset(periodRaw) ? periodRaw : base.period,
    baseDate: params.get("baseDate")?.trim() || base.baseDate,
    endDate: params.get("endDate")?.trim() || base.endDate,
    viewMode: isTreasuryAgendaViewMode(viewRaw) ? viewRaw : base.viewMode,
    accountId: params.get("accountId") ?? params.get("accountIds") ?? "",
    groupKey: params.get("group") ?? "",
    scenario: isTreasuryAgendaScenario(scenarioRaw)
      ? (scenarioRaw as TreasuryProjectionLayer)
      : base.scenario,
    companyCode: params.get("companyCode") ?? "",
  };
}

function filtersToParams(filters: TreasuryAgendaFilterState): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.period !== "7d") qs.set("period", filters.period);
  if (filters.period === "custom") {
    if (filters.baseDate.trim()) qs.set("baseDate", filters.baseDate.trim());
    if (filters.endDate.trim()) qs.set("endDate", filters.endDate.trim());
  }
  if (filters.viewMode !== "consolidated") qs.set("view", filters.viewMode);
  if (filters.accountId.trim()) qs.set("accountId", filters.accountId.trim());
  if (filters.groupKey.trim()) qs.set("group", filters.groupKey.trim());
  if (filters.scenario !== "PROBABLE") qs.set("scenario", filters.scenario);
  if (filters.companyCode.trim()) qs.set("companyCode", filters.companyCode.trim());
  return qs;
}

export function TreasuryAgendaPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryAgenda(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const abortRef = useRef<AbortController | null>(null);
  const [agenda, setAgenda] = useState<TreasuryAgendaDto | null>(null);
  const [accounts, setAccounts] = useState<TreasuryFinancialAccountDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [headerUpdatedAt, setHeaderUpdatedAt] = useState<string | null>(null);

  const query = useMemo(
    () => buildTreasuryAgendaQuery({ filters, accounts }),
    [filters, accounts]
  );

  const hasData = Boolean(agenda && agenda.days.length > 0);
  const viewKind = resolveTreasuryAgendaViewKind({
    canView,
    loading,
    error,
    hasData,
    hasFilters: query.hasFilters,
  });

  const staleMessage = resolveTreasuryAgendaStaleState(agenda);

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

      const agendaQuery = buildTreasuryAgendaQuery({
        filters,
        accounts: nextAccounts,
      });
      const payload = await fetchTreasuryAgenda({
        companyCode: agendaQuery.companyCode,
        baseDate: agendaQuery.baseDate,
        endDate: agendaQuery.endDate,
        scenario: agendaQuery.scenario,
        accountIds: agendaQuery.accountIds,
        consolidated: agendaQuery.consolidated,
        includeDayDetail: agendaQuery.includeDayDetail,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAgenda(payload);
      setHeaderUpdatedAt(payload.freshness?.asOf ?? new Date().toISOString());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar a agenda financeira da Tesouraria.",
          err
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const applyFilters = useCallback(
    (next: TreasuryAgendaFilterState) => {
      setSearchParams(filtersToParams(next), { replace: true });
    },
    [setSearchParams]
  );

  const clearFilters = useCallback(() => {
    applyFilters(createEmptyTreasuryAgendaFilters(todayCivilDateLocal()));
  }, [applyFilters]);

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-agenda-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_AGENDA_PAGE_TITLE}
          subtitle={TREASURY_AGENDA_PAGE_SUBTITLE}
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

        <TreasuryAgendaPanel
          viewKind={viewKind}
          agenda={agenda}
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
