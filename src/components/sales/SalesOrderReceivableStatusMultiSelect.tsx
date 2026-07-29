import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  RECEIVABLE_STATUS_FILTER_OPTIONS,
  formatSalesOrderListReceivableStatusParam,
  parseSalesOrderListReceivableStatusParams,
  receivableStatusFilterLabel,
  type SalesOrderListReceivableStatus,
} from "@/src/lib/salesOrderListReceivableFilter";
import { cn } from "@/src/lib/utils";

const STATUS_CHOICES = RECEIVABLE_STATUS_FILTER_OPTIONS.filter(
  (o): o is { value: SalesOrderListReceivableStatus; label: string } =>
    Boolean(o.value)
);

type Props = {
  /** CSV (`open,settled`) ou vazio = todos. */
  value: string;
  onChange: (nextCsv: string) => void;
  disabled?: boolean;
  className?: string;
  controlClassName?: string;
};

/**
 * Multi-select de Status CR (OR) — checklist compacto alinhado ao filtro de meses.
 */
export function SalesOrderReceivableStatusMultiSelect({
  value,
  onChange,
  disabled,
  className,
  controlClassName,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => parseSalesOrderListReceivableStatusParams(value),
    [value]
  );
  const allSelected = selected.length === 0;

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const summary = allSelected
    ? "Todos"
    : receivableStatusFilterLabel(selected) ?? "Todos";

  function selectAll() {
    onChange("");
  }

  function toggleStatus(status: SalesOrderListReceivableStatus) {
    const set = new Set(selected);
    if (allSelected) {
      onChange(status);
      return;
    }
    if (set.has(status)) set.delete(status);
    else set.add(status);
    onChange(formatSalesOrderListReceivableStatusParam([...set]));
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        id="sales-orders-filter-receivable-status"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Filtrar por status de Contas a Receber"
        data-testid="sales-orders-filter-receivable-status"
        className={cn(
          controlClassName,
          "inline-flex items-center justify-between gap-2 text-left"
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 truncate">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          data-testid="sales-orders-filter-receivable-status-menu"
          className="absolute z-50 mt-1 w-full min-w-[12rem] rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          <button
            type="button"
            role="option"
            aria-selected={allSelected}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
              allSelected && "bg-accent/60 font-medium"
            )}
            onClick={() => {
              selectAll();
              setOpen(false);
            }}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded border border-border text-[9px]",
                allSelected && "border-primary bg-primary text-primary-foreground"
              )}
              aria-hidden
            >
              {allSelected ? "✓" : ""}
            </span>
            Todos
          </button>
          {STATUS_CHOICES.map((option) => {
            const checked = !allSelected && selected.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={checked}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  checked && "bg-accent/40"
                )}
                onClick={() => toggleStatus(option.value)}
              >
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 items-center justify-center rounded border border-border text-[9px]",
                    checked && "border-primary bg-primary text-primary-foreground"
                  )}
                  aria-hidden
                >
                  {checked ? "✓" : ""}
                </span>
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
