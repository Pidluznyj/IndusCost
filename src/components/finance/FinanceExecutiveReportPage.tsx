import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceExecutiveReport } from "@/src/lib/financeExecutiveReportTypes";
import { canViewFinanceExecutiveReport } from "@/src/lib/financeExecutiveReportPermissions";
import {
  buildFinanceExecutiveReportQuery,
  createDefaultFinanceExecutiveReportUiFilters,
  financeExecutiveReportFiltersEqual,
  getFinanceExecutiveReportApiPath,
  normalizeFinanceExecutiveReportUiFilters,
  type FinanceExecutiveReportUiFilters,
} from "@/src/lib/financeExecutiveReportViewModel";
import {
  EXECUTIVE_REPORT_PRINT_BLOCK_LOADING_MESSAGE,
  resolveExecutiveReportPrintAction,
  waitForExecutiveReportChartsReady,
} from "@/src/lib/financeExecutiveReportPrint";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { ExecutiveReportFilters } from "@/src/components/finance/executive-report/ExecutiveReportFilters";
import { ExecutiveReportDocument } from "@/src/components/finance/executive-report/ExecutiveReportDocument";
import { ExecutiveDataQualityAlert } from "@/src/components/finance/executive-report/ExecutiveDataQualityAlert";
import { FinanceDataAuditDrawer } from "@/src/components/finance/shared/FinanceDataAuditDrawer";
import { buildFinanceExecutiveReportAuditSections } from "@/src/lib/financeDataAudit";
import { FINANCE_MODULE_TAB_ENDPOINTS } from "@/src/lib/financeModuleUiStandards";
import {
  FinanceModuleErrorBanner,
  FinanceModulePageLoading,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";

const ROUTE_BODY_CLASS = "finance-executive-report-route";

function buildExecutiveReportFilterAuditItems(
  filters: FinanceExecutiveReportUiFilters
): Array<{ label: string; value: string }> {
  return [
    { label: "Ano", value: filters.year || "—" },
    { label: "Mês", value: filters.month || "Todos" },
    { label: "Data-base", value: filters.asOfDate || "—" },
    { label: "Empresa", value: filters.company },
    { label: "Tipo de cliente", value: filters.customerType },
    { label: "NF emitida", value: filters.nfeFilter },
    { label: "Top N", value: filters.topN },
  ];
}

export function FinanceExecutiveReportPage() {
  const auth = useAuth();
  const canView = canViewFinanceExecutiveReport(auth);

  const [draftFilters, setDraftFilters] = useState<FinanceExecutiveReportUiFilters>(() =>
    createDefaultFinanceExecutiveReportUiFilters()
  );
  const [appliedFilters, setAppliedFilters] = useState<FinanceExecutiveReportUiFilters>(() =>
    createDefaultFinanceExecutiveReportUiFilters()
  );
  const [report, setReport] = useState<FinanceExecutiveReport | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);
  const [printing, setPrinting] = useState(false);

  const appliedQuery = useMemo(
    () => buildFinanceExecutiveReportQuery(appliedFilters),
    [appliedFilters]
  );
  const hasPendingFilterChanges = !financeExecutiveReportFiltersEqual(draftFilters, appliedFilters);
  const filterStatus = resolveFinanceBiFilterStatus(appliedQuery.length > 0, hasPendingFilterChanges);

  useEffect(() => {
    document.body.classList.add(ROUTE_BODY_CLASS);
    document.title = "Relatório Presidencial — Financeiro";
    return () => {
      document.body.classList.remove(ROUTE_BODY_CLASS);
    };
  }, []);

  useEffect(() => {
    void fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then(setBranding)
      .catch(() => setBranding(DEFAULT_BRANDING));
  }, []);

  const loadReport = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      setError("Você não possui permissão para visualizar o Relatório Presidencial.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const url = getFinanceExecutiveReportApiPath(appliedQuery);
      const payload = await fetchJsonOk<FinanceExecutiveReport>(url);
      setReport(payload);
    } catch (err) {
      setReport(null);
      setError(
        buildFinanceTabLoadError("Não foi possível carregar o Relatório Presidencial.", err)
      );
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, canView]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const handleApply = () => {
    setAppliedFilters(normalizeFinanceExecutiveReportUiFilters(draftFilters));
  };

  const handleClear = () => {
    const defaults = createDefaultFinanceExecutiveReportUiFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
  };

  const handlePrint = async () => {
    const action = resolveExecutiveReportPrintAction({
      loading,
      report,
      confirmFn: (message) => window.confirm(message),
    });

    if (action === "blocked-loading") {
      window.alert(EXECUTIVE_REPORT_PRINT_BLOCK_LOADING_MESSAGE);
      return;
    }
    if (action === "blocked-cancelled") {
      return;
    }

    if (printing) return;
    setPrinting(true);
    try {
      await waitForExecutiveReportChartsReady();
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
      window.print();
    } finally {
      setPrinting(false);
    }
  };

  const auditSections = useMemo(
    () =>
      buildFinanceExecutiveReportAuditSections({
        endpoint: `${FINANCE_MODULE_TAB_ENDPOINTS["executive-report"]}${appliedQuery ? `?${appliedQuery}` : ""}`,
        generatedAt: report?.generatedAt,
        appliedFilterItems: buildExecutiveReportFilterAuditItems(appliedFilters),
        warnings: report?.dataQuality.warnings,
      }),
    [appliedFilters, appliedQuery, report?.dataQuality.warnings, report?.generatedAt]
  );

  if (!canView) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Você não possui permissão para visualizar o Relatório Presidencial.
      </div>
    );
  }

  return (
    <div className="finance-executive-report-page space-y-6" data-testid="executive-report-page">
      <ExecutiveReportFilters
        draft={draftFilters}
        onChange={setDraftFilters}
        onApply={handleApply}
        onClear={handleClear}
        onRefresh={() => void loadReport()}
        onPrint={() => void handlePrint()}
        onAudit={() => setAuditOpen(true)}
        auditWarningCount={report?.dataQuality.warnings.length ?? 0}
        applyDisabled={!hasPendingFilterChanges}
        loading={loading}
        filterStatus={filterStatus}
      />

      <FinanceDataAuditDrawer
        open={auditOpen}
        onClose={() => setAuditOpen(false)}
        sections={auditSections}
      />

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={() => void loadReport()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {loading && !report ? (
        <FinanceModulePageLoading label="Montando relatório presidencial…" />
      ) : null}

      {loading && report ? (
        <div
          className="executive-report-loading-banner executive-report-screen-only finance-executive-report-print-no-print"
          data-testid="executive-report-loading-banner"
          role="status"
        >
          Atualizando relatório…
        </div>
      ) : null}

      {report ? (
        <>
          <div className="executive-report-screen-only">
            <ExecutiveDataQualityAlert dataQuality={report.dataQuality} />
          </div>
          <ExecutiveReportDocument report={report} branding={branding} />
        </>
      ) : null}
    </div>
  );
}
