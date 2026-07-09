import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search, X } from "lucide-react";
import {
  COST_CENTER_HH_HM_SIMULATION_CATEGORY_LABELS,
  filterCostCenterHhHmSimulationCostCenters,
  sortCostCenterHhHmSimulationCostCenters,
  type CostCenterHhHmSimulationCostCenterRow,
  type CostCenterHhHmSimulationHourType,
} from "@/src/lib/financeCostCenterHhHmSimulation";
import { cn } from "@/src/lib/utils";

type Props = {
  options: CostCenterHhHmSimulationCostCenterRow[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
  hourType: CostCenterHhHmSimulationHourType;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  disabled?: boolean;
};

export function CostCenterHhHmSimulationMultiselect({
  options,
  selectedIds,
  onChange,
  hourType,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const sortedOptions = useMemo(
    () => sortCostCenterHhHmSimulationCostCenters(options, hourType),
    [options, hourType]
  );

  const filteredOptions = useMemo(
    () => filterCostCenterHhHmSimulationCostCenters(sortedOptions, search),
    [sortedOptions, search]
  );

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const optionsById = useMemo(() => new Map(options.map((row) => [row.id, row])), [options]);

  const selectedRows = useMemo(
    () =>
      selectedIds
        .map((id) => optionsById.get(id))
        .filter((row): row is CostCenterHhHmSimulationCostCenterRow => row != null),
    [selectedIds, optionsById]
  );

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const toggleId = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const removeId = (id: string) => {
    onChange(selectedIds.filter((entry) => entry !== id));
  };

  const clearAll = () => onChange([]);

  return (
    <div ref={rootRef} className="space-y-2" data-testid="cost-center-hh-hm-multiselect">
      {selectedRows.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedRows.map((row) => (
            <span
              key={row.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-800"
              data-testid={`cost-center-chip-${row.id}`}
            >
              <span className="truncate font-semibold">{row.code}</span>
              <span className="truncate text-slate-600">— {row.name}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-slate-200"
                aria-label={`Remover ${row.code}`}
                disabled={disabled}
                onClick={() => removeId(row.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
            disabled={disabled}
            onClick={clearAll}
          >
            Limpar seleção
          </button>
        </div>
      ) : null}

      <div className="relative">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            disabled={disabled || loading}
            placeholder="Buscar por código ou nome do centro de custo…"
            className="h-11 w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-10 text-sm shadow-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50"
            aria-expanded={open}
            aria-controls={listId}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setSearch(event.target.value);
              setOpen(true);
            }}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label={open ? "Fechar lista" : "Abrir lista"}
            disabled={disabled || loading}
            onClick={() => setOpen((value) => !value)}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
            )}
          </button>
        </div>

        {open && !loading ? (
          <div
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500">
                {options.length === 0
                  ? "Nenhum centro de custo disponível."
                  : "Nenhum centro encontrado para esta busca."}
              </p>
            ) : (
              filteredOptions.map((row) => {
                const checked = selectedSet.has(row.id);
                const categoryLabel = row.category
                  ? COST_CENTER_HH_HM_SIMULATION_CATEGORY_LABELS[row.category]
                  : null;
                return (
                  <button
                    key={row.id}
                    type="button"
                    role="option"
                    aria-selected={checked}
                    className={cn(
                      "flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50",
                      checked && "bg-slate-50"
                    )}
                    onClick={() => toggleId(row.id)}
                  >
                    <input
                      type="checkbox"
                      readOnly
                      checked={checked}
                      className="mt-0.5 rounded border-slate-300"
                      tabIndex={-1}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-slate-900">{row.code}</span>
                      <span className="text-slate-700"> — {row.name}</span>
                      {categoryLabel ? (
                        <span className="mt-0.5 block text-[11px] text-slate-500">{categoryLabel}</span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>{error}</span>
          {onRetry ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium"
              onClick={onRetry}
            >
              <RefreshCw className="h-3 w-3" />
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        {hourType === "HH"
          ? "Prioridade sugerida: centros administrativos e de produção. Todos os centros ativos permanecem disponíveis."
          : "Prioridade sugerida: centros de máquina, energia e produção. Todos os centros ativos permanecem disponíveis."}
      </p>
    </div>
  );
}
