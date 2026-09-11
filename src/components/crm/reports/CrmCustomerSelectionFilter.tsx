import React, { useEffect, useId, useRef, useState } from "react";
import { EyeOff, Loader2, Search, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  describeCrmReportsError,
  isCrmReportsAbortError,
  searchCrmReportsCustomerOptions,
} from "@/src/lib/commercial/crmReportsClient";
import { formatCrmReportsCustomerSublabel, formatCrmReportsInteger } from "@/src/lib/commercial/crmReportsFormat";
import {
  addCrmReportsSelectionCustomer,
  crmReportsChipFromOption,
  removeCrmReportsSelectionCustomer,
  type CrmReportsCustomerChip,
  type CrmReportsUiSelection,
} from "@/src/lib/commercial/crmReportsUiState";
import {
  CRM_REPORTS_CUSTOMER_SEARCH_MIN_CHARS,
  type CrmReportsCustomerOption,
  type CrmReportsCustomerSelectionMode,
  type CrmReportsSelectionInfo,
} from "@/src/lib/commercial/crmReportsTypes";

/** Espera após a última tecla antes de consultar o backend. */
export const CRM_CUSTOMER_PICKER_DEBOUNCE_MS = 300;

type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; options: CrmReportsCustomerOption[]; hasMore: boolean }
  | { status: "error"; message: string };

export type CrmCustomerPickerProps = {
  label: string;
  placeholder: string;
  chips: readonly CrmReportsCustomerChip[];
  onAdd: (chip: CrmReportsCustomerChip) => void;
  onRemove: (id: string) => void;
  onClear?: () => void;
  chipTone?: "neutral" | "exclude";
  disabled?: boolean;
  /** Injeção para testes; padrão = endpoint escopado `customer-options`. */
  search?: typeof searchCrmReportsCustomerOptions;
};

/**
 * Busca de clientes do ESCOPO do usuário (nome, fantasia, CNPJ) com debounce
 * e cancelamento do pedido obsoleto. Nunca baixa a base de clientes.
 */
export function CrmCustomerPicker({
  label,
  placeholder,
  chips,
  onAdd,
  onRemove,
  onClear,
  chipTone = "neutral",
  disabled,
  search = searchCrmReportsCustomerOptions,
}: CrmCustomerPickerProps) {
  const inputId = useId();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const blurTimer = useRef<number | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.length < CRM_REPORTS_CUSTOMER_SEARCH_MIN_CHARS) {
      setState({ status: "idle" });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setState({ status: "loading" });
      search(term, controller.signal)
        .then((res) => {
          if (!controller.signal.aborted) setState({ status: "ready", options: res.options, hasMore: res.hasMore });
        })
        .catch((error) => {
          if (isCrmReportsAbortError(error) || controller.signal.aborted) return;
          setState({ status: "error", message: describeCrmReportsError(error, "Não foi possível buscar clientes.") });
        });
    }, CRM_CUSTOMER_PICKER_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, search]);

  useEffect(
    () => () => {
      if (blurTimer.current != null) window.clearTimeout(blurTimer.current);
    },
    []
  );

  const chosen = new Set(chips.map((c) => c.id));
  const options = state.status === "ready" ? state.options.filter((o) => !chosen.has(o.id)) : [];
  const term = query.trim();

  const pick = (option: CrmReportsCustomerOption) => {
    onAdd(crmReportsChipFromOption(option));
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-xs font-semibold text-foreground">
        {label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={open && term.length >= CRM_REPORTS_CUSTOMER_SEARCH_MIN_CHARS}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = window.setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter") {
              e.preventDefault();
              if (options[0]) pick(options[0]);
            }
          }}
          className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
        />
        {open && term.length > 0 ? (
          <div
            id={listId}
            role="listbox"
            className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-lg"
          >
            {term.length < CRM_REPORTS_CUSTOMER_SEARCH_MIN_CHARS ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Digite ao menos {CRM_REPORTS_CUSTOMER_SEARCH_MIN_CHARS} caracteres (nome, fantasia ou CNPJ).
              </p>
            ) : state.status === "loading" || state.status === "idle" ? (
              <p className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Buscando…
              </p>
            ) : state.status === "error" ? (
              <p className="px-3 py-2 text-xs text-red-700">{state.message}</p>
            ) : options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum cliente encontrado no seu universo.</p>
            ) : (
              <>
                {options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(option)}
                    className="block w-full rounded-lg px-3 py-2 text-left hover:bg-accent"
                  >
                    <span className="block text-sm font-semibold text-foreground">{option.displayName}</span>
                    {option.tradeName && option.tradeName !== option.displayName ? (
                      <span className="block text-xs text-muted-foreground">{option.tradeName}</span>
                    ) : null}
                    <span className="block text-[11px] tabular-nums text-muted-foreground">
                      {formatCrmReportsCustomerSublabel(option)}
                    </span>
                  </button>
                ))}
                {state.status === "ready" && state.hasMore ? (
                  <p className="px-3 py-2 text-[11px] text-muted-foreground">Há mais resultados — refine a busca.</p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip.id}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs font-semibold",
                chipTone === "exclude"
                  ? "border-red-200 bg-red-50 text-red-900"
                  : "border-primary/30 bg-primary/10 text-primary"
              )}
              title={chip.sublabel ?? undefined}
            >
              <span className="truncate">{chip.label}</span>
              <button
                type="button"
                onClick={() => onRemove(chip.id)}
                className="rounded-full p-0.5 hover:bg-black/10"
                aria-label={`Remover ${chip.label}`}
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          {onClear && chips.length > 1 ? (
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Limpar
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const MODE_LABELS: Record<CrmReportsCustomerSelectionMode, string> = {
  ALL: "Todos os clientes",
  EXCLUDE: "Excluir selecionados",
  ONLY: "Somente selecionados",
};

export type CrmCustomerSelectionFilterProps = {
  selection: CrmReportsUiSelection;
  /** Eco do backend (IDs fora do universo etc.) — pode faltar durante o carregamento. */
  selectionInfo: CrmReportsSelectionInfo | null;
  onChange: (selection: CrmReportsUiSelection) => void;
  disabled?: boolean;
  search?: typeof searchCrmReportsCustomerOptions;
};

/**
 * "Ocultar clientes": recorte ANALÍTICO do universo (EXCLUDE/ONLY) enviado ao
 * backend — cards, listas, personalizado e exportação mudam juntos. Não
 * altera cadastro nem carteira.
 */
export function CrmCustomerSelectionFilter({
  selection,
  selectionInfo,
  onChange,
  disabled,
  search,
}: CrmCustomerSelectionFilterProps) {
  const count = selection.customers.length;
  const status =
    count === 0
      ? selection.mode === "ALL"
        ? "Nenhum cliente oculto."
        : "Adicione clientes para aplicar este modo."
      : selection.mode === "EXCLUDE"
        ? `${formatCrmReportsInteger(count)} cliente(s) fora de cards, listas, relatório e exportação.`
        : selection.mode === "ONLY"
          ? `Analisando somente ${formatCrmReportsInteger(count)} cliente(s).`
          : `${formatCrmReportsInteger(count)} cliente(s) guardado(s) — escolha “Excluir” ou “Somente” para aplicar.`;

  return (
    <section
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
      aria-label="Ocultar clientes"
      data-testid="crm-reports-customer-selection"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-2">
          <span className="rounded-lg bg-muted p-1.5 text-muted-foreground">
            <EyeOff className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h3 className="text-sm font-bold text-foreground">Ocultar clientes</h3>
            <p className="text-xs text-muted-foreground">
              Recorte da análise — não altera cadastro nem carteira. Também dá para marcar linhas nas listas.
            </p>
          </div>
        </div>
        <div
          className="inline-flex shrink-0 flex-wrap rounded-xl border border-border bg-muted/40 p-1"
          role="radiogroup"
          aria-label="Modo de seleção de clientes"
        >
          {(Object.keys(MODE_LABELS) as CrmReportsCustomerSelectionMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={selection.mode === mode}
              disabled={disabled}
              onClick={() => onChange({ ...selection, mode })}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50",
                selection.mode === mode
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3 max-w-2xl">
        <CrmCustomerPicker
          label="Buscar cliente"
          placeholder="Nome, nome fantasia ou CNPJ"
          chips={selection.customers}
          chipTone={selection.mode === "ONLY" ? "neutral" : "exclude"}
          disabled={disabled}
          search={search}
          onAdd={(chip) => onChange(addCrmReportsSelectionCustomer(selection, chip))}
          onRemove={(id) => onChange(removeCrmReportsSelectionCustomer(selection, id))}
          onClear={() => onChange({ mode: selection.mode, customers: [] })}
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground" data-testid="crm-reports-selection-status">
        {status}
        {selectionInfo && selectionInfo.idsOutsideUniverse > 0
          ? ` ${formatCrmReportsInteger(selectionInfo.idsOutsideUniverse)} fora do universo filtrado (ignorado).`
          : ""}
      </p>
    </section>
  );
}
