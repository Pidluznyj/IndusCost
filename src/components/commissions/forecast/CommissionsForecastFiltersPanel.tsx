import React, { useEffect, useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import {
  COMMISSION_FORECAST_STATUS_OPTIONS,
  COMMISSION_HAS_RULE_OPTIONS,
  countActiveCommissionsForecastFilters,
  EMPTY_COMMISSIONS_FORECAST_FILTERS,
  type CommissionsForecastFilters,
} from "@/src/components/commissions/forecast/commissionsForecastFilters";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

type Props = {
  filters: CommissionsForecastFilters;
  onChange: (next: CommissionsForecastFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsForecastFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const activeCount = countActiveCommissionsForecastFilters(filters);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const payload = await fetchJsonOk<CommissionsPersonsPayload>(
          "/api/commissions/persons?page=1&pageSize=200&active=true"
        );
        if (!cancelled) {
          setPersons(payload.items.map((p) => ({ id: p.id, name: p.name })));
        }
      } catch {
        if (!cancelled) setPersons([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(partial: Partial<CommissionsForecastFilters>) {
    onChange({ ...filters, ...partial, page: 1 });
  }

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[#111827]"
        >
          <Filter className="h-4 w-4" />
          Filtros
          {activeCount > 0 ? (
            <span className="rounded-full bg-[#2563EB]/10 px-2 py-0.5 text-xs font-bold text-[#2563EB]">
              {activeCount}
            </span>
          ) : null}
        </button>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...EMPTY_COMMISSIONS_FORECAST_FILTERS })}
            className={financeBiButtonOutlineClass}
          >
            <RotateCcw className="h-4 w-4" />
            Limpar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onApply}
            className="inline-flex h-9 items-center rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {open ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <CommissionsPeriodFilterFields
            year={filters.year}
            month={filters.month}
            onYearChange={(year) => patch({ year })}
            onMonthChange={(month) => patch({ month })}
            disabled={disabled}
            labelClassName="text-xs font-medium text-[#6B7280]"
          />
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Período de
            <input
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Período até
            <input
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Pessoa comissionada
            <select
              className={inputClass}
              value={filters.commissionPersonId}
              onChange={(e) => patch({ commissionPersonId: e.target.value })}
              disabled={disabled}
            >
              <option value="">Todas</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Cliente
            <input
              type="text"
              className={inputClass}
              value={filters.customer}
              onChange={(e) => patch({ customer: e.target.value })}
              placeholder="Nome do cliente"
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Pedido
            <input
              type="text"
              className={inputClass}
              value={filters.orderCode}
              onChange={(e) => patch({ orderCode: e.target.value })}
              placeholder="Código do pedido"
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Vendedor (ID Nomus)
            <input
              type="number"
              className={inputClass}
              value={filters.sellerId}
              onChange={(e) => patch({ sellerId: e.target.value })}
              placeholder="ID externo"
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Representante (ID Nomus)
            <input
              type="number"
              className={inputClass}
              value={filters.representativeId}
              onChange={(e) => patch({ representativeId: e.target.value })}
              placeholder="ID externo"
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Status
            <select
              className={inputClass}
              value={filters.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_FORECAST_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Regra de comissão
            <select
              className={inputClass}
              value={filters.hasRule}
              onChange={(e) => patch({ hasRule: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_HAS_RULE_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-xs font-medium text-[#6B7280]">
            <input
              type="checkbox"
              checked={filters.includeSuperseded}
              onChange={(e) => patch({ includeSuperseded: e.target.checked })}
              disabled={disabled}
              className="h-4 w-4 rounded border-[#D1D5DB]"
            />
            Incluir substituídas
          </label>
        </div>
      ) : null}
    </div>
  );
}
