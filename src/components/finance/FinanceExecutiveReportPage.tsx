import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
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
} from "@/src/lib/financeExecutiveReportPrint";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { ExecutiveReportFilters } from "@/src/components/finance/executive-report/ExecutiveReportFilters";
import { ExecutiveReportDocument } from "@/src/components/finance/executive-report/ExecutiveReportDocument";
import { ExecutiveDataQualityAlert } from "@/src/components/finance/executive-report/ExecutiveDataQualityAlert";

const ROUTE_BODY_CLASS = "finance-executive-report-route";

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

  const appliedQuery = useMemo(
    () => buildFinanceExecutiveReportQuery(appliedFilters),
    [appliedFilters]
  );
  const hasPendingFilterChanges = !financeExecutiveReportFiltersEqual(draftFilters, appliedFilters);

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
        err instanceof Error
          ? err.message
          : "Não foi possível carregar o Relatório Presidencial. Tente novamente."
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

  const handlePrint = () => {
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
    window.print();
  };

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
        onRefresh={() => void loadReport()}
        onPrint={handlePrint}
        applyDisabled={!hasPendingFilterChanges}
        loading={loading}
      />

      {error ? (
        <div
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          data-testid="executive-report-error"
        >
          {error}
        </div>
      ) : null}

      {loading && !report ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-[#64748b]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Montando relatório presidencial…
        </div>
      ) : null}

      {loading && report ? (
        <div
          className="executive-report-loading-banner executive-report-screen-only finance-executive-report-print-no-print"
          data-testid="executive-report-loading-banner"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
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
