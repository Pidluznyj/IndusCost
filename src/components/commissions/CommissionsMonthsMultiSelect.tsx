import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import {
  COMMISSIONS_FILTER_FIELD_CLASS,
  COMMISSIONS_FILTER_LABEL_CLASS,
} from "@/src/lib/commissionsPeriodFilter";
import { SALES_ORDER_MONTH_OPTIONS } from "@/src/lib/salesOrderPeriodFilter";
import {
  formatCommissionReportMonthsLabel,
  type CommissionReportsMonthsFilter,
} from "@/src/lib/commissions/commissionReports.shared";
import { cn } from "@/src/lib/utils";

const MONTH_OPTIONS = SALES_ORDER_MONTH_OPTIONS.map((m) => ({
  value: m.value,
  label: m.label,
}));

type Props = {
  value: CommissionReportsMonthsFilter;
  onChange: (next: CommissionReportsMonthsFilter) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};

function isAll(value: CommissionReportsMonthsFilter): boolean {
  return value === "all" || (Array.isArray(value) && value.length === 0);
}

export function CommissionsMonthsMultiSelect({
  value,
  onChange,
  disabled,
  label = "Meses",
  className,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selectedMonths = useMemo(() => {
    if (isAll(value)) return [] as number[];
    return Array.isArray(value) ? [...value].sort((a, b) => a - b) : [];
  }, [value]);

  const allSelected = isAll(value);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const summary = formatCommissionReportMonthsLabel(allSelected ? "all" : selectedMonths);

  function selectAll() {
    onChange("all");
  }

  function toggleMonth(month: number) {
    if (allSelected) {
      onChange([month]);
      return;
    }
    const set = new Set(selectedMonths);
    if (set.has(month)) set.delete(month);
    else set.add(month);
    const next = [...set].sort((a, b) => a - b);
    onChange(next.length === 0 ? "all" : next.length === 12 ? "all" : next);
  }

  function removeMonth(month: number) {
    if (allSelected) return;
    const next = selectedMonths.filter((m) => m !== month);
    onChange(next.length === 0 ? "all" : next);
  }

  return (
    <div className={cn("space-y-1", className)} ref={rootRef} data-testid="commissions-reports-months">
      <span className={COMMISSIONS_FILTER_LABEL_CLASS}>{label}</span>
      <div className="relative">
        <button
          type="button"
          className={cn(
            COMMISSIONS_FILTER_FIELD_CLASS,
            "flex items-center justify-between gap-2 text-left",
            disabled && "opacity-60"
          )}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          data-testid="commissions-reports-months-trigger"
        >
          <span className="truncate">{summary || "Selecionar meses"}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>

        {open ? (
          <div
            id={listId}
            role="listbox"
            aria-multiselectable
            className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-background p-2 shadow-lg"
            data-testid="commissions-reports-months-dropdown"
          >
            <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => selectAll()}
                className="h-4 w-4"
              />
              Todos os meses
            </label>
            <div className="my-1 border-t border-border" />
            {MONTH_OPTIONS.map((opt) => {
              const checked = !allSelected && selectedMonths.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleMonth(opt.value)}
                    className="h-4 w-4"
                  />
                  {opt.label}
                </label>
              );
            })}
            <div className="mt-2 flex gap-2 border-t border-border pt-2">
              <button
                type="button"
                className="text-xs font-medium text-primary underline"
                onClick={() => {
                  selectAll();
                  setOpen(false);
                }}
              >
                Limpar meses
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        {allSelected ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Todos os meses
          </span>
        ) : (
          selectedMonths.map((month) => {
            const opt = MONTH_OPTIONS.find((m) => m.value === month);
            return (
              <button
                key={month}
                type="button"
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                onClick={() => removeMonth(month)}
                aria-label={`Remover ${opt?.label ?? month}`}
              >
                {opt?.label ?? month}
                <X className="h-3 w-3" />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
