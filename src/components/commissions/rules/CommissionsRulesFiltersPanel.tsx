import React, { useEffect, useState } from "react";
import { Filter, RotateCcw, Search } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import type { CommissionsPersonsPayload } from "@/src/components/commissions/commissionsTypes";
import {
  COMMISSION_RULE_BASE_OPTIONS,
  COMMISSION_RULE_BENEFICIARY_OPTIONS,
  COMMISSION_RULE_RELEASE_OPTIONS,
} from "@/src/components/commissions/rules/commissionsRulesLabels";
import {
  COMMISSION_RULE_ACTIVE_FILTER_OPTIONS,
  countActiveCommissionsRulesFilters,
  EMPTY_COMMISSIONS_RULES_FILTERS,
  type CommissionsRulesFilters,
} from "@/src/components/commissions/rules/commissionsRulesFilters";

const inputClass =
  "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

type Props = {
  filters: CommissionsRulesFilters;
  onChange: (next: CommissionsRulesFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsRulesFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const activeCount = countActiveCommissionsRulesFilters(filters);

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

  function patch(partial: Partial<CommissionsRulesFilters>) {
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
            onClick={() => onChange({ ...EMPTY_COMMISSIONS_RULES_FILTERS })}
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
              placeholder="Nome ou descrição da regra"
              value={filters.search}
              onChange={(e) => patch({ search: e.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Status</span>
            <select
              className={inputClass}
              value={filters.active}
              onChange={(e) => patch({ active: e.target.value })}
              disabled={disabled}
            >
              {COMMISSION_RULE_ACTIVE_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Beneficiário</span>
            <select
              className={inputClass}
              value={filters.beneficiaryType}
              onChange={(e) => patch({ beneficiaryType: e.target.value })}
              disabled={disabled}
            >
              <option value="">Todos</option>
              {COMMISSION_RULE_BENEFICIARY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Base de cálculo</span>
            <select
              className={inputClass}
              value={filters.baseType}
              onChange={(e) => patch({ baseType: e.target.value })}
              disabled={disabled}
            >
              <option value="">Todas</option>
              {COMMISSION_RULE_BASE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-[#6B7280]">Liberação</span>
            <select
              className={inputClass}
              value={filters.releaseRule}
              onChange={(e) => patch({ releaseRule: e.target.value })}
              disabled={disabled}
            >
              <option value="">Todas</option>
              {COMMISSION_RULE_RELEASE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-[#6B7280]">Pessoa fixa</span>
            <select
              className={inputClass}
              value={filters.fixedCommissionPersonId}
              onChange={(e) => patch({ fixedCommissionPersonId: e.target.value })}
              disabled={disabled}
            >
              <option value="">Qualquer</option>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
