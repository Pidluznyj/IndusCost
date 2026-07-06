import React, { useEffect, useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import {
  COMMISSION_ACCOUNT_STATUS_OPTIONS,
  COMMISSION_RELEASE_FILTER_OPTIONS,
  countActiveCommissionsReleasesFilters,
  EMPTY_COMMISSIONS_RELEASES_FILTERS,
  type CommissionsReleasesFilters,
} from "@/src/components/commissions/releases/commissionsReleasesFilters";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

type Props = {
  filters: CommissionsReleasesFilters;
  onChange: (next: CommissionsReleasesFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsReleasesFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const activeCount = countActiveCommissionsReleasesFilters(filters);

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

  function patch(partial: Partial<CommissionsReleasesFilters>) {
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
            onClick={() => onChange({ ...EMPTY_COMMISSIONS_RELEASES_FILTERS })}
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
            yearLabel="Ano (vencimento)"
            monthLabel="Mês (vencimento)"
            disabled={disabled}
            labelClassName="text-xs font-medium text-[#6B7280]"
          />
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Vencimento de
            <input
              type="date"
              className={inputClass}
              value={filters.dueFrom}
              onChange={(e) => patch({ dueFrom: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Vencimento até
            <input
              type="date"
              className={inputClass}
              value={filters.dueTo}
              onChange={(e) => patch({ dueTo: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Baixa de
            <input
              type="date"
              className={inputClass}
              value={filters.settlementFrom}
              onChange={(e) => patch({ settlementFrom: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Baixa até
            <input
              type="date"
              className={inputClass}
              value={filters.settlementTo}
              onChange={(e) => patch({ settlementTo: e.target.value })}
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
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            NF-e
            <input
              type="text"
              className={inputClass}
              value={filters.nfeNumber}
              onChange={(e) => patch({ nfeNumber: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Conta a Receber (ID)
            <input
              type="number"
              className={inputClass}
              value={filters.receivableId}
              onChange={(e) => patch({ receivableId: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Status da conta
            <select
              className={inputClass}
              value={filters.accountStatus}
              onChange={(e) => patch({ accountStatus: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_ACCOUNT_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Liberação
            <select
              className={inputClass}
              value={filters.releaseFilter}
              onChange={(e) => patch({ releaseFilter: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_RELEASE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
