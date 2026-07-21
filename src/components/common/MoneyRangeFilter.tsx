import React, { useId, useState } from "react";
import {
  MONEY_RANGE_PRESETS,
  formatMoneyAmountInput,
  formatMoneyRangeSummary,
  moneyAmountToFilterParam,
  resolveActiveMoneyRangePreset,
} from "@/src/lib/moneyRangeFilter.js";
import { cn } from "@/src/lib/utils.js";

export type MoneyRangeFilterProps = {
  minValue: string;
  maxValue: string;
  onChange: (next: { minValue: string; maxValue: string }) => void;
  /** Rótulo do grupo de atalhos (aria). */
  label?: string;
  className?: string;
  testId?: string;
};

function MoneyField({
  id,
  label,
  value,
  onParamChange,
  placeholder = "0,00",
}: {
  id: string;
  label: string;
  value: string;
  onParamChange: (param: string) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(() => formatMoneyAmountInput(value));
  const [focused, setFocused] = useState(false);

  const externalDisplay = formatMoneyAmountInput(value);
  const shown = focused ? draft : externalDisplay;

  return (
    <label htmlFor={id} className="space-y-1">
      <span className="text-[10px] font-bold uppercase text-muted-foreground">{label}</span>
      <div className="relative">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          R$
        </span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          value={shown}
          placeholder={placeholder}
          onFocus={() => {
            setFocused(true);
            setDraft(formatMoneyAmountInput(value) || value);
          }}
          onBlur={() => {
            setFocused(false);
            const param = moneyAmountToFilterParam(draft);
            onParamChange(param);
            setDraft(formatMoneyAmountInput(param));
          }}
          onChange={(e) => {
            const next = e.target.value;
            setDraft(next);
            onParamChange(moneyAmountToFilterParam(next));
          }}
          className="w-full h-9 rounded-lg border border-border bg-background pl-8 pr-2.5 text-sm tabular-nums"
        />
      </div>
    </label>
  );
}

/**
 * Filtro De / Até com máscara BRL e atalhos de faixa.
 * Renderiza como itens da grade de filtros (mesmo padrão visual dos demais campos).
 * Emite valores canônicos (ex.: "1000", "50000.5") para a query existente.
 */
export function MoneyRangeFilter({
  minValue,
  maxValue,
  onChange,
  label = "Valor do título",
  className,
  testId = "money-range-filter",
}: MoneyRangeFilterProps) {
  const baseId = useId();
  const activePreset = resolveActiveMoneyRangePreset(minValue, maxValue);
  const summary = formatMoneyRangeSummary(minValue, maxValue);

  return (
    <>
      <MoneyField
        id={`${baseId}-min`}
        label="Valor de"
        value={minValue}
        onParamChange={(param) => onChange({ minValue: param, maxValue })}
      />
      <MoneyField
        id={`${baseId}-max`}
        label="Valor até"
        value={maxValue}
        onParamChange={(param) => onChange({ minValue, maxValue: param })}
      />
      <div
        data-testid={testId}
        className={cn(
          "col-span-full flex flex-wrap items-center gap-1.5",
          className
        )}
        role="group"
        aria-label={label}
      >
        {MONEY_RANGE_PRESETS.map((preset) => {
          const active = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() =>
                onChange({
                  minValue: preset.minValue,
                  maxValue: preset.maxValue,
                })
              }
              className={cn(
                "h-7 rounded-lg border px-2 text-[10px] font-semibold transition-colors",
                active
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {preset.label}
            </button>
          );
        })}
        {summary ? (
          <button
            type="button"
            onClick={() => onChange({ minValue: "", maxValue: "" })}
            className="ml-1 h-7 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
            aria-label="Limpar faixa de valor"
          >
            Limpar valor
          </button>
        ) : null}
      </div>
    </>
  );
}
