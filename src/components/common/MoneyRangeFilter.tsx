import React, { useId, useState } from "react";
import { Banknote, X } from "lucide-react";
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
    <label htmlFor={id} className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-xl border bg-background px-2.5 transition-colors",
          focused
            ? "border-primary/60 ring-2 ring-primary/15"
            : "border-border hover:border-primary/30"
        )}
      >
        <span className="select-none text-xs font-semibold text-emerald-700/80 dark:text-emerald-400/80">
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
          className="min-w-0 flex-1 bg-transparent text-sm font-medium tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50"
        />
      </div>
    </label>
  );
}

/**
 * Filtro visual De / Até com máscara BRL e atalhos de faixa.
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
    <div
      data-testid={testId}
      className={cn(
        "sm:col-span-2 rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50/80 via-background to-sky-50/40 p-3 shadow-sm dark:border-emerald-900/40 dark:from-emerald-950/30 dark:via-background dark:to-sky-950/20",
        className
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600/10 text-emerald-700 dark:text-emerald-400">
            <Banknote className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="text-xs text-muted-foreground/90">
              {summary ?? "Defina a faixa ou use um atalho"}
            </p>
          </div>
        </div>
        {summary ? (
          <button
            type="button"
            onClick={() => onChange({ minValue: "", maxValue: "" })}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-background/80 px-2 text-[10px] font-semibold text-muted-foreground hover:bg-accent"
            aria-label="Limpar faixa de valor"
          >
            <X className="h-3 w-3" />
            Limpar
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <MoneyField
          id={`${baseId}-min`}
          label="De"
          value={minValue}
          onParamChange={(param) => onChange({ minValue: param, maxValue })}
        />
        <div
          className="mb-3 hidden self-end text-xs font-semibold text-emerald-600/70 sm:block"
          aria-hidden
        >
          →
        </div>
        <MoneyField
          id={`${baseId}-max`}
          label="Até"
          value={maxValue}
          onParamChange={(param) => onChange({ minValue, maxValue: param })}
        />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5" role="group" aria-label="Atalhos de valor">
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
                "rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors",
                active
                  ? "bg-emerald-600 text-white shadow-sm"
                  : "bg-background/90 text-muted-foreground ring-1 ring-border hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-300"
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
