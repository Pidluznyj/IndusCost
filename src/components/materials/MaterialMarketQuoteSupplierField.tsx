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

export type MaterialMarketQuoteSupplierValue = {
  supplierId: string | null;
  supplierName: string;
};

type Props = {
  value: MaterialMarketQuoteSupplierValue;
  onChange: (value: MaterialMarketQuoteSupplierValue) => void;
  disabled?: boolean;
};

export function MaterialMarketQuoteSupplierField({ value, onChange, disabled = false }: Props) {
  const [query, setQuery] = useState(value.supplierName);
  const [results, setResults] = useState<FinanceSupplierSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedMeta, setSelectedMeta] = useState<FinanceSupplierSearchResult | null>(null);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (!value.supplierId && !value.supplierName) {
      setQuery("");
      setSelectedMeta(null);
      return;
    }
    if (value.supplierId && selectedMeta?.id === value.supplierId) return;
    if (!value.supplierId) {
      setQuery(value.supplierName);
      setSelectedMeta(null);
    }
  }, [value.supplierId, value.supplierName, selectedMeta?.id]);

  useEffect(() => {
    if (selectedMeta) return;

    const term = query.trim();
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
    }, term.length === 0 ? 0 : 300);

    return () => window.clearTimeout(handle);
  }, [query, selectedMeta]);

  const applyRegisteredSupplier = (supplier: FinanceSupplierSearchResult) => {
    setSelectedMeta(supplier);
    setQuery(supplier.name);
    setOpen(false);
    onChange({
      supplierId: supplier.id,
      supplierName: supplier.name,
    });
  };

  const applyFreeTextSupplier = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSelectedMeta(null);
    setQuery(trimmed);
    setOpen(false);
    onChange({ supplierId: null, supplierName: trimmed });
  };

  const clearSelection = () => {
    setSelectedMeta(null);
    setQuery("");
    setResults([]);
    setOpen(false);
    onChange({ supplierId: null, supplierName: "" });
  };

  if (selectedMeta) {
    return (
      <div
        className="rounded-lg border border-primary/30 bg-primary/5 p-3"
        data-testid="material-market-quote-supplier-selected"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-0.5">
            <p className="font-semibold text-sm">{selectedMeta.name}</p>
            <div className="flex flex-wrap gap-1 pt-0.5">
              {buildFinanceSupplierSearchBadges(selectedMeta).map((badge) => (
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
            <p className="text-xs text-muted-foreground">
              {formatFinanceSupplierSearchMeta(selectedMeta)}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
            disabled={disabled}
            onClick={clearSelection}
            data-testid="material-market-quote-supplier-clear"
          >
            <X className="h-3 w-3" />
            Trocar
          </button>
        </div>
      </div>
    );
  }

  if (!selectedMeta && value.supplierName.trim()) {
    return (
      <div
        className="rounded-lg border border-border bg-muted/20 p-3"
        data-testid="material-market-quote-supplier-free-text"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{value.supplierName}</p>
            <p className="text-xs text-muted-foreground">Fornecedor não cadastrado</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
            disabled={disabled}
            onClick={clearSelection}
            data-testid="material-market-quote-supplier-clear"
          >
            <X className="h-3 w-3" />
            Trocar
          </button>
        </div>
      </div>
    );
  }

  const trimmedQuery = query.trim();
  const showFreeTextOption = trimmedQuery.length >= 1;

  return (
    <div className="relative space-y-1">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          data-testid="material-market-quote-supplier-search"
          className="w-full bg-transparent text-sm outline-none"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
          }}
          placeholder="Buscar fornecedor cadastrado ou digitar nome…"
          required
        />
      </div>
      {open ? (
        <div
          className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg"
          data-testid="material-market-quote-supplier-dropdown"
        >
          {searching ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Buscando fornecedores…</p>
          ) : (
            <>
              {results.length === 0 && !showFreeTextOption ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Digite para buscar fornecedores cadastrados.
                </p>
              ) : null}
              {results.map((supplier) => (
                <button
                  key={financeSupplierSearchOptionKey(supplier)}
                  type="button"
                  data-testid="material-market-quote-supplier-option"
                  className="block w-full border-b border-border px-3 py-2 text-left hover:bg-muted/50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyRegisteredSupplier(supplier)}
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
                  <p className="text-xs text-muted-foreground">
                    {formatFinanceSupplierSearchMeta(supplier)}
                  </p>
                </button>
              ))}
              {showFreeTextOption ? (
                <button
                  type="button"
                  data-testid="material-market-quote-supplier-free-text-option"
                  className="block w-full px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-muted/50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyFreeTextSupplier(trimmedQuery)}
                >
                  Usar &quot;{trimmedQuery}&quot; como fornecedor não cadastrado
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
