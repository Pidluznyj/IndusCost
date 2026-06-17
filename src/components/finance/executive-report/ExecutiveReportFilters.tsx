import React from "react";
import { Loader2, Printer, RefreshCw } from "lucide-react";
import {
  buildExecutiveReportMonthOptions,
  buildExecutiveReportYearOptions,
  FINANCE_EXECUTIVE_REPORT_COMPANY_OPTIONS,
  FINANCE_EXECUTIVE_REPORT_CUSTOMER_TYPE_OPTIONS,
  FINANCE_EXECUTIVE_REPORT_NFE_OPTIONS,
  FINANCE_EXECUTIVE_REPORT_TOP_N_OPTIONS,
  type FinanceExecutiveReportUiFilters,
} from "@/src/lib/financeExecutiveReportViewModel";

function fieldClass() {
  return "w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm text-[#111827] focus:outline-none focus:ring-2 focus:ring-primary/30";
}

function labelClass() {
  return "text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]";
}

export function ExecutiveReportFilters({
  draft,
  onChange,
  onApply,
  onRefresh,
  onPrint,
  applyDisabled,
  loading,
}: {
  draft: FinanceExecutiveReportUiFilters;
  onChange: (next: FinanceExecutiveReportUiFilters) => void;
  onApply: () => void;
  onRefresh: () => void;
  onPrint: () => void;
  applyDisabled: boolean;
  loading: boolean;
}) {
  const yearOptions = buildExecutiveReportYearOptions(Number(draft.year) || new Date().getFullYear());
  const monthOptions = buildExecutiveReportMonthOptions();

  return (
    <div
      className="no-print executive-report-filters finance-executive-report-print-no-print rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm space-y-4"
      data-testid="executive-report-filters"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
            Relatório Presidencial
          </p>
          <h1 className="text-xl font-bold text-[#111827]">Visão executiva consolidada</h1>
        </div>
        <div className="print-actions flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="no-print inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-sm font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Atualizar
          </button>
          <button
            type="button"
            onClick={onPrint}
            disabled={loading}
            data-testid="executive-report-print-button"
            className="no-print inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-3 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <label className="space-y-1">
          <span className={labelClass()}>Ano</span>
          <select
            className={fieldClass()}
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
          <span className={labelClass()}>Mês</span>
          <select
            className={fieldClass()}
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
          <span className={labelClass()}>Data-base</span>
          <input
            type="date"
            className={fieldClass()}
            value={draft.asOfDate}
            onChange={(e) => onChange({ ...draft, asOfDate: e.target.value })}
          />
        </label>

        <label className="space-y-1">
          <span className={labelClass()}>Empresa</span>
          <select
            className={fieldClass()}
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
          <span className={labelClass()}>Tipo de cliente</span>
          <select
            className={fieldClass()}
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
          <span className={labelClass()}>NF emitida?</span>
          <select
            className={fieldClass()}
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
          <span className={labelClass()}>Top N</span>
          <select
            className={fieldClass()}
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

        <div className="flex items-end">
          <button
            type="button"
            onClick={onApply}
            disabled={applyDisabled || loading}
            className="no-print w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </div>
  );
}
