import React from "react";
import { ChevronDown, ChevronUp, Download, Loader2, SlidersHorizontal, X } from "lucide-react";
import { CustomerAutocompleteFilter } from "@/src/components/common/CustomerAutocompleteFilter";
import type { EntityAutocompleteSelection } from "@/src/lib/customerSearch";
import {
  BILLING_STATUS_FILTER_OPTIONS,
  COMPLETION_STATUS_FILTER_OPTIONS,
  CUT_FILTER_OPTIONS,
  DEADLINE_STATUS_FILTER_OPTIONS,
  FULFILLMENT_FILTER_OPTIONS,
  INVOICE_COVERAGE_FILTER_OPTIONS,
  INVOICE_FILTER_OPTIONS,
  OPERATIONAL_STATUS_FILTER_OPTIONS,
  PRAZO_FILTER_OPTIONS,
  PRODUCTION_ORDER_FILTER_OPTIONS,
  REVIEW_DATA_FILTER_OPTIONS,
} from "@/src/lib/salesOrderManagementUi";
import {
  advancedFiltersButtonLabel,
  type SalesOrderManagementAdvancedFilterChip,
} from "@/src/lib/salesOrderManagementFilterUx";
import { cn } from "@/src/lib/utils";

const fieldClass =
  "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none";
const labelClass = "text-[10px] font-bold uppercase text-muted-foreground";

export function SalesOrderManagementFiltersBar({
  year,
  month,
  yearOptions,
  searchDraft,
  advancedOpen,
  advancedActiveCount,
  activeChips,
  exportingInternal,
  loading,
  customerSelection,
  responsible,
  companyIssuer,
  operationalStatus,
  deadlineStatus,
  completionStatus,
  billingStatus,
  invoiceFilter,
  productionFilter,
  deliveryYear,
  deliveryMonth,
  nfeYear,
  nfeMonth,
  prazoFilter,
  fulfillmentFilter,
  invoiceCoverage,
  reviewDataFilter,
  cutFilter,
  invoiceNumber,
  onYearChange,
  onMonthChange,
  onSearchDraftChange,
  onToggleAdvanced,
  onExportInternal,
  onClearAll,
  onClearAdvancedChip,
  onCustomerChange,
  onCustomerClear,
  onResponsibleChange,
  onCompanyIssuerChange,
  onOperationalStatusChange,
  onDeadlineStatusChange,
  onCompletionStatusChange,
  onBillingStatusChange,
  onInvoiceFilterChange,
  onProductionFilterChange,
  onDeliveryYearChange,
  onDeliveryMonthChange,
  onNfeYearChange,
  onNfeMonthChange,
  onPrazoFilterChange,
  onFulfillmentFilterChange,
  onInvoiceCoverageChange,
  onReviewDataFilterChange,
  onCutFilterChange,
  onInvoiceNumberChange,
}: {
  year: string;
  month: string;
  yearOptions: number[];
  searchDraft: string;
  advancedOpen: boolean;
  advancedActiveCount: number;
  activeChips: SalesOrderManagementAdvancedFilterChip[];
  exportingInternal: boolean;
  loading: boolean;
  customerSelection: EntityAutocompleteSelection | null;
  responsible: string;
  companyIssuer: string;
  operationalStatus: string;
  deadlineStatus: string;
  completionStatus: string;
  billingStatus: string;
  invoiceFilter: string;
  productionFilter: string;
  deliveryYear: string;
  deliveryMonth: string;
  nfeYear: string;
  nfeMonth: string;
  prazoFilter: string;
  fulfillmentFilter: string;
  invoiceCoverage: string;
  reviewDataFilter: string;
  cutFilter: string;
  invoiceNumber: string;
  onYearChange: (value: string) => void;
  onMonthChange: (value: string) => void;
  onSearchDraftChange: (value: string) => void;
  onToggleAdvanced: () => void;
  onExportInternal: () => void;
  onClearAll: () => void;
  onClearAdvancedChip: (id: SalesOrderManagementAdvancedFilterChip["id"]) => void;
  onCustomerChange: (sel: EntityAutocompleteSelection | null) => void;
  onCustomerClear: () => void;
  onResponsibleChange: (value: string) => void;
  onCompanyIssuerChange: (value: string) => void;
  onOperationalStatusChange: (value: string) => void;
  onDeadlineStatusChange: (value: string) => void;
  onCompletionStatusChange: (value: string) => void;
  onBillingStatusChange: (value: string) => void;
  onInvoiceFilterChange: (value: string) => void;
  onProductionFilterChange: (value: string) => void;
  onDeliveryYearChange: (value: string) => void;
  onDeliveryMonthChange: (value: string) => void;
  onNfeYearChange: (value: string) => void;
  onNfeMonthChange: (value: string) => void;
  onPrazoFilterChange: (value: string) => void;
  onFulfillmentFilterChange: (value: string) => void;
  onInvoiceCoverageChange: (value: string) => void;
  onReviewDataFilterChange: (value: string) => void;
  onCutFilterChange: (value: string) => void;
  onInvoiceNumberChange: (value: string) => void;
}) {
  const advancedButtonLabel = advancedFiltersButtonLabel(advancedActiveCount);

  return (
    <section
      className="rounded-xl border border-border bg-card shadow-sm"
      data-testid="sales-order-management-filters"
    >
      <div className="p-3 space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(7rem,8rem)_minmax(7rem,8rem)_1fr] gap-2 flex-1 min-w-0">
            <div>
              <label className={labelClass}>Ano</label>
              <select
                className={fieldClass}
                value={year}
                onChange={(e) => onYearChange(e.target.value)}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
                <option value="all">Todos os anos</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Mês</label>
              <select
                className={fieldClass}
                value={month}
                onChange={(e) => onMonthChange(e.target.value)}
              >
                <option value="">Todos</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={String(m)}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0">
              <label className={labelClass}>Busca inteligente</label>
              <input
                type="search"
                className={fieldClass}
                placeholder="Buscar por pedido, NF, cliente, vendedor ou documento..."
                value={searchDraft}
                onChange={(e) => onSearchDraftChange(e.target.value)}
                aria-label="Busca inteligente de pedidos"
                data-testid="sales-order-management-smart-search"
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="sales-order-management-advanced-filters-toggle"
              aria-expanded={advancedOpen}
              onClick={onToggleAdvanced}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                advancedActiveCount > 0
                  ? "border-primary/40 bg-primary/5 text-primary hover:bg-primary/10"
                  : "border-border bg-card hover:bg-accent"
              )}
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              {advancedButtonLabel}
              {advancedOpen ? (
                <ChevronUp className="h-4 w-4 shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 shrink-0" />
              )}
            </button>
            <button
              type="button"
              data-testid="sales-order-management-export-internal-margin"
              disabled={exportingInternal || loading}
              onClick={onExportInternal}
              className="rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-medium hover:bg-primary/10 disabled:opacity-50"
            >
              {exportingInternal ? (
                <>
                  <Loader2 className="inline h-4 w-4 animate-spin mr-1" />
                  Exportando…
                </>
              ) : (
                <>
                  <Download className="inline h-4 w-4 mr-1" />
                  Excel interno (margem)
                </>
              )}
            </button>
            <button
              type="button"
              data-testid="sales-order-management-clear-filters"
              onClick={onClearAll}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              Limpar filtros
            </button>
          </div>
        </div>

        {activeChips.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            data-testid="sales-order-management-active-filter-chips"
          >
            {activeChips.map((chip) => (
              <span
                key={`${chip.id}-${chip.value}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs text-foreground"
              >
                <span className="font-medium text-muted-foreground">{chip.label}:</span>
                <span>{chip.value}</span>
                <button
                  type="button"
                  aria-label={`Remover filtro ${chip.label}`}
                  className="rounded-full p-0.5 hover:bg-muted"
                  onClick={() => onClearAdvancedChip(chip.id)}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {advancedOpen ? (
        <div
          className="border-t border-border bg-muted/20 px-3 py-3 space-y-3"
          data-testid="sales-order-management-advanced-filters-panel"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Filtros avançados
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            <div>
              <CustomerAutocompleteFilter
                label="Cliente"
                value={customerSelection}
                placeholder="Todos os clientes"
                onChange={onCustomerChange}
                onClear={onCustomerClear}
              />
            </div>
            <div>
              <label className={labelClass}>Vendedor</label>
              <input
                type="text"
                className={fieldClass}
                value={responsible}
                onChange={(e) => onResponsibleChange(e.target.value)}
                placeholder="Nome do vendedor"
                data-testid="sales-order-management-seller-filter"
              />
            </div>
            <div>
              <label className={labelClass}>Empresa</label>
              <input
                type="text"
                className={fieldClass}
                value={companyIssuer}
                onChange={(e) => onCompanyIssuerChange(e.target.value)}
              />
            </div>
            <div>
              <label className={labelClass}>Status gerencial</label>
              <select
                className={fieldClass}
                value={operationalStatus}
                onChange={(e) => onOperationalStatusChange(e.target.value)}
              >
                {OPERATIONAL_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Prazo</label>
              <select
                className={fieldClass}
                value={deadlineStatus}
                onChange={(e) => onDeadlineStatusChange(e.target.value)}
              >
                {DEADLINE_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Completeza</label>
              <select
                className={fieldClass}
                value={completionStatus}
                onChange={(e) => onCompletionStatusChange(e.target.value)}
              >
                {COMPLETION_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>NF</label>
              <select
                className={fieldClass}
                value={billingStatus}
                onChange={(e) => onBillingStatusChange(e.target.value)}
              >
                {BILLING_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Vínculo NF</label>
              <select
                className={fieldClass}
                value={invoiceFilter}
                onChange={(e) => onInvoiceFilterChange(e.target.value)}
              >
                {INVOICE_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>OP</label>
              <select
                className={fieldClass}
                value={productionFilter}
                onChange={(e) => onProductionFilterChange(e.target.value)}
              >
                {PRODUCTION_ORDER_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Entrega — ano</label>
              <select
                className={fieldClass}
                value={deliveryYear}
                onChange={(e) => onDeliveryYearChange(e.target.value)}
              >
                <option value="">Todos</option>
                {yearOptions.map((y) => (
                  <option key={`d-${y}`} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Entrega — mês</label>
              <select
                className={fieldClass}
                value={deliveryMonth}
                onChange={(e) => onDeliveryMonthChange(e.target.value)}
              >
                <option value="">Todos</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={`dm-${m}`} value={String(m)}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>NF — ano</label>
              <select
                className={fieldClass}
                value={nfeYear}
                onChange={(e) => onNfeYearChange(e.target.value)}
              >
                <option value="">Todos</option>
                {yearOptions.map((y) => (
                  <option key={`n-${y}`} value={String(y)}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>NF — mês</label>
              <select
                className={fieldClass}
                value={nfeMonth}
                onChange={(e) => onNfeMonthChange(e.target.value)}
              >
                <option value="">Todos</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={`nm-${m}`} value={String(m)}>
                    {String(m).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Prazo (BI)</label>
              <select
                className={fieldClass}
                value={prazoFilter}
                onChange={(e) => onPrazoFilterChange(e.target.value)}
              >
                {PRAZO_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Atendimento</label>
              <select
                className={fieldClass}
                value={fulfillmentFilter}
                onChange={(e) => onFulfillmentFilterChange(e.target.value)}
              >
                {FULFILLMENT_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>% faturado</label>
              <select
                className={fieldClass}
                value={invoiceCoverage}
                onChange={(e) => onInvoiceCoverageChange(e.target.value)}
              >
                {INVOICE_COVERAGE_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Corte</label>
              <select
                className={fieldClass}
                value={cutFilter}
                onChange={(e) => onCutFilterChange(e.target.value)}
              >
                {CUT_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Revisar dados</label>
              <select
                className={fieldClass}
                value={reviewDataFilter}
                onChange={(e) => onReviewDataFilterChange(e.target.value)}
              >
                {REVIEW_DATA_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || "all"} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Número NF</label>
              <input
                type="text"
                className={fieldClass}
                value={invoiceNumber}
                onChange={(e) => onInvoiceNumberChange(e.target.value)}
                placeholder="Ex.: 12345"
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
