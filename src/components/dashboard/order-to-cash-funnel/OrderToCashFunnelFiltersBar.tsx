import React, { useMemo } from "react";
import { FinanceBiFilterPanel } from "@/src/components/finance/bi/FinanceBiFilterPanel";
import {
  applyOrderToCashFunnelPeriodPreset,
  buildOrderToCashFunnelFilterChips,
  countActiveOrderToCashFunnelFilters,
  createDefaultOrderToCashFunnelUiFilters,
  dateAxisLabel,
  type OrderToCashFunnelPeriodPreset,
  type OrderToCashFunnelUiFilters,
} from "@/src/lib/sales/salesOrderToCashFunnelFilters";
import { resolveFinanceBiFilterStatus } from "@/src/lib/financeBiFilterState";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import {
  ORDER_TO_CASH_ALERT_OPTIONS,
  ORDER_TO_CASH_CONFIDENCE_OPTIONS,
  ORDER_TO_CASH_DATE_AXIS_OPTIONS,
  ORDER_TO_CASH_PERIOD_PRESETS,
  ORDER_TO_CASH_RESPONSIBLE_OPTIONS,
  ORDER_TO_CASH_STAGE_FILTER_OPTIONS,
  ORDER_TO_CASH_STAGE_GROUP_OPTIONS,
  ORDER_TO_CASH_TEMPERATURE_OPTIONS,
} from "@/src/lib/sales/salesOrderToCashFunnelUiCopy";
import { cn } from "@/src/lib/utils";

type Props = {
  draft: OrderToCashFunnelUiFilters;
  applied: OrderToCashFunnelUiFilters;
  expanded: boolean;
  onToggle: () => void;
  onDraftChange: (next: OrderToCashFunnelUiFilters) => void;
  onApply: () => void;
  onClear: () => void;
  onApplyFilters: (next: OrderToCashFunnelUiFilters) => void;
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className={financeModuleFilterLabelClass()}>{children}</label>;
}

/**
 * Barra compacta + filtros avançados + chips — Funil Pedido → Caixa.
 */
export function OrderToCashFunnelFiltersBar({
  draft,
  applied,
  expanded,
  onToggle,
  onDraftChange,
  onApply,
  onClear,
  onApplyFilters,
}: Props) {
  const filterStatus = resolveFinanceBiFilterStatus(
    JSON.stringify(draft),
    JSON.stringify(applied)
  );

  const chips = useMemo(
    () =>
      buildOrderToCashFunnelFilterChips(applied, (field) => {
        const defaults = createDefaultOrderToCashFunnelUiFilters();
        const next: OrderToCashFunnelUiFilters = {
          ...applied,
          [field]: defaults[field],
        };
        if (field === "periodPreset") {
          return onApplyFilters(
            applyOrderToCashFunnelPeriodPreset(next, "current_year")
          );
        }
        if (field === "dateFrom" || field === "dateTo") {
          if (field === "dateFrom") next.dateFrom = "";
          if (field === "dateTo") next.dateTo = "";
          next.periodPreset =
            next.dateFrom || next.dateTo ? "custom" : "current_year";
          if (next.periodPreset === "current_year") {
            return onApplyFilters(
              applyOrderToCashFunnelPeriodPreset(next, "current_year")
            );
          }
        }
        if (field === "dateAxis") {
          next.dateAxis = "ORDER_ISSUE_DATE";
        }
        onApplyFilters({ ...next, page: 1 });
      }),
    [applied, onApplyFilters]
  );

  const activeCount = countActiveOrderToCashFunnelFilters(applied);

  const set = <K extends keyof OrderToCashFunnelUiFilters>(
    key: K,
    value: OrderToCashFunnelUiFilters[K]
  ) => onDraftChange({ ...draft, [key]: value });

  const applyPreset = (preset: OrderToCashFunnelPeriodPreset) => {
    onDraftChange(applyOrderToCashFunnelPeriodPreset(draft, preset));
  };

  return (
    <div data-testid="otc-filters">
      <FinanceBiFilterPanel
        compact
        title="Filtros"
        advancedLabel={`Filtros avançados${activeCount > 0 ? ` (${activeCount})` : ""}`}
        expanded={expanded}
        onToggle={onToggle}
        filterStatus={filterStatus}
        chips={chips}
        onApply={onApply}
        onClear={onClear}
        filterScopeNote={`Eixo ativo: ${dateAxisLabel(applied.dateAxis)}. Pedido por emissão ≠ CR por vencimento.`}
        alwaysVisible={
          <div className="space-y-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px]">
                <FieldLabel>Eixo de data</FieldLabel>
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.dateAxis}
                  data-testid="otc-date-axis"
                  onChange={(e) =>
                    set(
                      "dateAxis",
                      e.target.value as OrderToCashFunnelUiFilters["dateAxis"]
                    )
                  }
                >
                  {ORDER_TO_CASH_DATE_AXIS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[160px] flex-1">
                <FieldLabel>Cliente</FieldLabel>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.customerName}
                  placeholder="Nome do cliente"
                  data-testid="otc-filter-customer"
                  onChange={(e) => set("customerName", e.target.value)}
                />
              </div>
              <div className="min-w-[140px] flex-1">
                <FieldLabel>Vendedor</FieldLabel>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={draft.sellerName}
                  placeholder="Nome do vendedor"
                  data-testid="otc-filter-seller"
                  onChange={(e) => set("sellerName", e.target.value)}
                />
              </div>
              <div className="min-w-[160px]">
                <FieldLabel>Estágio</FieldLabel>
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.funnelStage}
                  data-testid="otc-filter-stage"
                  onChange={(e) => set("funnelStage", e.target.value)}
                >
                  {ORDER_TO_CASH_STAGE_FILTER_OPTIONS.map((o) => (
                    <option key={o.value || "all"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-[120px]">
                <FieldLabel>Temperatura</FieldLabel>
                <select
                  className={financeModuleFilterFieldClass()}
                  value={draft.temperature}
                  data-testid="otc-filter-temperature"
                  onChange={(e) => set("temperature", e.target.value)}
                >
                  {ORDER_TO_CASH_TEMPERATURE_OPTIONS.map((o) => (
                    <option key={o.value || "all-t"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" data-testid="otc-period-presets">
              {ORDER_TO_CASH_PERIOD_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  data-testid={`otc-period-${p.value}`}
                  className={cn(
                    "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                    draft.periodPreset === p.value
                      ? "border-sky-300 bg-sky-50 text-sky-950"
                      : "border-[#EAECF0] bg-white text-[#475467] hover:bg-[#F9FAFB]"
                  )}
                  onClick={() => applyPreset(p.value as OrderToCashFunnelPeriodPreset)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {draft.periodPreset === "custom" ||
            (!draft.periodPreset && (draft.dateFrom || draft.dateTo)) ? (
              <div className="flex flex-wrap items-end gap-2">
                <div>
                  <FieldLabel>De</FieldLabel>
                  <input
                    type="date"
                    className={financeModuleFilterFieldClass()}
                    value={draft.dateFrom}
                    data-testid="otc-date-from"
                    onChange={(e) =>
                      onDraftChange({
                        ...draft,
                        dateFrom: e.target.value,
                        periodPreset: "custom",
                      })
                    }
                  />
                </div>
                <div>
                  <FieldLabel>Até</FieldLabel>
                  <input
                    type="date"
                    className={financeModuleFilterFieldClass()}
                    value={draft.dateTo}
                    data-testid="otc-date-to"
                    onChange={(e) =>
                      onDraftChange({
                        ...draft,
                        dateTo: e.target.value,
                        periodPreset: "custom",
                      })
                    }
                  />
                </div>
              </div>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="otc-advanced-filters">
          <div>
            <FieldLabel>Empresa</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.companyName}
              placeholder="Empresa"
              data-testid="otc-filter-company"
              onChange={(e) => set("companyName", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Pedido</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.orderCode}
              placeholder="Código do pedido"
              data-testid="otc-filter-order"
              onChange={(e) => set("orderCode", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Produto / SKU</FieldLabel>
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.productSku}
              placeholder="SKU ou produto"
              data-testid="otc-filter-product"
              onChange={(e) => set("productSku", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Grupo do estágio</FieldLabel>
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.stageGroup}
              data-testid="otc-filter-stage-group"
              onChange={(e) => set("stageGroup", e.target.value)}
            >
              {ORDER_TO_CASH_STAGE_GROUP_OPTIONS.map((o) => (
                <option key={o.value || "all-g"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Confiança</FieldLabel>
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.confidenceLabel}
              data-testid="otc-filter-confidence"
              onChange={(e) => set("confidenceLabel", e.target.value)}
            >
              {ORDER_TO_CASH_CONFIDENCE_OPTIONS.map((o) => (
                <option key={o.value || "all-c"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Alerta</FieldLabel>
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.alert}
              data-testid="otc-filter-alert"
              onChange={(e) => set("alert", e.target.value)}
            >
              {ORDER_TO_CASH_ALERT_OPTIONS.map((o) => (
                <option key={o.value || "all-a"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Responsável sugerido</FieldLabel>
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.responsibleArea}
              data-testid="otc-filter-responsible"
              onChange={(e) => set("responsibleArea", e.target.value)}
            >
              {ORDER_TO_CASH_RESPONSIBLE_OPTIONS.map((o) => (
                <option key={o.value || "all-r"} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Valor mínimo</FieldLabel>
            <input
              type="number"
              min={0}
              step="0.01"
              className={financeModuleFilterFieldClass()}
              value={draft.minValue}
              placeholder="0"
              data-testid="otc-filter-min-value"
              onChange={(e) => set("minValue", e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Valor máximo</FieldLabel>
            <input
              type="number"
              min={0}
              step="0.01"
              className={financeModuleFilterFieldClass()}
              value={draft.maxValue}
              placeholder="—"
              data-testid="otc-filter-max-value"
              onChange={(e) => set("maxValue", e.target.value)}
            />
          </div>
        </div>
      </FinanceBiFilterPanel>
    </div>
  );
}
