import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { FinanceApTitlesPayload } from "@/src/lib/financeAccountsPayableTitles.js";
import {
  buildFinanceApTitlesQuery,
  type FinanceApDataQualityAlertKey,
  type FinanceApUiFilters,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceDaysOverdue,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsPayableFormat";
import {
  formatNomusStatusLabel,
  StatusBadge,
  TabEmpty,
} from "@/src/components/finance/FinanceAccountsPayableTabPanels";
import {
  FinanceApErrorBanner,
  FinanceApLoadingBlock,
  FinanceApScrollableTable,
  FinanceApStickyTableHead,
} from "@/src/components/finance/FinanceAccountsPayableUiShared";

export function FinanceApTitlesTab({
  filters,
  qualityAlert = null,
  onClearQualityAlert,
}: {
  filters: FinanceApUiFilters;
  qualityAlert?: FinanceApDataQualityAlertKey | null;
  onClearQualityAlert?: () => void;
}) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"dueDate" | "balancePayable" | "externalId">("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [data, setData] = useState<FinanceApTitlesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [filters, debouncedSearch, overdueOnly, sortBy, sortDirection, qualityAlert]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = buildFinanceApTitlesQuery(filters, {
        page,
        limit: 50,
        sortBy,
        sortDirection,
        search: debouncedSearch,
        overdueOnly,
        qualityAlert: qualityAlert ?? undefined,
      });
      const payload = await fetchJsonOk<FinanceApTitlesPayload>(
        `/api/finance/accounts-payable/titles?${qs}`
      );
      setData(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar títulos.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, sortBy, sortDirection, debouncedSearch, overdueOnly, qualityAlert]);

  useEffect(() => {
    void load();
  }, [load]);

  const initialLoad = loading && !data && !error;

  return (
    <div className="space-y-4">
      {qualityAlert ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <span>Filtro de alerta de qualidade ativo.</span>
          {onClearQualityAlert ? (
            <button
              type="button"
              onClick={onClearQualityAlert}
              className="font-semibold underline underline-offset-2"
            >
              Remover filtro
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 items-end">
        <label className="space-y-1 flex-1 min-w-[200px]">
          <span className="text-[10px] font-bold uppercase text-muted-foreground">Busca</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Fornecedor, CNPJ, NF ou ID Nomus"
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
            <option value="balancePayable">Saldo</option>
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
            <option value="asc">Ascendente</option>
            <option value="desc">Descendente</option>
          </select>
        </label>
        <label className="inline-flex items-center gap-2 h-9 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          Só atrasados
        </label>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Atualizar lista
        </button>
      </div>

      {error ? (
        <FinanceApErrorBanner message={error} onDismiss={() => setError(null)} />
      ) : null}

      {initialLoad ? <FinanceApLoadingBlock label="títulos" /> : null}

      {!initialLoad && !error && !data?.items.length && !loading ? (
        <TabEmpty message="Nenhum título encontrado com os filtros atuais." />
      ) : null}

      {data?.items.length ? (
        <>
          <FinanceApScrollableTable tableClassName="min-w-[1200px]">
            <FinanceApStickyTableHead>
              <tr className="text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="p-2 whitespace-nowrap">ID Nomus</th>
                <th className="p-2 min-w-[100px]">Empresa</th>
                <th className="p-2 min-w-[120px]">Fornecedor</th>
                <th className="p-2 whitespace-nowrap">CNPJ</th>
                <th className="p-2 min-w-[140px]">Descrição</th>
                <th className="p-2 whitespace-nowrap">NF emitida</th>
                <th className="p-2 whitespace-nowrap">NF origem</th>
                <th className="p-2 whitespace-nowrap">Vencimento</th>
                <th className="p-2 whitespace-nowrap">Baixa/Pagamento</th>
                <th className="p-2 text-right whitespace-nowrap">Valor original</th>
                <th className="p-2 text-right whitespace-nowrap">Pago</th>
                <th className="p-2 text-right whitespace-nowrap">Saldo</th>
                <th className="p-2">Forma pag.</th>
                <th className="p-2">Conta</th>
                <th className="p-2">Status calc.</th>
                <th className="p-2">Status Nomus</th>
                <th className="p-2 text-right">Dias</th>
                <th className="p-2">Suspensa</th>
                <th className="p-2 whitespace-nowrap">Sync</th>
              </tr>
            </FinanceApStickyTableHead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.externalId} className="border-b border-border/60 hover:bg-muted/20">
                  <td className="p-2 font-mono text-xs">{row.externalId}</td>
                  <td className="p-2">{displayFinanceText(row.companyName)}</td>
                  <td className="p-2">{displayFinanceText(row.personName)}</td>
                  <td className="p-2 font-mono text-xs">{displayFinanceText(row.personCnpj)}</td>
                  <td className="p-2 max-w-[180px] truncate" title={row.description ?? undefined}>
                    {displayFinanceText(row.description)}
                  </td>
                  <td className="p-2 text-xs font-semibold">
                    {row.sourceInvoiceId != null || row.documentNumber?.trim()
                      ? "Sim"
                      : "Não"}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    {displayFinanceText(
                      row.documentNumber ??
                        (row.sourceInvoiceId != null ? String(row.sourceInvoiceId) : null)
                    )}
                  </td>
                  <td className="p-2 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {formatFinanceDate(row.paymentDate ?? row.settlementDate)}
                  </td>
                  <td className="p-2 text-right tabular-nums">{formatFinanceCurrency(row.amountPayable)}</td>
                  <td className="p-2 text-right tabular-nums">{formatFinanceCurrency(row.amountPaid)}</td>
                  <td className="p-2 text-right tabular-nums font-semibold">
                    {formatFinanceCurrency(row.balancePayable)}
                  </td>
                  <td className="p-2">{displayFinanceText(row.paymentMethodName)}</td>
                  <td className="p-2">{displayFinanceText(row.bankAccountName)}</td>
                  <td className="p-2">
                    <StatusBadge status={row.calculatedStatus} />
                  </td>
                  <td className="p-2 text-xs">{formatNomusStatusLabel(row.nomusStatus)}</td>
                  <td className="p-2 text-right tabular-nums">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
                  <td className="p-2">{row.suspendPayment ? "Sim" : "Não"}</td>
                  <td className="p-2 text-xs whitespace-nowrap">{formatFinanceDateTime(row.syncedAt)}</td>
                </tr>
              ))}
            </tbody>
          </FinanceApScrollableTable>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground tabular-nums">
              {formatFinanceInteger(data.total)} títulos · página {data.page} de {data.totalPages}
              {loading ? " · atualizando…" : ""}
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
          </div>
        </>
      ) : null}
    </div>
  );
}
