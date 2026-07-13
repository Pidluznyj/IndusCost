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
  ORDER_STATUS_OPERATIONAL_OPTIONS,
  ORDER_STATUS_PERIOD_PRESETS,
  ORDER_STATUS_TEMPERATURE_OPTIONS,
  applyOrderStatusPeriodPreset,
  formatOrderStatusAlertLabel,
  yearOptionsForOrderStatus,
  type OrderStatusPeriodPreset,
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

function QuickToggle({
  label,
  checked,
  onChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium",
        checked
          ? "border-sky-300 bg-sky-50 text-sky-950"
          : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]"
      )}
      data-testid={testId}
    >
      <input
        type="checkbox"
        className="h-3 w-3"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
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

  const showCustomDates =
    draft.periodPreset === "custom" ||
    draft.periodPreset === "" ||
    Boolean(draft.from || draft.to);

  return (
    <div className="mb-4 space-y-3" data-testid="order-status-filters">
      <div className="rounded-[14px] border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
            Período
          </span>
          {ORDER_STATUS_PERIOD_PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-medium",
                draft.periodPreset === p.value
                  ? "border-sky-300 bg-sky-50 text-sky-950"
                  : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]"
              )}
              onClick={() =>
                onDraftChange(
                  applyOrderStatusPeriodPreset(
                    draft,
                    p.value as OrderStatusPeriodPreset
                  )
                )
              }
              data-testid={`order-status-period-${p.value || "none"}`}
            >
              {p.label}
            </button>
          ))}
        </div>

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
                  customerExternalId: external || "",
                  customerName: sel?.name?.trim() ?? "",
                });
              }}
            />
          </div>

          <Field label="Ano *">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.year}
              onChange={(e) =>
                patch({ year: e.target.value, periodPreset: draft.periodPreset === "current_year" ? "" : draft.periodPreset })
              }
              data-testid="order-status-year"
            >
              {yearOptionsForOrderStatus().map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </Field>

          {showCustomDates ? (
            <>
              <Field label="Período de">
                <input
                  type="date"
                  className={financeModuleFilterFieldClass()}
                  value={draft.from}
                  onChange={(e) =>
                    patch({ from: e.target.value, periodPreset: "custom" })
                  }
                  data-testid="order-status-from"
                />
              </Field>
              <Field label="Período até">
                <input
                  type="date"
                  className={financeModuleFilterFieldClass()}
                  value={draft.to}
                  onChange={(e) =>
                    patch({ to: e.target.value, periodPreset: "custom" })
                  }
                  data-testid="order-status-to"
                />
              </Field>
            </>
          ) : null}

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

          <Field label="Status operacional">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.operationalStatus}
              onChange={(e) => patch({ operationalStatus: e.target.value })}
            >
              <option value="">Todos</option>
              {ORDER_STATUS_OPERATIONAL_OPTIONS.map((o) => (
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

          <Field label="Alerta">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.alert}
              onChange={(e) => patch({ alert: e.target.value })}
            >
              <option value="">Todos</option>
              {ORDER_STATUS_ALERT_OPTIONS.map((a) => (
                <option key={a} value={a}>
                  {formatOrderStatusAlertLabel(a)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Responsável comercial">
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.responsibleName}
              placeholder="Nome…"
              onChange={(e) => patch({ responsibleName: e.target.value })}
              data-testid="order-status-responsible"
            />
          </Field>

          <Field label="Vendedor do pedido">
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.sellerName}
              placeholder="Nome…"
              onChange={(e) => patch({ sellerName: e.target.value })}
              data-testid="order-status-seller"
            />
          </Field>

          <Field label="Produto / SKU">
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.productOrSku}
              placeholder="Código ou SKU…"
              onChange={(e) => patch({ productOrSku: e.target.value })}
              data-testid="order-status-product"
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <QuickToggle
            label="Somente CR aberto"
            checked={draft.onlyWithOpenCr}
            onChange={(v) => patch({ onlyWithOpenCr: v })}
            testId="order-status-only-open-cr"
          />
          <QuickToggle
            label="Somente divergências"
            checked={draft.onlyWithDivergences}
            onChange={(v) => patch({ onlyWithDivergences: v })}
            testId="order-status-only-divergences"
          />
          <QuickToggle
            label="Somente saldo pendente"
            checked={draft.onlyWithPendingBalance}
            onChange={(v) => patch({ onlyWithPendingBalance: v })}
            testId="order-status-only-pending"
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
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
            Limpar tudo
          </button>
        </div>
      </div>
    </div>
  );
}
