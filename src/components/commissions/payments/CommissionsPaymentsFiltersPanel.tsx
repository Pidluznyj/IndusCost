import React, { useEffect, useState } from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  COMMISSION_PAYMENT_BATCH_STATUS_OPTIONS,
  COMMISSION_PAYMENT_PERSON_TYPE_OPTIONS,
} from "@/src/components/commissions/payments/commissionsPaymentsLabels";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import {
  countActiveCommissionsPaymentsFilters,
  EMPTY_COMMISSIONS_PAYMENTS_FILTERS,
  type CommissionsPaymentsFilters,
} from "@/src/components/commissions/payments/commissionsPaymentsFilters";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

type Props = {
  filters: CommissionsPaymentsFilters;
  onChange: (next: CommissionsPaymentsFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsPaymentsFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const activeCount = countActiveCommissionsPaymentsFilters(filters);

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

  function patch(partial: Partial<CommissionsPaymentsFilters>) {
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
            onClick={() => onChange({ ...EMPTY_COMMISSIONS_PAYMENTS_FILTERS })}
            className={financeBiButtonOutlineClass}
          >
            <RotateCcw className="h-4 w-4" />
            Limpar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onApply}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white hover:bg-[#1D4ED8] disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            Aplicar
          </button>
        </div>
      </div>

      {open ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CommissionsPeriodFilterFields
            year={filters.year}
            month={filters.month}
            onYearChange={(year) => patch({ year })}
            onMonthChange={(month) => patch({ month })}
            allowAllYears={false}
            disabled={disabled}
          />
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Período de</span>
            <input
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Período até</span>
            <input
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-[#6B7280]">Pessoa comissionada</span>
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
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Status do lote</span>
            <select
              className={inputClass}
              value={filters.status}
              onChange={(e) => patch({ status: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_PAYMENT_BATCH_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Tipo de pessoa</span>
            <select
              className={inputClass}
              value={filters.personType}
              onChange={(e) => patch({ personType: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_PAYMENT_PERSON_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Pagamento de</span>
            <input
              type="date"
              className={inputClass}
              value={filters.paymentDateFrom}
              onChange={(e) => patch({ paymentDateFrom: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Pagamento até</span>
            <input
              type="date"
              className={inputClass}
              value={filters.paymentDateTo}
              onChange={(e) => patch({ paymentDateTo: e.target.value })}
              disabled={disabled}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
