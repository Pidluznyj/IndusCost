import React, { useEffect, useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  COMMISSION_APURACAO_STATUS_OPTIONS,
  countActiveCommissionsApuracaoFilters,
  EMPTY_COMMISSIONS_APURACAO_FILTERS,
  type CommissionsApuracaoFilters,
} from "@/src/components/commissions/apuracao/commissionsApuracaoFilters";
import { COMMISSIONS_FILTER_FIELD_CLASS } from "@/src/lib/commissionsPeriodFilter";

const inputClass = COMMISSIONS_FILTER_FIELD_CLASS;

type Props = {
  filters: CommissionsApuracaoFilters;
  onChange: (next: CommissionsApuracaoFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsApuracaoFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const activeCount = countActiveCommissionsApuracaoFilters(filters);

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

  function patch(partial: Partial<CommissionsApuracaoFilters>) {
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
            onClick={() => onChange({ ...EMPTY_COMMISSIONS_APURACAO_FILTERS })}
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
            allowAllYears={false}
            disabled={disabled}
          />
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Vendedor</span>
            <select
              className={inputClass}
              value={filters.commissionPersonId}
              onChange={(e) => patch({ commissionPersonId: e.target.value })}
              disabled={disabled}
            >
              <option value="">Todos</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Cliente</span>
            <input
              type="text"
              className={inputClass}
              value={filters.customer}
              onChange={(e) => patch({ customer: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">NF-e</span>
            <input
              type="text"
              className={inputClass}
              value={filters.nfeNumber}
              onChange={(e) => patch({ nfeNumber: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Conta a receber</span>
            <input
              type="text"
              className={inputClass}
              value={filters.receivableCode}
              onChange={(e) => patch({ receivableCode: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Status apuração</span>
            <select
              className={inputClass}
              value={filters.apuracaoStatus}
              onChange={(e) => patch({ apuracaoStatus: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_APURACAO_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 pt-6 text-xs text-[#374151]">
            <input
              type="checkbox"
              checked={filters.onlyDivergences}
              onChange={(e) => patch({ onlyDivergences: e.target.checked })}
              disabled={disabled}
            />
            Apenas divergências
          </label>
          <label className="flex items-center gap-2 pt-6 text-xs text-[#374151]">
            <input
              type="checkbox"
              checked={filters.onlyPayable}
              onChange={(e) => patch({ onlyPayable: e.target.checked })}
              disabled={disabled}
            />
            Apenas liberadas p/ pagamento
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Ref. Nomus — base (R$)</span>
            <input
              type="text"
              className={inputClass}
              value={filters.nomusReferenceBase}
              onChange={(e) => patch({ nomusReferenceBase: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Ref. Nomus — comissão (R$)</span>
            <input
              type="text"
              className={inputClass}
              value={filters.nomusReferenceCommission}
              onChange={(e) => patch({ nomusReferenceCommission: e.target.value })}
              disabled={disabled}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
