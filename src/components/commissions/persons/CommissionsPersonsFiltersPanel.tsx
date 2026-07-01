import React, { useState } from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import {
  COMMISSION_PERSON_ACTIVE_FILTER_OPTIONS,
  COMMISSION_PERSON_SOURCE_FILTER_OPTIONS,
  COMMISSION_PERSON_TYPE_FILTER_OPTIONS,
  countActiveCommissionsPersonsFilters,
  EMPTY_COMMISSIONS_PERSONS_FILTERS,
  type CommissionsPersonsFilters,
} from "@/src/components/commissions/persons/commissionsPersonsFilters";

const inputClass =
  "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

type Props = {
  filters: CommissionsPersonsFilters;
  onChange: (next: CommissionsPersonsFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsPersonsFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const activeCount = countActiveCommissionsPersonsFilters(filters);

  function patch(partial: Partial<CommissionsPersonsFilters>) {
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
            onClick={() => onChange({ ...EMPTY_COMMISSIONS_PERSONS_FILTERS })}
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
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-[#6B7280]">Busca</span>
            <input
              type="search"
              className={inputClass}
              placeholder="Nome, e-mail, documento ou ID Nomus"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Tipo</span>
            <select
              className={inputClass}
              value={filters.type}
              onChange={(e) => patch({ type: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_PERSON_TYPE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Origem</span>
            <select
              className={inputClass}
              value={filters.source}
              onChange={(e) => patch({ source: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_PERSON_SOURCE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Status</span>
            <select
              className={inputClass}
              value={filters.active}
              onChange={(e) => patch({ active: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_PERSON_ACTIVE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Ano (comissões)</span>
            <input
              type="number"
              className={inputClass}
              placeholder="2026"
              value={filters.year}
              onChange={(e) => patch({ year: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Mês (comissões)</span>
            <input
              type="number"
              min={1}
              max={12}
              className={inputClass}
              placeholder="1–12"
              value={filters.month}
              onChange={(e) => patch({ month: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">De</span>
            <input
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Até</span>
            <input
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
              disabled={disabled}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
