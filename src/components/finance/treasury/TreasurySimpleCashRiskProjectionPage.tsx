/**
 * Página — Fluxo Gerencial (projeção preditiva).
 * Dados canônicos: GET /agenda + contas/saldos (sem persistência no browser).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type {
  TreasuryAgendaDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import { canViewTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaPermissions.js";
import { fetchTreasuryAccountLatestBalance } from "@/src/lib/treasury/treasuryBalancesApi.js";
import {
  TREASURY_SIMPLE_CASH_RISK_DENIED,
  createEmptyTreasurySimpleCashRiskFilters,
  isTreasurySimpleCashRiskPeriod,
  isTreasurySimpleCashRiskScenario,
  resolveTreasurySimpleCashRiskCompanyCode,
  resolveTreasurySimpleCashRiskRange,
  resolveTreasurySimpleCashRiskStaleMessage,
  type TreasurySimpleCashRiskFilterState,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import { todayCivilDateLocal } from "@/src/lib/treasury/treasuryAgendaUi.js";
import {
  buildPredictiveCashFlowKpis,
  extractPredictiveTransactionsFromAgendaDays,
  mapAgendaDaysToPredictiveTimeline,
  mapTreasuryAccountToPredictiveAccount,
  treasuryMoneyToNumber,
  type PredictiveCashFlowAccount,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { PredictiveCashFlowDashboard } from "./predictive-cash-flow/PredictiveCashFlowDashboard.js";

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

async function loadPredictiveAccounts(
  raw: TreasuryFinancialAccountDto[],
  signal: AbortSignal
): Promise<PredictiveCashFlowAccount[]> {
  const active = raw.filter((a) => a.isActive !== false);
  const balances = await Promise.all(
    active.map(async (account) => {
      try {
        const snap = await fetchTreasuryAccountLatestBalance(account.id, signal);
        return {
          account,
          balance: snap?.availableBalance ?? "0.00",
        };
      } catch {
        return { account, balance: "0.00" };
      }
    })
  );
  if (signal.aborted) return [];
  return balances.map(({ account, balance }) =>
    mapTreasuryAccountToPredictiveAccount(account, balance)
  );
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
  const [rawAccounts, setRawAccounts] = useState<TreasuryFinancialAccountDto[]>(
    []
  );
  const [accounts, setAccounts] = useState<PredictiveCashFlowAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sortedDays = useMemo(() => {
    if (!agenda?.days?.length) return [];
    return [...agenda.days].sort((a, b) =>
      a.civilDate.localeCompare(b.civilDate)
    );
  }, [agenda]);

  const timeline = useMemo(
    () => mapAgendaDaysToPredictiveTimeline(sortedDays),
    [sortedDays]
  );

  const transactions = useMemo(
    () => extractPredictiveTransactionsFromAgendaDays(sortedDays),
    [sortedDays]
  );

  const companyCode = useMemo(
    () => resolveTreasurySimpleCashRiskCompanyCode(filters, rawAccounts),
    [filters, rawAccounts]
  );

  const kpis = useMemo(
    () =>
      buildPredictiveCashFlowKpis({
        accounts,
        timeline,
        agendaOpeningBalance: sortedDays[0]
          ? treasuryMoneyToNumber(sortedDays[0].openingBalance)
          : null,
      }),
    [accounts, timeline, sortedDays]
  );

  const staleMessage = resolveTreasurySimpleCashRiskStaleMessage(agenda);

  const selectedCivilDate = useMemo(() => {
    if (
      filters.selectedCivilDate &&
      sortedDays.some((d) => d.civilDate === filters.selectedCivilDate)
    ) {
      return filters.selectedCivilDate;
    }
    return sortedDays[0]?.civilDate ?? todayCivilDateLocal();
  }, [filters.selectedCivilDate, sortedDays]);

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
      const nextRaw = acc?.rows ?? [];
      setRawAccounts(nextRaw);
      const mapped = await loadPredictiveAccounts(nextRaw, controller.signal);
      if (controller.signal.aborted) return;
      setAccounts(mapped);

      const today = todayCivilDateLocal();
      const range = resolveTreasurySimpleCashRiskRange(filters.period, today);
      const resolvedCompany = resolveTreasurySimpleCashRiskCompanyCode(
        filters,
        nextRaw
      );
      if (!resolvedCompany) {
        setAgenda(null);
        setError(
          "Configure o companyCode em ao menos uma conta ativa (ou filtre por empresa) para carregar a projeção."
        );
        return;
      }

      const payload = await fetchTreasuryAgenda({
        companyCode: resolvedCompany,
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
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar o Fluxo Gerencial.",
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

  if (!canView) {
    return (
      <FinanceBiDashboardShell>
        <PermissionDenied message={TREASURY_SIMPLE_CASH_RISK_DENIED} />
      </FinanceBiDashboardShell>
    );
  }

  return (
    <FinanceBiDashboardShell>
      <div
        data-testid="treasury-simple-cash-risk-page"
        className="contents"
      >
        <PredictiveCashFlowDashboard
          kpis={kpis}
          timeline={timeline}
          accounts={accounts}
          transactions={transactions}
          filters={{ ...filters, selectedCivilDate }}
          companyCode={companyCode}
          loading={loading}
          error={error}
          staleMessage={staleMessage}
          onFiltersChange={applyFilters}
          onRefresh={() => void load()}
          onDismissError={() => setError(null)}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
