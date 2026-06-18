import React from "react";
import type { CustomerIntelligenceUiFilters } from "@/src/lib/customerIntelligencePageFilters";
import { SALES_ORDER_STATUS_LABELS } from "@/src/lib/customerCommercialSalesOrderView";

const STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  ...Object.entries(SALES_ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const CUSTOMER_TYPE_OPTIONS = [
  { value: "external", label: "Cliente externo (padrão)" },
  { value: "all", label: "Todos (incl. grupo)" },
];

export function CustomerIntelligenceFilters({
  draft,
  onChange,
  onApply,
  onReset,
}: {
  draft: CustomerIntelligenceUiFilters;
  onChange: (patch: Partial<CustomerIntelligenceUiFilters>) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <section className="customer-intelligence-no-print rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold">Filtros</h2>
          <p className="text-xs text-muted-foreground">Período e escopo da análise comercial.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Início</span>
          <input
            type="date"
            value={draft.startDate}
            onChange={(e) => onChange({ startDate: e.target.value, year: e.target.value ? "" : draft.year })}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Fim</span>
          <input
            type="date"
            value={draft.endDate}
            onChange={(e) => onChange({ endDate: e.target.value, year: e.target.value ? "" : draft.year })}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Ano</span>
          <input
            type="number"
            min={2000}
            max={2100}
            value={draft.year}
            disabled={Boolean(draft.startDate || draft.endDate)}
            onChange={(e) => onChange({ year: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Status pedido</span>
          <select
            value={draft.status}
            onChange={(e) => onChange({ status: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value || "all"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Responsável</span>
          <input
            type="text"
            value={draft.responsible}
            onChange={(e) => onChange({ responsible: e.target.value })}
            placeholder="Nome do vendedor"
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Produto (ID)</span>
          <input
            type="text"
            value={draft.productId}
            onChange={(e) => onChange({ productId: e.target.value })}
            placeholder="UUID do produto"
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-mono text-xs"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Valor líq. mín.</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.minNetValue}
            onChange={(e) => onChange({ minNetValue: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Valor líq. máx.</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={draft.maxNetValue}
            onChange={(e) => onChange({ maxNetValue: e.target.value })}
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <label className="space-y-1 text-xs">
          <span className="font-semibold text-muted-foreground">Tipo de cliente</span>
          <select
            value={draft.customerType}
            onChange={(e) =>
              onChange({ customerType: e.target.value as CustomerIntelligenceUiFilters["customerType"] })
            }
            className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm"
          >
            {CUSTOMER_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
