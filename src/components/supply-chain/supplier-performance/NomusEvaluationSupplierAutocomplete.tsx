/**
 * Autocomplete de fornecedor da worklist Nomus.
 * Lista nomes da base de Pedidos Nomus para o usuário escolher o correto.
 */
import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  searchNomusEvaluationSuppliersRequest,
  type NomusEvaluationSupplierSuggestion,
} from "@/src/lib/purchasing/nomusPurchaseOrderEvaluationClient";

export function NomusEvaluationSupplierAutocomplete({
  selected,
  onSelect,
}: {
  selected: NomusEvaluationSupplierSuggestion | null;
  onSelect: (supplier: NomusEvaluationSupplierSuggestion | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NomusEvaluationSupplierSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    if (selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const current = ++seq.current;
    const handle = window.setTimeout(() => {
      void searchNomusEvaluationSuppliersRequest(term)
        .then((payload) => {
          if (current !== seq.current) return;
          setResults(payload.suppliers);
          setOpen(true);
        })
        .catch(() => {
          if (current !== seq.current) return;
          setResults([]);
        })
        .finally(() => {
          if (current === seq.current) setSearching(false);
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, selected]);

  if (selected) {
    const label = selected.resolvedName || selected.nomusName || "Fornecedor";
    return (
      <div
        className="flex min-w-[16rem] items-start justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-2 py-1.5"
        data-testid="nse-supplier-selected"
      >
        <div>
          <p className="text-sm font-semibold text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">
            {selected.orderCount} pedido{selected.orderCount === 1 ? "" : "s"}
            {selected.supplierExternalId != null ? ` · Nomus #${selected.supplierExternalId}` : ""}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold"
          onClick={() => {
            onSelect(null);
            setQuery("");
          }}
        >
          <X className="h-3 w-3" />
          Trocar
        </button>
      </div>
    );
  }

  return (
    <div className="relative min-w-[16rem] flex-1">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Fornecedor
        <span className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            className="w-full bg-transparent text-sm text-foreground outline-none"
            placeholder="Digite o nome para selecionar"
            data-testid="nse-filter-supplier"
          />
        </span>
      </label>
      {open && query.trim().length >= 2 ? (
        <ul
          className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-white py-1 text-sm shadow-md"
          data-testid="nse-supplier-results"
        >
          {searching ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Buscando…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">Nenhum fornecedor com esse nome.</li>
          ) : (
            results.map((row) => {
              const key = `${row.supplierExternalId ?? "n"}-${row.nomusName ?? ""}`;
              const label = row.resolvedName || row.nomusName || "Sem nome";
              return (
                <li key={key}>
                  <button
                    type="button"
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-muted/60"
                    onClick={() => {
                      onSelect(row);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {row.orderCount} pedido{row.orderCount === 1 ? "" : "s"}
                      {row.nomusName && row.resolvedName && row.nomusName !== row.resolvedName
                        ? ` · Nomus: ${row.nomusName}`
                        : ""}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      ) : null}
    </div>
  );
}
