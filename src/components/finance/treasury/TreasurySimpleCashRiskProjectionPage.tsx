/**
 * Página — Próximos dias (projeção simples de risco de caixa).
 * Reusa GET /agenda (motor de projeção existente). Sem segundo motor.
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
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import { canViewTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaPermissions.js";
import {
  buildTreasurySimpleCashRiskDayDetail,
  buildTreasurySimpleCashRiskSummary,
  resolveTreasurySimpleCashRiskReserve,
} from "@/src/lib/treasury/domain/treasurySimpleCashRiskProjectionRules.js";
import {
  TREASURY_SIMPLE_CASH_RISK_PAGE_SUBTITLE,
  TREASURY_SIMPLE_CASH_RISK_TITLE,
  createEmptyTreasurySimpleCashRiskFilters,
  isTreasurySimpleCashRiskPeriod,
  isTreasurySimpleCashRiskScenario,
  resolveTreasurySimpleCashRiskCompanyCode,
  resolveTreasurySimpleCashRiskRange,
  resolveTreasurySimpleCashRiskStaleMessage,
  resolveTreasurySimpleCashRiskViewKind,
  type TreasurySimpleCashRiskFilterState,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryAgendaUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasurySimpleCashRiskProjectionPanel } from "./TreasurySimpleCashRiskProjectionPanel.js";

function readFilters(params: URLSearchParams): TreasurySimpleCashRiskFilterState {
  const base = createEmptyTreasurySimpleCashRiskFilters();
  const periodRaw = params.get("period") ?? base.period;
  const scenarioRaw = params.get("scenario") ?? base.scenario;
  return {
    period: isTreasurySimpleCashRiskPeriod(periodRaw) ? periodRaw : base.period,
    scenario: isTreasurySimpleCashRiskScenario(scenarioRaw)
      ? scenarioRaw
      : base.scenario,
    companyCode: params.get("companyCode") ?? "",
    selectedCivilDate:
      params.get("day")?.trim() || params.get("selectedCivilDate")?.trim() || "",
  };
}

function filtersToParams(
  filters: TreasurySimpleCashRiskFilterState
): URLSearchParams {
  const qs = new URLSearchParams();
  if (filters.period !== "7d") qs.set("period", filters.period);
  if (filters.scenario !== "PROBABLE") qs.set("scenario", filters.scenario);
  if (filters.companyCode.trim()) {
    qs.set("companyCode", filters.companyCode.trim());
  }
  if (filters.selectedCivilDate.trim()) {
    qs.set("day", filters.selectedCivilDate.trim());
  }
  return qs;
}

export function TreasurySimpleCashRiskProjectionPage() {
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

  const sortedDays = useMemo(() => {
    if (!agenda?.days?.length) return [];
    return [...agenda.days].sort((a, b) =>
      a.civilDate.localeCompare(b.civilDate)
    );
  }, [agenda]);

  const minimumReserve = useMemo(
    () => resolveTreasurySimpleCashRiskReserve(accounts),
    [accounts]
  );

  const summary = useMemo(() => {
    if (!sortedDays.length) return null;
    return buildTreasurySimpleCashRiskSummary({
      days: sortedDays,
      minimumReserve,
      scenario: filters.scenario,
    });
  }, [sortedDays, minimumReserve, filters.scenario]);

  const selectedCivilDate = useMemo(() => {
    if (
      filters.selectedCivilDate &&
      sortedDays.some((d) => d.civilDate === filters.selectedCivilDate)
    ) {
      return filters.selectedCivilDate;
    }
    return sortedDays[0]?.civilDate ?? "";
  }, [filters.selectedCivilDate, sortedDays]);

  const dayDetail = useMemo(() => {
    const day = sortedDays.find((d) => d.civilDate === selectedCivilDate);
    if (!day) return null;
    return buildTreasurySimpleCashRiskDayDetail({
      day,
      scenario: filters.scenario,
    });
  }, [sortedDays, selectedCivilDate, filters.scenario]);

  const hasData = sortedDays.length > 0;
  const viewKind = resolveTreasurySimpleCashRiskViewKind({
    canView,
    loading,
    error,
    hasData,
  });
  const staleMessage = resolveTreasurySimpleCashRiskStaleMessage(agenda);
  const pendingAlertCount = agenda?.alerts?.length ?? 0;

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

      const today = todayCivilDateLocal();
      const range = resolveTreasurySimpleCashRiskRange(filters.period, today);
      const companyCode = resolveTreasurySimpleCashRiskCompanyCode(
        filters,
        nextAccounts
      );

      const payload = await fetchTreasuryAgenda({
        companyCode,
        baseDate: range.baseDate,
        endDate: range.endDate,
        scenario: filters.scenario,
        accountIds: null,
        consolidated: true,
        includeDayDetail: true,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAgenda(payload);
      setHeaderUpdatedAt(payload.freshness?.asOf ?? new Date().toISOString());
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar a projeção dos próximos dias.",
          err
        )
      );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [canView, filters.period, filters.scenario, filters.companyCode]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const applyFilters = useCallback(
    (next: TreasurySimpleCashRiskFilterState) => {
      setSearchParams(filtersToParams(next), { replace: true });
    },
    [setSearchParams]
  );

  const onSelectDay = useCallback(
    (civilDate: string) => {
      applyFilters({ ...filters, selectedCivilDate: civilDate });
    },
    [applyFilters, filters]
  );

  return (
    <FinanceBiDashboardShell>
      <div
        data-testid="treasury-simple-cash-risk-page"
        className="contents"
      >
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_SIMPLE_CASH_RISK_TITLE}
          subtitle={TREASURY_SIMPLE_CASH_RISK_PAGE_SUBTITLE}
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

        <TreasurySimpleCashRiskProjectionPanel
          viewKind={viewKind}
          agenda={agenda}
          days={sortedDays}
          summary={summary}
          dayDetail={dayDetail}
          filters={{ ...filters, selectedCivilDate }}
          error={error}
          staleMessage={staleMessage}
          pendingAlertCount={pendingAlertCount}
          onFiltersChange={applyFilters}
          onSelectDay={onSelectDay}
          onRefresh={() => void load()}
          onDismissError={() => setError(null)}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
