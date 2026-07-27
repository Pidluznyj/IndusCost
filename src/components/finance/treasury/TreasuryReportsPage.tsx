/**
 * Tela — Central de Relatórios da Tesouraria.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_HEADER_ACTION_REFRESH } from "@/src/lib/financeModuleUiStandards";
import type { TreasuryReportDto } from "@/src/lib/treasury/contracts/index.js";
import {
  buildTreasuryReportExportUrl,
  fetchTreasuryReport,
} from "@/src/lib/treasury/treasuryReportsApi.js";
import {
  canExportTreasuryReports,
  canViewTreasuryReports,
} from "@/src/lib/treasury/treasuryReportsPermissions.js";
import {
  TREASURY_REPORTS_PAGE_SUBTITLE,
  TREASURY_REPORTS_PAGE_TITLE,
  createEmptyTreasuryReportsFilters,
  isTreasuryReportsReportKey,
  isTreasuryReportsScenario,
  resolveTreasuryReportsViewKind,
  type TreasuryReportsFilterState,
} from "@/src/lib/treasury/treasuryReportsUi.js";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { TreasuryReportsPanel } from "./TreasuryReportsPanel.js";

function readFilters(params: URLSearchParams): TreasuryReportsFilterState {
  const base = createEmptyTreasuryReportsFilters();
  const reportRaw = params.get("reportKey") ?? params.get("report") ?? base.reportKey;
  const scenarioRaw = params.get("scenario") ?? base.scenario;
  return {
    reportKey: isTreasuryReportsReportKey(reportRaw) ? reportRaw : base.reportKey,
    from: params.get("from")?.trim() || base.from,
    to: params.get("to")?.trim() || base.to,
    accountIds: params.get("accountIds") ?? "",
    scenario: isTreasuryReportsScenario(scenarioRaw)
      ? scenarioRaw
      : base.scenario,
    status: params.get("status") ?? "",
    severity: params.get("severity") ?? "",
    search: params.get("search") ?? "",
    companyCode: params.get("companyCode") ?? "",
  };
}

function filtersToParams(filters: TreasuryReportsFilterState): URLSearchParams {
  const qs = new URLSearchParams();
  qs.set("reportKey", filters.reportKey);
  if (filters.from) qs.set("from", filters.from);
  if (filters.to) qs.set("to", filters.to);
  if (filters.accountIds.trim()) qs.set("accountIds", filters.accountIds.trim());
  if (filters.scenario !== "PROBABLE") qs.set("scenario", filters.scenario);
  if (filters.status.trim()) qs.set("status", filters.status.trim());
  if (filters.severity.trim()) qs.set("severity", filters.severity.trim());
  if (filters.search.trim()) qs.set("search", filters.search.trim());
  if (filters.companyCode.trim()) qs.set("companyCode", filters.companyCode.trim());
  return qs;
}

function toFetchParams(filters: TreasuryReportsFilterState) {
  const accountIds = filters.accountIds
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    reportKey: filters.reportKey,
    from: filters.from,
    to: filters.to,
    accountIds: accountIds.length ? accountIds : null,
    scenario: filters.scenario,
    status: filters.status.trim() || null,
    severity: filters.severity.trim() || null,
    search: filters.search.trim() || null,
    companyCode: filters.companyCode.trim() || null,
  };
}

export function TreasuryReportsPage() {
  const auth = useAuth();
  const permissions = usePermissions();
  const permCheck = {
    ...auth,
    canPerformAction: permissions.canPerformAction,
  };
  const canView = canViewTreasuryReports(permCheck);
  const canExport = canExportTreasuryReports(permCheck);

  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const abortRef = useRef<AbortController | null>(null);
  const [report, setReport] = useState<TreasuryReportDto | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const viewKind = resolveTreasuryReportsViewKind({
    canView,
    loading,
    error,
    hasData: Boolean(report),
  });

  const load = useCallback(async () => {
    if (!canView) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryReport({
        ...toFetchParams(filters),
        signal: ac.signal,
      });
      if (ac.signal.aborted) return;
      setReport(payload);
      setGeneratedAt(new Date().toISOString());
    } catch (err) {
      if (ac.signal.aborted) return;
      setReport(null);
      setGeneratedAt(null);
      setError(
        buildFinanceTabLoadError("Falha ao carregar relatório da Tesouraria.", err)
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [canView, filters]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const onFiltersChange = (next: TreasuryReportsFilterState) => {
    setSearchParams(filtersToParams(next), { replace: true });
  };

  const onExport = (format: "csv" | "xlsx" | "pdf") => {
    if (!canExport) return;
    const url = buildTreasuryReportExportUrl({
      ...toFetchParams(filters),
      format,
    });
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const onPrint = () => {
    window.print();
  };

  return (
    <FinanceBiDashboardShell>
      <div data-testid="treasury-reports-page" className="contents">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title={TREASURY_REPORTS_PAGE_TITLE}
          subtitle={TREASURY_REPORTS_PAGE_SUBTITLE}
          updatedAt={generatedAt}
          actions={[
            {
              id: "refresh",
              label: FINANCE_HEADER_ACTION_REFRESH,
              onClick: () => void load(),
            },
          ]}
        />
        <TreasuryReportsPanel
          viewKind={viewKind}
          report={report}
          generatedAt={generatedAt}
          error={error}
          filters={filters}
          canExport={canExport}
          onFiltersChange={onFiltersChange}
          onRefresh={() => void load()}
          onExport={onExport}
          onPrint={onPrint}
          onDismissError={() => setError(null)}
        />
      </div>
    </FinanceBiDashboardShell>
  );
}
