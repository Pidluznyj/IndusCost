import React, { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceApTitlesPayload } from "@/src/lib/financeAccountsPayableTitles.js";
import {
  buildFinanceApTitlesQuery,
  type FinanceApDataQualityAlertKey,
  type FinanceApUiFilters,
} from "@/src/lib/financeAccountsPayableDashboardTypes";
import {
  FINANCE_AP_TITLES_LOCAL_FILTER_OPTIONS,
  parseFinanceApTitlesLocalFilter,
  type FinanceApTitlesLocalFilter,
} from "@/src/lib/financeAccountsPayableTitlesLocalFilter";
import { cn } from "@/src/lib/utils";
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
import { FinanceApTitleClassificationSheet } from "@/src/components/finance/FinanceApTitleClassificationSheet";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { canManageFinanceApAllocations } from "@/src/lib/financeAccountsPayablePermissions";
import {
  FINANCE_AP_NO_CLASSIFICATION,
  FINANCE_AP_UNIDENTIFIED_SUPPLIER,
} from "@/src/lib/financeAccountsPayableCostCenterShared";

export function FinanceApTitlesTab({
  filters,
  qualityAlert = null,
  onClearQualityAlert,
  localFilter,
  onLocalFilterChange,
  canManageAllocations,
}: {
  filters: FinanceApUiFilters;
  qualityAlert?: FinanceApDataQualityAlertKey | null;
  onClearQualityAlert?: () => void;
  localFilter: FinanceApTitlesLocalFilter;
  onLocalFilterChange: (value: FinanceApTitlesLocalFilter) => void;
  canManageAllocations?: boolean;
}) {
  const auth = useAuth();
  const permissions = usePermissions();
  const canEditClassification =
    canManageAllocations ??
    (canManageFinanceApAllocations(auth) ||
      permissions.canPerformAction("finance.accounts_payable", "manage"));
  const [selectedExternalId, setSelectedExternalId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<"dueDate" | "balancePayable" | "externalId">("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<FinanceApTitlesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 400);
    return () => window.clearTimeout(id);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [filters, debouncedSearch, localFilter, sortBy, sortDirection, qualityAlert]);

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
        localFilter,
        qualityAlert: qualityAlert ?? undefined,
      });
      const payload = await fetchJsonOk<FinanceApTitlesPayload>(
        `/api/finance/accounts-payable/titles?${qs}`
      );
      setData(payload);
    } catch (e) {
      console.error("FinanceApTitlesTab.load", e);
      setError(
        buildFinanceTabLoadError(
          "Não foi possível carregar os títulos de Contas a Pagar. Tente novamente.",
          e
        )
      );
    } finally {
      setLoading(false);
    }
  }, [filters, page, sortBy, sortDirection, debouncedSearch, localFilter, qualityAlert]);

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

      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase text-muted-foreground">Filtros locais</p>
        <p className="text-[10px] text-muted-foreground">
          Refinam o grid sem alterar filtros globais aplicados.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FINANCE_AP_TITLES_LOCAL_FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onLocalFilterChange(parseFinanceApTitlesLocalFilter(opt.value))}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors",
                localFilter === opt.value
                  ? "bg-primary text-primary-foreground"
                  : "border border-[#E5E7EB] bg-white text-muted-foreground hover:bg-muted/50"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

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
        <FinanceApErrorBanner
          message={error}
          onRetry={() => void load()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {initialLoad ? <FinanceApLoadingBlock label="títulos" /> : null}

      {!initialLoad && !error && !data?.items.length && !loading ? (
        <TabEmpty message="Nenhum título encontrado com os filtros atuais." />
      ) : null}

      {data?.items.length ? (
        <>
          <FinanceApScrollableTable tableClassName="min-w-[1680px]">
            <FinanceApStickyTableHead>
              <tr className="text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="p-2 whitespace-nowrap">ID Nomus</th>
                <th className="p-2 min-w-[100px]">Empresa</th>
                <th className="p-2 min-w-[120px]">Fornecedor</th>
                <th className="p-2 min-w-[120px]">Fornec. consolidado</th>
                <th className="p-2 min-w-[120px]">Centro de custo</th>
                <th className="p-2 whitespace-nowrap">Origem classif.</th>
                <th className="p-2 whitespace-nowrap">Status classif.</th>
                <th className="p-2 whitespace-nowrap">CNPJ</th>
                <th className="p-2 min-w-[140px]">Descrição</th>
                <th className="p-2 whitespace-nowrap">Venc. original</th>
                <th className="p-2 whitespace-nowrap">Agendamento</th>
                <th className="p-2 whitespace-nowrap">Data operacional</th>
                <th className="p-2 whitespace-nowrap">Baixa/Pagamento</th>
                <th className="p-2 text-right whitespace-nowrap">Valor original</th>
                <th className="p-2 text-right whitespace-nowrap">Pago</th>
                <th className="p-2 text-right whitespace-nowrap">Saldo</th>
                <th className="p-2">Forma pag.</th>
                <th className="p-2">Conta</th>
                <th className="p-2">Status calc.</th>
                <th className="p-2">Tipo</th>
                <th className="p-2 min-w-[140px]">Motivo exclusão</th>
                <th className="p-2 text-right">Dias</th>
                <th className="p-2 whitespace-nowrap">Sync</th>
              </tr>
            </FinanceApStickyTableHead>
            <tbody>
              {data.items.map((row) => (
                <tr
                  key={row.externalId}
                  className="border-b border-border/60 hover:bg-muted/20 cursor-pointer"
                  onClick={() => setSelectedExternalId(row.externalId)}
                >
                  <td className="p-2 font-mono text-xs">{row.externalId}</td>
                  <td className="p-2">{displayFinanceText(row.companyName)}</td>
                  <td className="p-2">{displayFinanceText(row.personName)}</td>
                  <td className="p-2 text-xs">
                    {displayFinanceText(
                      row.consolidatedSupplierName ?? FINANCE_AP_UNIDENTIFIED_SUPPLIER
                    )}
                  </td>
                  <td className="p-2 text-xs">
                    {displayFinanceText(row.costCenterLabel ?? FINANCE_AP_NO_CLASSIFICATION)}
                  </td>
                  <td className="p-2 text-xs">
                    {displayFinanceText(row.classificationOriginLabel ?? "—")}
                  </td>
                  <td className="p-2 text-xs">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                        row.isClassified
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      )}
                    >
                      {displayFinanceText(
                        row.classificationStatusLabel ?? FINANCE_AP_NO_CLASSIFICATION
                      )}
                    </span>
                  </td>
                  <td className="p-2 font-mono text-xs">{displayFinanceText(row.personCnpj)}</td>
                  <td className="p-2 max-w-[180px] truncate" title={row.description ?? undefined}>
                    {displayFinanceText(row.description)}
                  </td>
                  <td className="p-2 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
                  <td className="p-2 whitespace-nowrap">{formatFinanceDate(row.scheduleDate)}</td>
                  <td className="p-2 whitespace-nowrap">
                    {formatFinanceDate(row.operationalDueDate)}
                  </td>
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
                  <td className="p-2 text-xs tabular-nums">{row.type ?? "—"}</td>
                  <td className="p-2 text-[10px] text-muted-foreground max-w-[180px]">
                    {row.exclusionReason}
                  </td>
                  <td className="p-2 text-right tabular-nums">{formatFinanceDaysOverdue(row.daysOverdue)}</td>
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

      <FinanceApTitleClassificationSheet
        externalId={selectedExternalId}
        canEdit={canEditClassification}
        onClose={() => setSelectedExternalId(null)}
      />
    </div>
  );
}
