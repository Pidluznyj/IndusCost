/**
 * Filtro de período do Apoio ao Caixa — Ano / Mês (opcional) / Até, mesmo
 * padrão usado em outras telas da Tesouraria (ex.: `TreasuryCaixaPage`
 * "Ano/Mês/Dia", `TreasuryBankMovementsPanel` "De/Até"). Puramente
 * apresentacional: recebe o estado já resolvido e notifica mudanças —
 * quem decide `civilDateFrom`/`civilDateTo` é o componente pai.
 */

import React from "react";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

export const CASH_SUPPORT_MONTH_OPTIONS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
] as const;

export type CashSupportPeriodFilterState = {
  year: number;
  /** `""` = ano inteiro (Jan a Dez), sem mês específico. */
  month: number | "";
  /** Data civil (YYYY-MM-DD) do fim do período. */
  until: string;
};

export function CashSupportPeriodFilters({
  value,
  yearOptions,
  onChange,
}: {
  value: CashSupportPeriodFilterState;
  yearOptions: readonly number[];
  onChange: (next: CashSupportPeriodFilterState) => void;
}) {
  return (
    <div
      className="flex flex-wrap items-end gap-2"
      data-testid="cash-support-period-filters"
    >
      <label className="w-[6rem] space-y-0.5">
        <span className={financeModuleFilterLabelClass()}>Ano</span>
        <select
          className={financeModuleFilterFieldClass()}
          value={value.year}
          onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
          data-testid="cash-support-filter-year"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <label className="min-w-[9rem] space-y-0.5">
        <span className={financeModuleFilterLabelClass()}>Mês (opcional)</span>
        <select
          className={financeModuleFilterFieldClass()}
          value={value.month}
          onChange={(e) =>
            onChange({
              ...value,
              month: e.target.value === "" ? "" : Number(e.target.value),
            })
          }
          data-testid="cash-support-filter-month"
        >
          <option value="">Todos os meses</option>
          {CASH_SUPPORT_MONTH_OPTIONS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-0.5">
        <span className={financeModuleFilterLabelClass()}>Até</span>
        <input
          type="date"
          className={financeModuleFilterFieldClass()}
          value={value.until}
          onChange={(e) => onChange({ ...value, until: e.target.value })}
          data-testid="cash-support-filter-until"
        />
      </label>
    </div>
  );
}
