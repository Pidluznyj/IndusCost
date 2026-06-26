import React, { useMemo } from "react";
import { Loader2, Printer, RefreshCw, RotateCcw } from "lucide-react";
import {
  buildExecutiveReportMonthOptions,
  buildExecutiveReportYearOptions,
  FINANCE_EXECUTIVE_REPORT_COMPANY_OPTIONS,
  FINANCE_EXECUTIVE_REPORT_CUSTOMER_TYPE_OPTIONS,
  FINANCE_EXECUTIVE_REPORT_NFE_OPTIONS,
  FINANCE_EXECUTIVE_REPORT_TOP_N_OPTIONS,
  type FinanceExecutiveReportUiFilters,
} from "@/src/lib/financeExecutiveReportViewModel";
import {
  buildFinanceModuleEyebrow,
  FINANCE_FILTER_PANEL_TITLE,
  FINANCE_HEADER_ACTION_EXPORT_PDF,
  FINANCE_HEADER_ACTION_REFRESH,
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { FINANCE_EXECUTIVE_REPORT_SUBTITLE } from "@/src/lib/financeDataAuditCopy";
import {
  financeBiButtonOutlineClass,
  financeBiButtonPrimaryClass,
  financeBiSectionClass,
  financeBiSubtitleClass,
  financeBiTitleClass,
} from "@/src/lib/financeBiDashboardTheme";
import { Filter } from "lucide-react";
import { FinanceBiFilterStatusBadge } from "@/src/components/finance/bi/FinanceBiFilterStatusBadge";
import { FinanceDataAuditButton } from "@/src/components/finance/shared/FinanceDataAuditButton";
import type { FinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";

export function ExecutiveReportFilters({
  draft,
  onChange,
  onApply,
  onClear,
  onRefresh,
  onPrint,
  onAudit,
  auditWarningCount,
  applyDisabled,
  loading,
  filterStatus,
}: {
  draft: FinanceExecutiveReportUiFilters;
  onChange: (next: FinanceExecutiveReportUiFilters) => void;
  onApply: () => void;
  onClear: () => void;
  onRefresh: () => void;
  onPrint: () => void;
  onAudit: () => void;
  auditWarningCount?: number;
  applyDisabled: boolean;
  loading: boolean;
  filterStatus: FinanceBiFilterStatus;
}) {
  const yearOptions = useMemo(
    () => buildExecutiveReportYearOptions(Number(draft.year) || new Date().getFullYear()),
    [draft.year]
  );
  const monthOptions = buildExecutiveReportMonthOptions();
  const fieldClass = financeModuleFilterFieldClass();
  const labelClass = financeModuleFilterLabelClass();

  return (
    <div className="no-print finance-executive-report-print-no-print space-y-4" data-testid="executive-report-filters">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            {buildFinanceModuleEyebrow("executive-report")}
          </p>
          <h1 className={financeBiTitleClass}>Relatório Presidencial</h1>
          <p className={financeBiSubtitleClass}>{FINANCE_EXECUTIVE_REPORT_SUBTITLE}</p>
        </div>
        <div className="print-actions flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className={financeBiButtonOutlineClass}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {FINANCE_HEADER_ACTION_REFRESH}
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={loading}
            data-testid="executive-report-print-button"
            className="no-print inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            {FINANCE_HEADER_ACTION_EXPORT_PDF}
          </button>
          <FinanceDataAuditButton
            onClick={onAudit}
            warningCount={auditWarningCount}
            disabled={loading}
          />
        </div>
      </header>

      <section className={financeBiSectionClass}>
        <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-[#6B7280]" />
          <span className="text-sm font-semibold text-[#111827]">{FINANCE_FILTER_PANEL_TITLE}</span>
          <FinanceBiFilterStatusBadge status={filterStatus} />
        </div>

        <div className="p-5 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <label className="space-y-1">
            <span className={labelClass}>Ano</span>
            <select
              className={fieldClass}
              value={draft.year}
              onChange={(e) => onChange({ ...draft, year: e.target.value })}
            >
              {yearOptions.map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelClass}>Mês</span>
            <select
              className={fieldClass}
              value={draft.month}
              onChange={(e) => onChange({ ...draft, month: e.target.value })}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelClass}>Data-base</span>
            <input
              type="date"
              className={fieldClass}
              value={draft.asOfDate}
              onChange={(e) => onChange({ ...draft, asOfDate: e.target.value })}
            />
          </label>

          <label className="space-y-1">
            <span className={labelClass}>Empresa</span>
            <select
              className={fieldClass}
              value={draft.company}
              onChange={(e) =>
                onChange({
                  ...draft,
                  company: e.target.value as FinanceExecutiveReportUiFilters["company"],
                })
              }
            >
              {FINANCE_EXECUTIVE_REPORT_COMPANY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelClass}>Tipo de cliente</span>
            <select
              className={fieldClass}
              value={draft.customerType}
              onChange={(e) =>
                onChange({
                  ...draft,
                  customerType: e.target.value as FinanceExecutiveReportUiFilters["customerType"],
                })
              }
            >
              {FINANCE_EXECUTIVE_REPORT_CUSTOMER_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelClass}>NF emitida?</span>
            <select
              className={fieldClass}
              value={draft.nfeFilter}
              onChange={(e) =>
                onChange({
                  ...draft,
                  nfeFilter: e.target.value as FinanceExecutiveReportUiFilters["nfeFilter"],
                })
              }
            >
              {FINANCE_EXECUTIVE_REPORT_NFE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className={labelClass}>Top N</span>
            <select
              className={fieldClass}
              value={draft.topN}
              onChange={(e) =>
                onChange({
                  ...draft,
                  topN: e.target.value as FinanceExecutiveReportUiFilters["topN"],
                })
              }
            >
              {FINANCE_EXECUTIVE_REPORT_TOP_N_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="border-t border-[#E5E7EB] px-5 py-4 flex items-center gap-2 bg-white">
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled || loading}
            className={financeBiButtonPrimaryClass}
          >
            <Filter className="h-3.5 w-3.5" />
            Aplicar filtros
          </button>
          <button type="button" onClick={onClear} className={financeBiButtonOutlineClass}>
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar
          </button>
        </div>
      </section>
    </div>
  );
}
