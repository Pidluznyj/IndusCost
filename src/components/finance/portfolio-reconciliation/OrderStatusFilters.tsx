import React from "react";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import {
  CustomerAutocompleteFilter,
  type EntityAutocompleteSelection,
} from "@/src/components/common/CustomerAutocompleteFilter";
import { resolveExternalCustomerIdFromSelection } from "@/src/lib/finance/orderToCashAuditClient";
import {
  ORDER_STATUS_ALERT_OPTIONS,
  ORDER_STATUS_CONSOLIDATED_OPTIONS,
  ORDER_STATUS_FINANCIAL_OPTIONS,
  ORDER_STATUS_TEMPERATURE_OPTIONS,
  yearOptionsForOrderStatus,
  type OrderStatusUiFilters,
} from "@/src/lib/finance/portfolioOrderStatusClient";
import { cn } from "@/src/lib/utils";

type Props = {
  draft: OrderStatusUiFilters;
  onDraftChange: (next: OrderStatusUiFilters) => void;
  customerSelection: EntityAutocompleteSelection | null;
  onCustomerChange: (sel: EntityAutocompleteSelection | null) => void;
  onApply: () => void;
  onClear: () => void;
  canApply: boolean;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={financeModuleFilterLabelClass()}>{label}</span>
      {children}
    </label>
  );
}

export function OrderStatusFilters({
  draft,
  onDraftChange,
  customerSelection,
  onCustomerChange,
  onApply,
  onClear,
  canApply,
}: Props) {
  const patch = (partial: Partial<OrderStatusUiFilters>) =>
    onDraftChange({ ...draft, ...partial });

  return (
    <div className="mb-4 space-y-3" data-testid="order-status-filters">
      <div className="rounded-[14px] border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <div className="sm:col-span-2 lg:col-span-2">
            <CustomerAutocompleteFilter
              label="Cliente"
              value={customerSelection}
              placeholder="Buscar por nome…"
              allowFreeText
              onChange={(sel) => {
                onCustomerChange(sel);
                const external = resolveExternalCustomerIdFromSelection(sel);
                patch({
                  customerId: sel?.id ?? "",
                  customerExternalId: external || draft.customerExternalId,
                  customerName: sel?.name?.trim() ?? "",
                });
              }}
            />
          </div>

          <Field label="Ano *">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.year}
              onChange={(e) => patch({ year: e.target.value })}
              data-testid="order-status-year"
            >
              {yearOptionsForOrderStatus().map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Período de">
            <input
              type="date"
              className={financeModuleFilterFieldClass()}
              value={draft.from}
              onChange={(e) => patch({ from: e.target.value })}
            />
          </Field>

          <Field label="Período até">
            <input
              type="date"
              className={financeModuleFilterFieldClass()}
              value={draft.to}
              onChange={(e) => patch({ to: e.target.value })}
            />
          </Field>

          <Field label="Status consolidado">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.consolidatedStatus}
              onChange={(e) => patch({ consolidatedStatus: e.target.value })}
            >
              <option value="">Todos</option>
              {ORDER_STATUS_CONSOLIDATED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Status financeiro">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.financialStatus}
              onChange={(e) => patch({ financialStatus: e.target.value })}
            >
              <option value="">Todos</option>
              {ORDER_STATUS_FINANCIAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Temperatura">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.temperature}
              onChange={(e) => patch({ temperature: e.target.value })}
            >
              <option value="">Todas</option>
              {ORDER_STATUS_TEMPERATURE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Alertas">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.alert}
              onChange={(e) => patch({ alert: e.target.value })}
            >
              <option value="">Todos</option>
              {ORDER_STATUS_ALERT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            )}
            disabled={!canApply}
            onClick={onApply}
            data-testid="order-status-apply"
          >
            Aplicar
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg border border-[#E5E7EB] bg-white px-3 text-xs font-semibold text-[#111827] hover:bg-[#F9FAFB]"
            onClick={onClear}
            data-testid="order-status-clear"
          >
            Limpar
          </button>
        </div>
      </div>
    </div>
  );
}
