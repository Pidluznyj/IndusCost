/**
 * Painel — Central de Relatórios da Tesouraria.
 */

import React from "react";
import { Download, Printer, RefreshCw } from "lucide-react";
import type { TreasuryReportDto } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_PROJECTION_LAYERS } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_REPORT_OPTION_LIST,
  TREASURY_REPORTS_DENIED_MESSAGE,
  TREASURY_REPORTS_EMPTY_DESCRIPTION,
  TREASURY_REPORTS_EMPTY_TITLE,
  TREASURY_REPORTS_EXPORT_DENIED_MESSAGE,
  describeTreasuryReportsFilters,
  formatTreasuryReportGeneratedAt,
  type TreasuryReportsFilterState,
  type TreasuryReportsViewKind,
} from "@/src/lib/treasury/treasuryReportsUi.js";
import { formatTreasuryMoneyDisplay } from "@/src/lib/treasury/treasuryAccountsUi.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  FINANCE_HEADER_ACTION_EXPORT_CSV,
  FINANCE_HEADER_ACTION_EXPORT_PDF,
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
export type TreasuryReportsPanelProps = {
  viewKind: TreasuryReportsViewKind;
  report: TreasuryReportDto | null;
  generatedAt: string | null;
  error: string | null;
  filters: TreasuryReportsFilterState;
  canExport: boolean;
  onFiltersChange: (next: TreasuryReportsFilterState) => void;
  onRefresh: () => void;
  onExport: (format: "csv" | "xlsx" | "pdf") => void;
  onPrint: () => void;
  onDismissError?: () => void;
};

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className={financeModuleFilterLabelClass()}>{label}</span>
      {children}
    </label>
  );
}

export function TreasuryReportsPanel({
  viewKind,
  report,
  generatedAt,
  error,
  filters,
  canExport,
  onFiltersChange,
  onRefresh,
  onExport,
  onPrint,
  onDismissError,
}: TreasuryReportsPanelProps) {
  if (viewKind === "denied") {
    return <PermissionDenied message={TREASURY_REPORTS_DENIED_MESSAGE} />;
  }

  const filterChips = describeTreasuryReportsFilters(filters);
  const showScenario = ![
    "daily-position",
    "position-by-account",
    "delinquency",
  ].includes(filters.reportKey);
  const showStatus = ["promises", "exceptions", "reconciliations"].includes(
    filters.reportKey
  );
  const showSeverity = filters.reportKey === "exceptions";

  return (
    <div className="space-y-4" data-testid="treasury-reports-panel">
      <div className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4 print:hidden">
        <FilterField label="Relatório">
          <select
            className={financeModuleFilterFieldClass()}
            value={filters.reportKey}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                reportKey: e.target.value as TreasuryReportsFilterState["reportKey"],
              })
            }
            data-testid="treasury-reports-report-key"
          >
            {TREASURY_REPORT_OPTION_LIST.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Período de">
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={filters.from}
            onChange={(e) =>
              onFiltersChange({ ...filters, from: e.target.value })
            }
            data-testid="treasury-reports-from"
          />
        </FilterField>
        <FilterField label="Período até">
          <input
            type="date"
            className={financeModuleFilterFieldClass()}
            value={filters.to}
            onChange={(e) =>
              onFiltersChange({ ...filters, to: e.target.value })
            }
            data-testid="treasury-reports-to"
          />
        </FilterField>
        {showScenario ? (
          <FilterField label="Cenário">
            <select
              className={financeModuleFilterFieldClass()}
              value={filters.scenario}
              onChange={(e) =>
                onFiltersChange({
                  ...filters,
                  scenario: e.target
                    .value as TreasuryReportsFilterState["scenario"],
                })
              }
              data-testid="treasury-reports-scenario"
            >
              {TREASURY_PROJECTION_LAYERS.map((layer) => (
                <option key={layer} value={layer}>
                  {layer}
                </option>
              ))}
            </select>
          </FilterField>
        ) : null}
        <FilterField label="Contas (ids, vírgula)">
          <input
            className={financeModuleFilterFieldClass()}
            value={filters.accountIds}
            onChange={(e) =>
              onFiltersChange({ ...filters, accountIds: e.target.value })
            }
            placeholder="opcional"
            data-testid="treasury-reports-account-ids"
          />
        </FilterField>
        {showStatus ? (
          <FilterField label="Status">
            <input
              className={financeModuleFilterFieldClass()}
              value={filters.status}
              onChange={(e) =>
                onFiltersChange({ ...filters, status: e.target.value })
              }
              data-testid="treasury-reports-status"
            />
          </FilterField>
        ) : null}
        {showSeverity ? (
          <FilterField label="Severidade">
            <input
              className={financeModuleFilterFieldClass()}
              value={filters.severity}
              onChange={(e) =>
                onFiltersChange({ ...filters, severity: e.target.value })
              }
              data-testid="treasury-reports-severity"
            />
          </FilterField>
        ) : null}
        <FilterField label="Busca">
          <input
            className={financeModuleFilterFieldClass()}
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            data-testid="treasury-reports-search"
          />
        </FilterField>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent"
          onClick={onRefresh}
          data-testid="treasury-reports-refresh"
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent"
          onClick={onPrint}
          data-testid="treasury-reports-print"
        >
          <Printer className="h-4 w-4" />
          Imprimir
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
          onClick={() => onExport("csv")}
          disabled={!canExport}
          title={canExport ? FINANCE_HEADER_ACTION_EXPORT_CSV : TREASURY_REPORTS_EXPORT_DENIED_MESSAGE}
          data-testid="treasury-reports-export-csv"
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
          onClick={() => onExport("xlsx")}
          disabled={!canExport}
          title={canExport ? "Exportar Excel" : TREASURY_REPORTS_EXPORT_DENIED_MESSAGE}
          data-testid="treasury-reports-export-xlsx"
        >
          <Download className="h-4 w-4" />
          Excel
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-accent disabled:opacity-50"
          onClick={() => onExport("pdf")}
          disabled={!canExport}
          title={canExport ? FINANCE_HEADER_ACTION_EXPORT_PDF : TREASURY_REPORTS_EXPORT_DENIED_MESSAGE}
          data-testid="treasury-reports-export-pdf"
        >
          <Download className="h-4 w-4" />
          PDF
        </button>
        {!canExport ? (
          <span className="text-xs text-muted-foreground">
            {TREASURY_REPORTS_EXPORT_DENIED_MESSAGE}
          </span>
        ) : null}
      </div>

      {error ? (
        <FinanceModuleErrorBanner message={error} onDismiss={onDismissError} />
      ) : null}

      {viewKind === "loading" ? <FinanceModuleLoadingBlock /> : null}

      {viewKind === "empty" ? (
        <FinanceModuleEmptyState
          title={TREASURY_REPORTS_EMPTY_TITLE}
          description={TREASURY_REPORTS_EMPTY_DESCRIPTION}
        />
      ) : null}

      {viewKind === "ready" && report ? (
        <div
          className="space-y-4 rounded-xl border border-border bg-card p-4"
          data-testid="treasury-reports-print-area"
        >
          <div className="space-y-1 border-b border-border pb-3">
            <h2 className="text-lg font-semibold">
              {
                TREASURY_REPORT_OPTION_LIST.find(
                  (o) => o.key === report.reportKey
                )?.label
              }
            </h2>
            {generatedAt ? (
              <p
                className="text-sm text-muted-foreground"
                data-testid="treasury-reports-generated-at"
              >
                Gerado em: {formatTreasuryReportGeneratedAt(generatedAt)}
              </p>
            ) : null}
            <div
              className="mt-2 flex flex-wrap gap-2"
              data-testid="treasury-reports-filter-chips"
            >
              {filterChips.map((chip) => (
                <span
                  key={`${chip.label}:${chip.value}`}
                  className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground"
                >
                  {chip.label}: {chip.value}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Total valor
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {formatTreasuryMoneyDisplay(report.totals.amount)}
              </p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Total quantidade
              </p>
              <p className="text-xl font-semibold tabular-nums">
                {report.totals.count}
              </p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Composição</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm" data-testid="treasury-reports-composition">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="px-2 py-2 font-semibold">Item</th>
                    <th className="px-2 py-2 font-semibold">Valor</th>
                    <th className="px-2 py-2 font-semibold">Qtd</th>
                    <th className="px-2 py-2 font-semibold">%</th>
                  </tr>
                </thead>
                <tbody>
                  {report.composition.map((item) => (
                    <tr key={item.key} className="border-b border-border/60">
                      <td className="px-2 py-2">{item.label}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {formatTreasuryMoneyDisplay(item.amount)}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{item.count}</td>
                      <td className="px-2 py-2 tabular-nums">
                        {item.sharePercent ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {report.rows.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Detalhe</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm" data-testid="treasury-reports-rows">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-2 py-2 font-semibold">Rótulo</th>
                      <th className="px-2 py-2 font-semibold">Valor</th>
                      <th className="px-2 py-2 font-semibold">Data</th>
                      <th className="px-2 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.id} className="border-b border-border/60">
                        <td className="px-2 py-2">{row.label}</td>
                        <td className="px-2 py-2 tabular-nums">
                          {formatTreasuryMoneyDisplay(row.amount)}
                        </td>
                        <td className="px-2 py-2">{row.civilDate ?? "—"}</td>
                        <td className="px-2 py-2">{row.status ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
