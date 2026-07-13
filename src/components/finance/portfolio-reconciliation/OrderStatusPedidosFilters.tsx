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
  ORDER_STATUS_PEDIDOS_STATUS_LABEL,
  type OrderStatusPedidosStatus,
} from "@/src/lib/finance/orderStatusPedidosApi";
import type { OrderStatusPedidosUiFilters } from "@/src/lib/finance/orderStatusPedidosClient";
import { cn } from "@/src/lib/utils";

type Props = {
  draft: OrderStatusPedidosUiFilters;
  onDraftChange: (next: OrderStatusPedidosUiFilters) => void;
  customerSelection: EntityAutocompleteSelection | null;
  onCustomerChange: (sel: EntityAutocompleteSelection | null) => void;
  onSearch: () => void;
  onClear: () => void;
  canSearch: boolean;
};

const STATUS_OPTIONS = Object.keys(
  ORDER_STATUS_PEDIDOS_STATUS_LABEL
) as OrderStatusPedidosStatus[];

function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3, y - 4];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className={financeModuleFilterLabelClass()}>{label}</span>
      {children}
    </label>
  );
}

export function OrderStatusPedidosFilters({
  draft,
  onDraftChange,
  customerSelection,
  onCustomerChange,
  onSearch,
  onClear,
  canSearch,
}: Props) {
  const patch = (partial: Partial<OrderStatusPedidosUiFilters>) =>
    onDraftChange({ ...draft, ...partial });

  return (
    <div className="mb-4 space-y-3" data-testid="order-status-pedidos-filters">
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
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
              data-testid="order-status-pedidos-year"
            >
              {yearOptions().map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Pedido">
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.orderCode}
              onChange={(e) => patch({ orderCode: e.target.value })}
              placeholder="PD …"
            />
          </Field>
          <Field label="Status">
            <select
              className={financeModuleFilterFieldClass()}
              value={draft.orderStatus}
              onChange={(e) => patch({ orderStatus: e.target.value })}
            >
              <option value="">Todos</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {ORDER_STATUS_PEDIDOS_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Vendedor">
            <input
              className={financeModuleFilterFieldClass()}
              value={draft.sellerName}
              onChange={(e) => patch({ sellerName: e.target.value })}
              placeholder="Nome…"
            />
          </Field>
        </div>

        <div className="mt-3 flex flex-wrap gap-3 text-xs">
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.onlyWithPendingItems}
              onChange={(e) => patch({ onlyWithPendingItems: e.target.checked })}
            />
            Só com item pendente
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.onlyWithOpenCr}
              onChange={(e) => patch({ onlyWithOpenCr: e.target.checked })}
            />
            Só com CR aberto
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.onlyWithDivergences}
              onChange={(e) => patch({ onlyWithDivergences: e.target.checked })}
            />
            Só com divergência
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={draft.onlyWithAlerts}
              onChange={(e) => patch({ onlyWithAlerts: e.target.checked })}
            />
            Só com alertas
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              "inline-flex h-9 items-center rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            )}
            disabled={!canSearch}
            onClick={onSearch}
            data-testid="order-status-pedidos-search"
          >
            Pesquisar
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center rounded-lg border border-border bg-white px-3 text-xs font-semibold hover:bg-muted/40"
            onClick={onClear}
          >
            Limpar
          </button>
        </div>
      </div>
    </div>
  );
}
