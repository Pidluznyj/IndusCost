import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { FinanceSupplierSearchResult } from "@/src/lib/financeSupplierCostCenterRules";
import {
  buildFinanceSupplierSearchBadges,
  financeSupplierSearchOptionKey,
  formatFinanceSupplierSearchMeta,
} from "@/src/lib/financeSupplierSearchClient";
import { cn } from "@/src/lib/utils";

type Props = {
  selected: FinanceSupplierSearchResult | null;
  onSelect: (supplier: FinanceSupplierSearchResult | null) => void;
  disabled?: boolean;
  placeholder?: string;
  testIdPrefix?: string;
  initialQuery?: string;
  className?: string;
};

export function FinanceSupplierAutocomplete({
  selected,
  onSelect,
  disabled = false,
  placeholder = "Buscar por nome, CNPJ, CPF ou código…",
  testIdPrefix = "finance-supplier",
  initialQuery = "",
  className,
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<FinanceSupplierSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (selected) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++searchSeq.current;
    const handle = window.setTimeout(async () => {
      try {
        const payload = await fetchJsonOk<{ suppliers: FinanceSupplierSearchResult[] }>(
          `/api/finance/suppliers/search?search=${encodeURIComponent(term)}&limit=30`,
          { credentials: "include" }
        );
        if (seq !== searchSeq.current) return;
        setResults(payload.suppliers);
        setOpen(true);
      } catch {
        if (seq !== searchSeq.current) return;
        setResults([]);
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [query, selected]);

  if (selected) {
    return (
      <div
        className={cn("rounded-xl border border-primary/30 bg-primary/5 p-3", className)}
        data-testid={`${testIdPrefix}-selected`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="font-semibold">{selected.name}</p>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {buildFinanceSupplierSearchBadges(selected).map((badge) => (
                <span
                  key={badge.key}
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                    badge.className
                  )}
                >
                  {badge.label}
                </span>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{formatFinanceSupplierSearchMeta(selected)}</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
            disabled={disabled}
            onClick={() => {
              onSelect(null);
              setQuery("");
            }}
          >
            <X className="h-3 w-3" />
            Trocar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative space-y-1", className)}>
      <div className="flex items-center gap-2 rounded-xl border px-3 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" />
        <input
          data-testid={`${testIdPrefix}-search-input`}
          className="w-full bg-transparent text-sm outline-none"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
        />
      </div>
      {open && query.trim().length >= 2 ? (
        <div
          className="absolute z-10 mt-1 max-h-52 w-full overflow-auto rounded-xl border bg-background shadow-lg"
          data-testid={`${testIdPrefix}-dropdown`}
        >
          {searching ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Nenhum fornecedor encontrado para &quot;{query.trim()}&quot;.
            </p>
          ) : (
            results.map((supplier) => (
              <button
                key={financeSupplierSearchOptionKey(supplier)}
                type="button"
                data-testid={`${testIdPrefix}-option`}
                className="block w-full border-b px-3 py-2 text-left hover:bg-muted/50"
                onClick={() => {
                  onSelect(supplier);
                  setOpen(false);
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{supplier.name}</p>
                  {buildFinanceSupplierSearchBadges(supplier).map((badge) => (
                    <span
                      key={badge.key}
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{formatFinanceSupplierSearchMeta(supplier)}</p>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
