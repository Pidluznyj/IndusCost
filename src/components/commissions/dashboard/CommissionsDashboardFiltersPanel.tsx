import React, { useEffect, useState } from "react";
import { Filter, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type {
  CommissionsPersonsPayload,
  CommissionsRulesPayload,
} from "@/src/components/commissions/commissionsTypes";
import {
  COMMISSION_PERSON_TYPE_OPTIONS,
  COMMISSION_STATUS_FILTER_OPTIONS,
  countActiveCommissionsDashboardFilters,
  EMPTY_COMMISSIONS_DASHBOARD_FILTERS,
  type CommissionsDashboardFilters,
} from "@/src/components/commissions/dashboard/commissionsDashboardFilters";

const inputClass =
  "h-9 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm text-[#111827] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#2563EB]/30";

type Props = {
  filters: CommissionsDashboardFilters;
  onChange: (next: CommissionsDashboardFilters) => void;
  onApply: () => void;
  disabled?: boolean;
};

export function CommissionsDashboardFiltersPanel({
  filters,
  onChange,
  onApply,
  disabled,
}: Props) {
  const [open, setOpen] = useState(true);
  const [persons, setPersons] = useState<Array<{ id: string; name: string }>>([]);
  const [rules, setRules] = useState<Array<{ id: string; name: string }>>([]);
  const activeCount = countActiveCommissionsDashboardFilters(filters);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [personsPayload, rulesPayload] = await Promise.all([
          fetchJsonOk<CommissionsPersonsPayload>("/api/commissions/persons?page=1&pageSize=200&active=true"),
          fetchJsonOk<CommissionsRulesPayload>("/api/commissions/rules?page=1&pageSize=200&active=true"),
        ]);
        if (cancelled) return;
        setPersons(personsPayload.items.map((p) => ({ id: p.id, name: p.name })));
        setRules(rulesPayload.items.map((r) => ({ id: r.id, name: r.name })));
      } catch {
        if (!cancelled) {
          setPersons([]);
          setRules([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(partial: Partial<CommissionsDashboardFilters>) {
    onChange({ ...filters, ...partial });
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
            onClick={() => onChange(EMPTY_COMMISSIONS_DASHBOARD_FILTERS)}
            className={cn(financeBiButtonOutlineClass, "h-8")}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Limpar
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onApply}
            className="inline-flex h-8 items-center rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Aplicar filtros
          </button>
        </div>
      </div>

      {open ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Ano
            <input
              type="number"
              className={inputClass}
              value={filters.year}
              onChange={(e) => patch({ year: e.target.value })}
              placeholder="Ex.: 2026"
              min={2000}
              max={2100}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Mês
            <input
              type="number"
              className={inputClass}
              value={filters.month}
              onChange={(e) => patch({ month: e.target.value })}
              placeholder="1–12"
              min={1}
              max={12}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            De
            <input
              type="date"
              className={inputClass}
              value={filters.from}
              onChange={(e) => patch({ from: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Até
            <input
              type="date"
              className={inputClass}
              value={filters.to}
              onChange={(e) => patch({ to: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Pessoa comissionada
            <select
              className={inputClass}
              value={filters.commissionPersonId}
              onChange={(e) => patch({ commissionPersonId: e.target.value })}
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
            Tipo de pessoa
            <select
              className={inputClass}
              value={filters.personType}
              onChange={(e) => patch({ personType: e.target.value })}
            >
              {COMMISSION_PERSON_TYPE_OPTIONS.map((opt) => (
                <option key={opt.value || "all"} value={opt.value}>
                  {opt.label}
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
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            NF-e
            <input
              type="text"
              className={inputClass}
              value={filters.nfeNumber}
              onChange={(e) => patch({ nfeNumber: e.target.value })}
              placeholder="Número da NF-e"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-[#6B7280]">
            Status
            <select
              className={inputClass}
              value={filters.status}
              onChange={(e) => patch({ status: e.target.value })}
            >
              {COMMISSION_STATUS_FILTER_OPTIONS.map((opt) => (
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
              value={filters.ruleId}
              onChange={(e) => patch({ ruleId: e.target.value })}
            >
              <option value="">Todas</option>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
