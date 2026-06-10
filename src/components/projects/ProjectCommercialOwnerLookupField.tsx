import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import type { ProjectCommercialOwnerLookupItem } from "@/src/lib/projectsCommercialOwnerLookup";

export type ProjectCommercialOwnerSelection =
  | { mode: "existing"; item: ProjectCommercialOwnerLookupItem }
  | { mode: "manual"; name: string }
  | null;

type Props = {
  value: ProjectCommercialOwnerSelection;
  onChange: (value: ProjectCommercialOwnerSelection) => void;
  onDraftChange?: (draft: string) => void;
  disabled?: boolean;
};

export function ProjectCommercialOwnerLookupField({
  value,
  onChange,
  onDraftChange,
  disabled,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<ProjectCommercialOwnerLookupItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    if (!value) {
      setQuery("");
      return;
    }
    setQuery(value.mode === "existing" ? value.item.name : value.name);
  }, [value]);

  const runSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (q.length < 2) {
      setRows([]);
      setSearchError(null);
      return;
    }
    setLoading(true);
    setSearchError(null);
    try {
      const res = await fetchJsonOk<{ rows: ProjectCommercialOwnerLookupItem[] }>(
        `/api/projects/lookup/commercial-owners?query=${encodeURIComponent(q)}`
      );
      setRows(res.rows ?? []);
    } catch (e) {
      setRows([]);
      setSearchError(e instanceof Error ? e.message : "Erro ao buscar comerciais.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void runSearch(query), 280);
    return () => window.clearTimeout(timer);
  }, [query, open, runSearch]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const trimmed = query.trim();
  const badge =
    value?.mode === "existing" ? (
      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800">Comercial existente</span>
    ) : value?.mode === "manual" ? (
      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
        Nome manual para simulação
      </span>
    ) : null;

  return (
    <div ref={rootRef} className="space-y-1">
      <label htmlFor={`${listId}-input`} className="text-sm font-medium">
        Responsável comercial
      </label>
      <div className="relative">
        <input
          id={`${listId}-input`}
          disabled={disabled}
          autoComplete="off"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 pr-9 text-sm"
          placeholder="Buscar comercial existente ou digitar nome"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const next = e.target.value;
            setQuery(next);
            onDraftChange?.(next);
            setOpen(true);
            if (value) onChange(null);
          }}
          onBlur={() => {
            if (!value && trimmed) onChange({ mode: "manual", name: trimmed });
          }}
          aria-expanded={open}
          aria-controls={listId}
        />
        {value ? (
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
            onClick={() => {
              onChange(null);
              setQuery("");
              setRows([]);
              setOpen(true);
            }}
            aria-label="Limpar responsável comercial"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
        {open && !disabled ? (
          <div
            id={listId}
            className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg"
          >
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Buscando comerciais...
              </div>
            ) : null}
            {!loading && searchError ? (
              <p className="px-3 py-3 text-sm text-destructive">{searchError}</p>
            ) : null}
            {!loading && !searchError && trimmed.length >= 2 && rows.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum comercial encontrado.</p>
            ) : null}
            {!loading
              ? rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className="flex w-full flex-col items-start gap-0.5 border-b border-border/50 px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => {
                      onChange({ mode: "existing", item: row });
                      setQuery(row.name);
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium">{row.name}</span>
                    {row.email ? (
                      <span className="text-xs text-muted-foreground">{row.email}</span>
                    ) : null}
                  </button>
                ))
              : null}
            {trimmed.length > 0 && !loading ? (
              <button
                type="button"
                className={cn(
                  "w-full px-3 py-2 text-left text-sm hover:bg-muted/50",
                  rows.length ? "border-t border-border" : ""
                )}
                onClick={() => {
                  onChange({ mode: "manual", name: trimmed });
                  setOpen(false);
                }}
              >
                Usar &quot;{trimmed}&quot; como nome manual para simulação
              </button>
            ) : null}
            {trimmed.length > 0 && trimmed.length < 2 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Digite ao menos 2 caracteres para buscar.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {badge ? <div className="pt-1">{badge}</div> : null}
    </div>
  );
}

export function projectCommercialOwnerSelectionToPayload(
  selection: ProjectCommercialOwnerSelection
): { commercialOwner: string } | null {
  if (!selection) return null;
  if (selection.mode === "existing") {
    return { commercialOwner: selection.item.name.trim() };
  }
  return { commercialOwner: selection.name.trim() };
}
