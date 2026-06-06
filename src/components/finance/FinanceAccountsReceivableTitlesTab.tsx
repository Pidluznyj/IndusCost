import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { FinanceArTitlesPayload } from "@/src/lib/financeAccountsReceivableTitles.js";
import {
  buildFinanceArTitlesQuery,
  type FinanceArUiFilters,
} from "@/src/lib/financeAccountsReceivableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  formatNomusStatusLabel,
  StatusBadge,
  TabEmpty,
  TabLoading,
} from "@/src/components/finance/FinanceAccountsReceivableTabPanels";

export function FinanceArTitlesTab({
  filters,
}: {
  filters: FinanceArUiFilters;
}) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"dueDate" | "balanceReceivable" | "externalId">("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [data, setData] = useState<FinanceArTitlesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [filters, debouncedSearch, overdueOnly, sortBy, sortDirection]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildFinanceArTitlesQuery(filters, {
        page,
        limit: 50,
        sortBy,
        sortDirection,
        search: debouncedSearch,
        overdueOnly,
      });
      const payload = await fetchJsonOk<FinanceArTitlesPayload>(
        `/api/finance/accounts-receivable/titles?${qs}`
      );
      setData(payload);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Erro ao carregar títulos.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, sortBy, sortDirection, debouncedSearch, overdueOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <TabLoading label="títulos" />;
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
    );
  }
  if (!data?.items.length && !loading) {
    return <TabEmpty message="Nenhum título encontrado com os filtros atuais." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <label className="space-y-1 flex-1 min-w-[200px]">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Busca</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cliente, CNPJ, NF ou ID Nomus"
            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Ordenar</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="dueDate">Vencimento</option>
            <option value="balanceReceivable">Saldo</option>
            <option value="externalId">ID Nomus</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Direção</span>
          <select
            value={sortDirection}
            onChange={(e) => setSortDirection(e.target.value as typeof sortDirection)}
            className="h-9 rounded-lg border border-border bg-background px-2.5 text-sm"
          >
            <option value="asc">Asc</option>
            <option value="desc">Desc</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 h-9 text-sm">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Só atrasados
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card/60">
        <table className="w-full text-sm min-w-[1200px]">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-[10px] font-bold uppercase text-muted-foreground">
              <th className="p-2">ID Nomus</th>
              <th className="p-2">Empresa</th>
              <th className="p-2">Cliente</th>
              <th className="p-2">CNPJ</th>
              <th className="p-2">Descrição</th>
              <th className="p-2">NF origem</th>
              <th className="p-2">Vencimento</th>
              <th className="p-2">Data baixa</th>
              <th className="p-2 text-right">Original</th>
              <th className="p-2 text-right">Recebido</th>
              <th className="p-2 text-right">Saldo</th>
              <th className="p-2">Forma pag.</th>
              <th className="p-2">Conta</th>
              <th className="p-2">Status calc.</th>
              <th className="p-2">Status Nomus</th>
              <th className="p-2 text-right">Dias</th>
              <th className="p-2">Suspensa</th>
              <th className="p-2">Sync</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((row) => (
              <tr key={row.externalId} className="border-b border-border/60 hover:bg-muted/20">
                <td className="p-2 font-mono text-xs">{row.externalId}</td>
                <td className="p-2">{displayFinanceText(row.companyName)}</td>
                <td className="p-2">{displayFinanceText(row.personName)}</td>
                <td className="p-2 font-mono text-xs">{displayFinanceText(row.personCnpj)}</td>
                <td className="p-2 max-w-[180px] truncate" title={row.description ?? undefined}>
                  {displayFinanceText(row.description)}
                </td>
                <td className="p-2 font-mono text-xs">
                  {displayFinanceText(
                    row.sourceInvoiceNumber ??
                      (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null)
                  )}
                </td>
                <td className="p-2">{formatFinanceDate(row.dueDate)}</td>
                <td className="p-2">{formatFinanceDate(row.settlementDate)}</td>
                <td className="p-2 text-right tabular-nums">{formatFinanceCurrency(row.amountReceivable)}</td>
                <td className="p-2 text-right tabular-nums">{formatFinanceCurrency(row.amountReceived)}</td>
                <td className="p-2 text-right tabular-nums font-semibold">
                  {formatFinanceCurrency(row.balanceReceivable)}
                </td>
                <td className="p-2">{displayFinanceText(row.paymentMethodName)}</td>
                <td className="p-2">{displayFinanceText(row.bankAccountName)}</td>
                <td className="p-2">
                  <StatusBadge status={row.calculatedStatus} />
                </td>
                <td className="p-2 text-xs">{formatNomusStatusLabel(row.nomusStatus)}</td>
                <td className="p-2 text-right">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
                <td className="p-2">{row.suspendCollection ? "Sim" : "Não"}</td>
                <td className="p-2 text-xs whitespace-nowrap">{formatFinanceDateTime(row.syncedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted-foreground">
            {formatFinanceInteger(data.total)} títulos · página {data.page} de {data.totalPages}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={data.page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" /> Anterior
            </button>
            <button
              type="button"
              disabled={data.page >= data.totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs disabled:opacity-50"
            >
              Próxima <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
        </div>
      ) : null}
    </div>
  );
}
