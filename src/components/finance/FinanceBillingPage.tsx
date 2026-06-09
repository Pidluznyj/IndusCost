import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Filter, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { ExecutiveBillingTab } from "@/src/components/dashboard/ExecutiveBillingTab";
import {
  buildFinanceBillingDashboardQuery,
  buildFinanceBillingYearOptions,
  createDefaultFinanceBillingYear,
  hasPendingFinanceBillingYearChange,
  type FinanceBillingDashboardPayload,
} from "@/src/lib/financeBillingDashboardTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsPayableFormat";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";

export function FinanceBillingPage() {
  const [draftYear, setDraftYear] = useState(() => createDefaultFinanceBillingYear());
  const [appliedYear, setAppliedYear] = useState(() => createDefaultFinanceBillingYear());
  const abortRef = useRef<AbortController | null>(null);

  const yearOptions = useMemo(() => buildFinanceBillingYearOptions(), []);
  const hasPendingFilterChanges = useMemo(
    () => hasPendingFinanceBillingYearChange(draftYear, appliedYear),
    [draftYear, appliedYear]
  );

  const queryString = useMemo(
    () => buildFinanceBillingDashboardQuery(appliedYear),
    [appliedYear]
  );

  const [data, setData] = useState<FinanceBillingDashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const url = queryString
        ? `/api/finance/billing/dashboard?${queryString}`
        : "/api/finance/billing/dashboard";
      const payload = await fetchJsonOk<FinanceBillingDashboardPayload>(url, {
        signal: controller.signal,
        credentials: "include",
      });
      if (controller.signal.aborted) return;
      setData(payload);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("FinanceBillingPage.loadDashboard", e);
      setError("Não foi possível carregar o faturamento. Tente novamente.");
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [queryString]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const handleApplyFilters = () => {
    setAppliedYear(draftYear.trim());
  };

  const handleClearFilters = () => {
    const defaultYear = createDefaultFinanceBillingYear();
    setDraftYear(defaultYear);
    setAppliedYear(defaultYear);
  };

  const comparisonLabel = data
    ? `${data.selectedYear} × ${data.previousYear}`
    : `${appliedYear} × ${Number.parseInt(appliedYear, 10) - 1}`;

  return (
    <div className="space-y-5 pb-8">
      <header className="rounded-xl border border-border bg-gradient-to-br from-card/80 to-card/40 p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Financeiro · Mercado
            </p>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">Faturamento</h3>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Faturamento de mercado com base em NF processada no Nomus. Exclui clientes do grupo.
            </p>
            <dl className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground pt-1">
              <div>
                <dt className="inline">Comparativo: </dt>
                <dd className="inline font-semibold text-foreground">{comparisonLabel}</dd>
              </div>
              <div>
                <dt className="inline">Período de referência: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data?.periodLabel ?? (loading ? "…" : "—")}
                </dd>
              </div>
              <div>
                <dt className="inline">Último faturamento: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data?.lastInvoicedAt
                    ? formatFinanceDateTime(data.lastInvoicedAt)
                    : loading
                      ? "…"
                      : "—"}
                </dd>
              </div>
              <div>
                <dt className="inline">Dados atualizados em: </dt>
                <dd className="inline font-semibold text-foreground">
                  {data ? formatFinanceDateTime(data.generatedAt) : loading ? "…" : "—"}
                </dd>
              </div>
            </dl>
            <p className="text-[11px] text-muted-foreground">
              Data de faturamento considerada: processamento da NF no Nomus. Valor: pedido líquido
              faturado; não confundir com carteira de pedidos em aberto.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadDashboard()}
              disabled={loading}
              aria-busy={loading}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Atualizar painel
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <FinanceApErrorBanner
          message={error}
          onRetry={() => void loadDashboard()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <section className="rounded-xl border border-border bg-card/40 p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Filtros globais
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ano selecionado: {appliedYear}. Comparativo sempre com o ano anterior ({comparisonLabel}
              ).
            </p>
            {hasPendingFilterChanges ? (
              <p className="text-[11px] text-amber-800 font-semibold mt-0.5">
                Há alterações nos filtros ainda não aplicadas.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={!hasPendingFilterChanges || loading}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <Filter className="h-3.5 w-3.5" />
              Aplicar filtros
            </button>
            <button
              type="button"
              onClick={handleClearFilters}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Limpar filtros
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border/60 bg-background/30 p-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Período analisado
            </p>
            <label className="space-y-1 block min-w-0">
              <span className="text-[10px] font-bold uppercase text-muted-foreground">Ano</span>
              <select
                value={draftYear}
                onChange={(e) => setDraftYear(e.target.value)}
                className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
              >
                {yearOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {loading && !data ? <FinanceApLoadingBlock label="faturamento" /> : null}

      {!loading && !error && data?.tab ? (
        <ExecutiveBillingTab tab={data.tab} />
      ) : null}

      {!loading && !error && data && !data.tab.available ? (
        <div className="rounded-xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
          Sem dados de faturamento para o ano selecionado.
        </div>
      ) : null}
    </div>
  );
}
