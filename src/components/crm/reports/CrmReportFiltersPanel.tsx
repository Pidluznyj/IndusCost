import React from "react";
import { CalendarRange, Filter, MapPin, RotateCcw, Users } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { searchCrmReportsCustomerOptions } from "@/src/lib/commercial/crmReportsClient";
import { formatCrmReportsDate, formatCrmReportsInteger } from "@/src/lib/commercial/crmReportsFormat";
import {
  CRM_REPORT_BUILDER_CUSTOMER_STATUS_OPTIONS,
  CRM_REPORT_PERIOD_PRESETS,
  CRM_REPORT_PERIOD_PRESET_LABELS,
  createEmptyCrmReportBuilderState,
  crmReportsCustomerScopeFromUi,
  describeCrmCustomReportFilters,
  hasActiveCrmReportsFilters,
  type CrmReportBuilderState,
  type CrmReportPeriodPreset,
  type CrmReportsCustomerChip,
  type CrmReportsUiFilters,
  type CrmReportsUiState,
} from "@/src/lib/commercial/crmReportsUiState";
import {
  CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS,
  type CrmCustomReportCustomerStatus,
  type CrmReportsCustomerSelectionMode,
  type CrmReportsFilterOptionsResponse,
  type CrmReportsSelectionInfo,
} from "@/src/lib/commercial/crmReportsTypes";
import { CrmCustomerPicker } from "./CrmCustomerSelectionFilter";
import { CrmReportsScopeSelects } from "./CrmReportsGlobalFilters";

export const CRM_REPORT_CUSTOMER_MODE_LABELS: Record<CrmReportsCustomerSelectionMode, string> = {
  ALL: "Todos os clientes",
  ONLY: "Somente os escolhidos",
  EXCLUDE: "Todos, exceto os escolhidos",
};

const CUSTOMER_MODES: readonly CrmReportsCustomerSelectionMode[] = ["ALL", "ONLY", "EXCLUDE"];

const SELECT_CLASS =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const GROUP_TITLE = "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground";

export type CrmReportFiltersPanelProps = {
  ui: Pick<CrmReportsUiState, "filters" | "selection">;
  options: CrmReportsFilterOptionsResponse | null;
  optionsLoading: boolean;
  optionsError: string | null;
  /** Eco do backend (escolhidos fora dos demais filtros) — pode faltar durante o carregamento. */
  selectionInfo: CrmReportsSelectionInfo | null;
  builder: Pick<CrmReportBuilderState, "periodPreset" | "customFrom" | "customTo" | "customerStatus">;
  period: { ok: true; period: { from: string; to: string } | null } | { ok: false; error: string };
  onCustomerScopeChange: (scope: { mode: CrmReportsCustomerSelectionMode; customers: CrmReportsCustomerChip[] }) => void;
  onFiltersChange: (patch: Partial<CrmReportsUiFilters>) => void;
  onBuilderChange: (patch: Partial<CrmReportBuilderState>) => void;
  onClearAll: () => void;
  search?: typeof searchCrmReportsCustomerOptions;
};

/**
 * Filtros do relatório personalizado num lugar só: quais clientes entram
 * (Todos / Somente / Todos, exceto), carteira e local, período e situação —
 * com o resumo do recorte em português. Mesmo estado de Relatórios padrão.
 */
export function CrmReportFiltersPanel({
  ui,
  options,
  optionsLoading,
  optionsError,
  selectionInfo,
  builder,
  period,
  onCustomerScopeChange,
  onFiltersChange,
  onBuilderChange,
  onClearAll,
  search,
}: CrmReportFiltersPanelProps) {
  const scope = crmReportsCustomerScopeFromUi(ui);
  const ownScope = options != null && !options.commercialOwnerFilterEnabled;
  const count = scope.customers.length;
  const defaults = createEmptyCrmReportBuilderState();
  const anyActive =
    hasActiveCrmReportsFilters(ui) ||
    count > 0 ||
    builder.periodPreset !== defaults.periodPreset ||
    builder.customerStatus !== defaults.customerStatus;
  const summary = describeCrmCustomReportFilters({ ui, ownScope, period, customerStatus: builder.customerStatus });

  const customersHint =
    scope.mode === "ALL"
      ? `${ownScope ? "Entram todos os clientes da sua carteira." : "Entram todos os clientes permitidos no seu escopo."}${
          count > 0 ? ` ${formatCrmReportsInteger(count)} cliente(s) escolhido(s) ficam guardados para quando você trocar a opção.` : ""
        }`
      : scope.mode === "ONLY"
        ? count === 0
          ? "Busque e adicione os clientes que devem entrar. Sem nenhum escolhido, entram todos."
          : `Entram só estes ${formatCrmReportsInteger(count)} cliente(s).`
        : count === 0
          ? "Busque e adicione os clientes que devem ficar de fora."
          : `Entram todos, menos estes ${formatCrmReportsInteger(count)} cliente(s).`;
  const ignoredHint =
    scope.mode !== "ALL" && selectionInfo && selectionInfo.idsOutsideUniverse > 0
      ? ` ${formatCrmReportsInteger(selectionInfo.idsOutsideUniverse)} escolhido(s) fora dos demais filtros (ignorado).`
      : "";

  const changeCustomers = (customers: CrmReportsCustomerChip[]) => onCustomerScopeChange({ mode: scope.mode, customers });

  return (
    <section
      className="rounded-xl border border-border bg-card"
      aria-label="Filtros do relatório"
      data-testid="crm-report-filters"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-primary/10 p-1.5 text-primary">
            <Filter className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h4 className="text-sm font-bold text-foreground">Filtros do relatório</h4>
            <p className="text-xs text-muted-foreground">Os filtros se somam: um cliente só entra se atender a todos.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClearAll}
          disabled={!anyActive}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Limpar filtros
        </button>
      </div>

      <div className="space-y-5 px-4 py-4">
        <fieldset className="space-y-2">
          <legend className={GROUP_TITLE}>
            <Users className="h-3.5 w-3.5" aria-hidden />
            Clientes
          </legend>
          <div
            className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1"
            role="radiogroup"
            aria-label="Quais clientes entram"
          >
            {CUSTOMER_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={scope.mode === mode}
                data-customer-mode={mode}
                onClick={() => onCustomerScopeChange({ mode, customers: scope.customers })}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                  scope.mode === mode ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {CRM_REPORT_CUSTOMER_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
          {scope.mode !== "ALL" ? (
            <div className="max-w-2xl">
              <CrmCustomerPicker
                label={scope.mode === "EXCLUDE" ? "Clientes que ficam de fora" : "Clientes que entram"}
                placeholder="Buscar por nome, fantasia ou CNPJ"
                chips={scope.customers}
                chipTone={scope.mode === "EXCLUDE" ? "exclude" : "neutral"}
                search={search}
                onAdd={(chip) => changeCustomers([...scope.customers.filter((c) => c.id !== chip.id), chip])}
                onRemove={(id) => changeCustomers(scope.customers.filter((c) => c.id !== id))}
                onClear={() => changeCustomers([])}
              />
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground" data-testid="crm-report-filters-customers-hint">
            {customersHint}
            {ignoredHint}
          </p>
          {scope.alsoLimitedTo.length > 0 ? (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span>
                Também limitado pelo filtro “Cliente” de Relatórios padrão:{" "}
                {scope.alsoLimitedTo.map((c) => c.label).join(", ")}.
              </span>
              <button
                type="button"
                onClick={() => onFiltersChange({ customers: [] })}
                className="font-semibold underline underline-offset-2 hover:no-underline"
              >
                Remover esse limite
              </button>
            </p>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={GROUP_TITLE}>
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Carteira e local
          </legend>
          {optionsError ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {optionsError} Responsável, vendedor, cidade e UF ficam indisponíveis; o relatório continua funcionando.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <CrmReportsScopeSelects
              idPrefix="crm-report-filter"
              filters={ui.filters}
              options={options}
              optionsLoading={optionsLoading}
              onChange={onFiltersChange}
            />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className={GROUP_TITLE}>
            <CalendarRange className="h-3.5 w-3.5" aria-hidden />
            Período e situação
          </legend>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="crm-report-filter-period" className="block text-xs font-semibold text-foreground">
                Período (emissão do pedido)
              </label>
              <select
                id="crm-report-filter-period"
                className={SELECT_CLASS}
                value={builder.periodPreset}
                onChange={(e) => onBuilderChange({ templateId: null, periodPreset: e.target.value as CrmReportPeriodPreset })}
              >
                {CRM_REPORT_PERIOD_PRESETS.map((preset) => (
                  <option key={preset} value={preset}>
                    {CRM_REPORT_PERIOD_PRESET_LABELS[preset]}
                  </option>
                ))}
              </select>
              {builder.periodPreset === "CUSTOM" ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">De</span>
                    <input
                      type="date"
                      className={SELECT_CLASS}
                      value={builder.customFrom}
                      onChange={(e) => onBuilderChange({ customFrom: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[11px] text-muted-foreground">Até</span>
                    <input
                      type="date"
                      className={SELECT_CLASS}
                      value={builder.customTo}
                      onChange={(e) => onBuilderChange({ customTo: e.target.value })}
                    />
                  </label>
                </div>
              ) : period.ok && period.period ? (
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  {formatCrmReportsDate(period.period.from)} a {formatCrmReportsDate(period.period.to)}
                </p>
              ) : null}
            </div>
            <div className="space-y-1">
              <label htmlFor="crm-report-filter-status" className="block text-xs font-semibold text-foreground">
                Situação do cliente
              </label>
              <select
                id="crm-report-filter-status"
                className={SELECT_CLASS}
                value={builder.customerStatus}
                onChange={(e) =>
                  onBuilderChange({ templateId: null, customerStatus: e.target.value as CrmCustomReportCustomerStatus })
                }
              >
                {CRM_REPORT_BUILDER_CUSTOMER_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {CRM_CUSTOM_REPORT_CUSTOMER_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground">Situação de recompra vem do motor; compra = emissão do pedido.</p>
            </div>
          </div>
        </fieldset>

        <div
          className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs leading-relaxed text-foreground"
          aria-live="polite"
          data-testid="crm-report-filters-summary"
        >
          <span className="font-semibold">O relatório vai considerar: </span>
          {summary.join(" · ")}
        </div>
      </div>
    </section>
  );
}
