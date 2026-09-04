import React from "react";
import { CRM_PERIOD_MONTH_OPTIONS, type CrmPeriodFilter } from "@/src/components/crm/crmPeriodFilter";

export type CrmPeriodFilterBarProps = {
  period: CrmPeriodFilter;
  onChange: (next: CrmPeriodFilter) => void;
  yearOptions: number[];
  /** Vira `${testIdPrefix}-period-filter` / `-filter-year` / `-filter-month`. */
  testIdPrefix: string;
  note?: React.ReactNode;
  disabled?: boolean;
};

/**
 * Barra "Ano ▼ / Mês ▼" única do CRM Comercial (Gestão por Responsável e
 * Carteira de Clientes). Mesma linguagem visual do seletor já usado na
 * Gestão Geral — ano sempre explícito, mês com "Ano inteiro" como opção de
 * abertura total do ano selecionado.
 */
export const CrmPeriodFilterBar: React.FC<CrmPeriodFilterBarProps> = ({
  period,
  onChange,
  yearOptions,
  testIdPrefix,
  note,
  disabled = false,
}) => (
  <div
    className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5"
    data-testid={`${testIdPrefix}-period-filter`}
  >
    <label className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        Ano
      </span>
      <select
        className="w-28 rounded-lg border border-border bg-background px-2 py-1.5 text-sm font-semibold tabular-nums disabled:opacity-50"
        value={period.year}
        disabled={disabled}
        onChange={(e) => onChange({ year: e.target.value, month: period.month })}
        data-testid={`${testIdPrefix}-filter-year`}
      >
        {yearOptions.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>
    </label>
    <label className="space-y-1">
      <span className="block text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        Mês
      </span>
      <select
        className="w-40 rounded-lg border border-border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
        value={period.month}
        disabled={disabled}
        onChange={(e) => onChange({ ...period, month: e.target.value })}
        data-testid={`${testIdPrefix}-filter-month`}
      >
        {CRM_PERIOD_MONTH_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
    {note ? <p className="pb-1 text-[11px] text-muted-foreground">{note}</p> : null}
  </div>
);
