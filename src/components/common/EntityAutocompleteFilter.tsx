import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";

export type EntityAutocompleteEntityType =
  | "customer"
  | "supplier"
  | "person"
  | "product"
  | "seller";

export type EntityAutocompleteSelection = {
  id?: string;
  code?: string | null;
  name: string;
  tradeName?: string | null;
  taxId?: string | null;
  city?: string | null;
  state?: string | null;
  source: "nomus" | "induscost";
};

export type EntityAutocompleteItem = {
  id: string;
  primaryLabel: string;
  secondaryLabel: string;
  selection: EntityAutocompleteSelection;
};

export type EntityAutocompleteFilterProps = {
  label: string;
  placeholder?: string;
  value: EntityAutocompleteSelection | null;
  displayValue?: string;
  entityType: EntityAutocompleteEntityType;
  onChange: (selection: EntityAutocompleteSelection | null) => void;
  onClear?: () => void;
  disabled?: boolean;
  compact?: boolean;
  minChars?: number;
  debounceMs?: number;
  allowFreeText?: boolean;
  fetchItems: (query: string, signal: AbortSignal) => Promise<EntityAutocompleteItem[]>;
  className?: string;
  htmlFor?: string;
};

function selectionTitle(selection: EntityAutocompleteSelection): string | undefined {
  const parts = [selection.name];
  if (selection.taxId) parts.push(selection.taxId);
  if (selection.city || selection.state) {
    parts.push([selection.city, selection.state].filter(Boolean).join("/"));
  }
  return parts.join(" · ");
}

export function EntityAutocompleteFilter({
  label,
  placeholder = "Digite para buscar…",
  value,
  displayValue,
  onChange,
  onClear,
  disabled = false,
  compact = false,
  minChars = 2,
  debounceMs = 300,
  allowFreeText = false,
  fetchItems,
  className,
  htmlFor,
}: EntityAutocompleteFilterProps) {
  const autoId = useId();
  const inputId = htmlFor ?? `${autoId}-input`;
  const listId = `${autoId}-list`;
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<EntityAutocompleteItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!value) {
      setQuery("");
      return;
    }
    setQuery(displayValue ?? value.name);
  }, [value, displayValue]);

  const runSearch = useCallback(
    async (term: string, signal: AbortSignal) => {
      const q = term.trim();
      if (q.length < minChars) {
        setRows([]);
        setSearchError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setSearchError(null);
      try {
        const items = await fetchItems(q, signal);
        if (!signal.aborted) setRows(items);
      } catch (e) {
        if (signal.aborted) return;
        setRows([]);
        setSearchError(e instanceof Error ? e.message : "Erro ao buscar.");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [fetchItems, minChars]
  );

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      void runSearch(query, ac.signal);
    }, debounceMs);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
  }, [query, open, debounceMs, runSearch]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const trimmed = query.trim();
  const showMinCharsHint = open && trimmed.length > 0 && trimmed.length < minChars;
  const inputTitle = value ? selectionTitle(value) : undefined;

  const clearSelection = () => {
    onChange(null);
    onClear?.();
    setQuery("");
    setRows([]);
    setOpen(true);
    setActiveIndex(-1);
  };

  const selectItem = (item: EntityAutocompleteItem) => {
    onChange(item.selection);
    setQuery(item.selection.name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const applyFreeText = () => {
    if (!allowFreeText || !trimmed) return;
    onChange({
      name: trimmed,
      source: "induscost",
    });
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || rows.length === 0) {
      if (e.key === "Enter" && allowFreeText && trimmed) applyFreeText();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      const item = rows[activeIndex];
      if (item) selectItem(item);
    }
  };

  return (
    <label className={cn("space-y-1 block min-w-0", className)} htmlFor={inputId}>
      <span
        className={cn(
          "font-bold uppercase text-muted-foreground",
          compact ? "text-[10px]" : "text-[11px] tracking-wide"
        )}
      >
        {label}
      </span>
      <div ref={rootRef} className="relative">
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          disabled={disabled}
          placeholder={placeholder}
          title={inputTitle}
          value={query}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          role="combobox"
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            setOpen(true);
            setActiveIndex(-1);
            if (value) onChange(null);
          }}
          className={cn(
            "w-full rounded-lg border border-border bg-background px-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30",
            compact ? "h-8" : "h-9 rounded-xl"
          )}
        />
        {value ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={clearSelection}
            aria-label={`Limpar ${label.toLowerCase()}`}
            tabIndex={-1}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {open && !disabled ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg"
          >
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Buscando…
              </div>
            ) : null}
            {!loading && searchError ? (
              <p className="px-3 py-3 text-sm text-destructive">Erro ao buscar clientes</p>
            ) : null}
            {showMinCharsHint ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Digite ao menos {minChars} caracteres
              </p>
            ) : null}
            {!loading &&
              !searchError &&
              trimmed.length >= minChars &&
              rows.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum resultado encontrado</p>
              )}
            {!loading
              ? rows.map((row, index) => (
                  <button
                    key={row.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left text-sm hover:bg-muted/50",
                      index === activeIndex && "bg-muted/60"
                    )}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectItem(row)}
                  >
                    <span className="font-medium leading-snug">{row.primaryLabel}</span>
                    <span className="text-xs text-muted-foreground">{row.secondaryLabel}</span>
                  </button>
                ))
              : null}
            {allowFreeText && trimmed.length >= minChars && !loading && !value ? (
              <button
                type="button"
                className="w-full border-t border-border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted/50"
                onClick={applyFreeText}
              >
                Usar &quot;{trimmed}&quot; como texto livre
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </label>
  );
}
