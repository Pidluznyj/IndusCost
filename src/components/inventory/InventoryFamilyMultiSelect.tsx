import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { inventoryFilterInputClass } from "@/src/components/inventory/inventoryUi";

type Props = {
  options: readonly string[];
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  className?: string;
};

function summaryLabel(selected: readonly string[]): string {
  if (selected.length === 0) return "Todas";
  if (selected.length === 1) return selected[0] ?? "Todas";
  return `${selected.length} famílias`;
}

export function InventoryFamilyMultiSelect({
  options,
  value,
  onChange,
  disabled,
  className,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(() => [...value], [value]);
  const allSelected = selected.length === 0;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    if (!needle) return options;
    return options.filter((name) => name.toLocaleLowerCase("pt-BR").includes(needle));
  }, [options, query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  function selectAll() {
    onChange([]);
  }

  function toggleFamily(name: string) {
    if (allSelected) {
      onChange([name]);
      return;
    }
    const set = new Set(selected);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    onChange([...set]);
  }

  return (
    <div ref={rootRef} className={cn("relative min-w-[220px]", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label="Filtrar por família"
        data-testid="inventory-balances-filter-family"
        className={cn(
          inventoryFilterInputClass,
          "inline-flex w-full items-center justify-between gap-2 text-left",
          disabled && "opacity-60"
        )}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="min-w-0 truncate">{summaryLabel(selected)}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
      </button>

      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          data-testid="inventory-balances-filter-family-menu"
          className="absolute z-50 mt-1 max-h-72 w-full min-w-[16rem] overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          {options.length > 8 ? (
            <input
              className={cn(inventoryFilterInputClass, "mb-1 w-full")}
              placeholder="Buscar família…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              data-testid="inventory-balances-filter-family-search"
            />
          ) : null}
          <button
            type="button"
            role="option"
            aria-selected={allSelected}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50",
              allSelected && "bg-slate-100 font-medium"
            )}
            onClick={() => {
              selectAll();
              setOpen(false);
            }}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded border border-slate-300 text-[9px]",
                allSelected && "border-slate-900 bg-slate-900 text-white"
              )}
              aria-hidden
            >
              {allSelected ? "✓" : ""}
            </span>
            Todas
          </button>
          {filtered.length === 0 ? (
            <p className="px-2 py-2 text-xs text-slate-500">Nenhuma família encontrada.</p>
          ) : (
            filtered.map((name) => {
              const checked = !allSelected && selected.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50",
                    checked && "bg-slate-50"
                  )}
                  onClick={() => toggleFamily(name)}
                >
                  <span
                    className={cn(
                      "flex h-3.5 w-3.5 items-center justify-center rounded border border-slate-300 text-[9px]",
                      checked && "border-slate-900 bg-slate-900 text-white"
                    )}
                    aria-hidden
                  >
                    {checked ? "✓" : ""}
                  </span>
                  {name}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
