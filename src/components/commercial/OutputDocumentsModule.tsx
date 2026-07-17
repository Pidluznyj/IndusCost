import { useEffect, useState, type ReactNode } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  fetchOutputDocumentsList,
  fetchOutputDocumentsSummary,
} from "@/src/lib/outputDocumentsClient";
import {
  canViewOutputDocuments,
  classifyOutputDocumentsListError,
  hasActiveOutputDocumentsFilters,
  isOutputDocumentsDateRangeInvalid,
  OUTPUT_DOCUMENTS_BREADCRUMB,
} from "@/src/lib/outputDocumentsUi";
import type { OutputDocumentsListSummary } from "@/src/lib/output-documents/outputDocumentsListTypes";
import { cn } from "@/src/lib/utils";

const SEARCH_DEBOUNCE_MS = 300;
const FILTER_CONTROL_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-2 focus:ring-primary/20";

const EMPTY_SUMMARY: OutputDocumentsListSummary = {
  documentCount: 0,
  validTotalValue: 0,
  withNfe: 0,
  withReceivable: 0,
  awaitingReceivable: 0,
  cancelled: 0,
};

export function OutputDocumentsModule() {
  const auth = useAuth();
  const permissions = usePermissions();
  const canView = canViewOutputDocuments({
    canPerformAction: permissions.canPerformAction,
    hasPermission: auth.hasPermission,
  });

  const [searchDraft, setSearchDraft] = useState("");
  const [companyDraft, setCompanyDraft] = useState("");
  const [customerDraft, setCustomerDraft] = useState("");
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState("");
  const [customer, setCustomer] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] =
    useState<OutputDocumentsListSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [errorKind, setErrorKind] = useState<
    "access_denied" | "api_unavailable" | "generic" | null
  >(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setCompany(companyDraft.trim());
      setCustomer(customerDraft.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft, companyDraft, customerDraft]);

  const dateRangeInvalid = isOutputDocumentsDateRangeInvalid(from, to);

  useEffect(() => {
    if (!canView || dateRangeInvalid) return;
    const controller = new AbortController();
    const query = {
      page: 1,
      pageSize: 1,
      search,
      company,
      customer,
      from,
      to,
    };
    setLoading(true);
    setErrorKind(null);
    setErrorMessage(null);

    void Promise.all([
      fetchOutputDocumentsSummary(query, controller.signal),
      fetchOutputDocumentsList(query, controller.signal),
    ])
      .then(([summaryPayload]) => {
        if (controller.signal.aborted) return;
        setSummary(summaryPayload.summary);
        setHasLoadedOnce(true);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const classified = classifyOutputDocumentsListError(error);
        setErrorKind(classified.kind);
        setErrorMessage(classified.message);
        setSummary(EMPTY_SUMMARY);
        setHasLoadedOnce(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [
    canView,
    dateRangeInvalid,
    search,
    company,
    customer,
    from,
    to,
    retryToken,
  ]);

  if (!canView) {
    return (
      <div
        className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground"
        data-testid="output-documents-denied"
      >
        Você não possui permissão para acessar Documentos de Saída.
      </div>
    );
  }

  const filtersActive = hasActiveOutputDocumentsFilters({
    search,
    company,
    customer,
    from,
    to,
  });
  const draftsActive = Boolean(
    searchDraft.trim() ||
      companyDraft.trim() ||
      customerDraft.trim() ||
      from ||
      to
  );
  const initialLoading = loading && !hasLoadedOnce;
  const empty = hasLoadedOnce && !loading && !errorMessage && summary.documentCount === 0;

  const clearFilters = () => {
    setSearchDraft("");
    setCompanyDraft("");
    setCustomerDraft("");
    setSearch("");
    setCompany("");
    setCustomer("");
    setFrom("");
    setTo("");
  };

  return (
    <div className="space-y-4" data-testid="output-documents-module">
      <p
        className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
        data-testid="output-documents-breadcrumb"
      >
        {OUTPUT_DOCUMENTS_BREADCRUMB}
      </p>

      <section
        className="rounded-xl border border-border bg-card p-3"
        data-testid="output-documents-filters"
        aria-label="Filtros de Documentos de Saída"
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(16rem,1fr)_12rem_12rem_9.5rem_9.5rem_auto]">
          <FilterField label="Busca geral">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                className={cn(FILTER_CONTROL_CLASS, "pl-8")}
                data-testid="output-documents-search"
                placeholder="Documento, pedido, NF-e ou status…"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
              />
            </div>
          </FilterField>
          <FilterField label="Empresa">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-company"
              placeholder="Ex.: KOPPETEL"
              value={companyDraft}
              onChange={(event) => setCompanyDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="Cliente">
            <input
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-customer"
              placeholder="Nome do cliente"
              value={customerDraft}
              onChange={(event) => setCustomerDraft(event.target.value)}
            />
          </FilterField>
          <FilterField label="Documento de">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-from"
              aria-invalid={dateRangeInvalid}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </FilterField>
          <FilterField label="Documento até">
            <input
              type="date"
              className={FILTER_CONTROL_CLASS}
              data-testid="output-documents-to"
              aria-invalid={dateRangeInvalid}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </FilterField>
          <div className="flex items-end">
            <button
              type="button"
              className="w-full rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
              data-testid="output-documents-clear-filters"
              disabled={!draftsActive}
              onClick={clearFilters}
            >
              Limpar filtros
            </button>
          </div>
        </div>
        {dateRangeInvalid ? (
          <p className="mt-2 text-xs font-medium text-rose-700" role="alert">
            A data inicial não pode ser posterior à data final.
          </p>
        ) : null}
      </section>

      <div
        className="flex flex-wrap gap-2"
        data-testid="output-documents-status-chips"
        aria-label="Resumo por situação"
      >
        <StatusChip label={`Todos (${summary.documentCount})`} />
        <StatusChip label={`Com NF-e (${summary.withNfe})`} />
        <StatusChip label={`Com CR (${summary.withReceivable})`} />
        <StatusChip label={`Aguardando CR (${summary.awaitingReceivable})`} />
        <StatusChip label={`Cancelados (${summary.cancelled})`} />
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className={cn(
            "rounded-xl border p-4 text-sm",
            errorKind === "api_unavailable"
              ? "border-amber-300/60 bg-amber-50 text-amber-950"
              : errorKind === "access_denied"
                ? "border-rose-300/60 bg-rose-50 text-rose-950"
                : "border-destructive/40 bg-destructive/5 text-destructive"
          )}
          data-testid={
            errorKind === "api_unavailable"
              ? "output-documents-api-unavailable"
              : errorKind === "access_denied"
                ? "output-documents-error-denied"
                : "output-documents-error"
          }
        >
          {errorMessage}
          <button
            type="button"
            className="ml-3 underline"
            onClick={() => setRetryToken((current) => current + 1)}
          >
            Tentar novamente
          </button>
        </div>
      ) : null}

      {!errorMessage ? (
        <section
          className="relative overflow-hidden rounded-xl border border-border bg-card"
          data-testid="output-documents-grid-shell"
          aria-busy={loading}
        >
          {initialLoading ? (
            <div
              className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground"
              data-testid="output-documents-loading"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Carregando Documentos de Saída…
            </div>
          ) : empty ? (
            <div
              className="p-10 text-center text-sm text-muted-foreground"
              data-testid={
                filtersActive
                  ? "output-documents-empty-filters"
                  : "output-documents-empty"
              }
            >
              {filtersActive
                ? "Nenhum resultado para os filtros aplicados."
                : "Nenhum Documento de Saída sincronizado ainda."}
            </div>
          ) : (
            <div
              className="flex flex-col items-center justify-center gap-3 p-10 text-center"
              data-testid="output-documents-ready"
            >
              <span className="rounded-full bg-primary/10 p-3 text-primary">
                <FileText className="h-6 w-6" aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-foreground">
                  {summary.documentCount}{" "}
                  {summary.documentCount === 1
                    ? "documento disponível"
                    : "documentos disponíveis"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  A grade detalhada será adicionada na próxima etapa.
                </p>
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="space-y-1 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function StatusChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground">
      {label}
    </span>
  );
}
