import React, { useMemo } from "react";
import { Loader2 } from "lucide-react";
import type { FinanceBillingNfeListPayload } from "@/src/lib/financeBillingNfeList";
import {
  filterBillingNfeRowsByLocalFilter,
  FINANCE_BILLING_NFE_LOCAL_FILTER_OPTIONS,
  isBillingNfeIncludedInDashboard,
  type FinanceBillingNfeLocalFilter,
} from "@/src/lib/financeBillingNfeLocalFilter";
import { formatFinanceCurrency, formatFinanceDateTime } from "@/src/lib/financeAccountsPayableFormat";
import { FinanceBillingSourceBadge } from "@/src/components/finance/billing/FinanceBillingSourceBadge";
import { FinanceStatusChip } from "@/src/components/finance/shared/FinanceStatusChip";
import { cn } from "@/src/lib/utils";
import { FinanceFilterScopeNote } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FINANCE_BILLING_NFE_LIST_SCOPE } from "@/src/lib/financeFilterScope";
import { NOMUS_NFE_STATUS_CANCELLED } from "@/src/lib/nomusNfeClassification";

function inclusionReason(row: Parameters<typeof isBillingNfeIncludedInDashboard>[0]): string {
  if (isBillingNfeIncludedInDashboard(row)) return "Incluída — NF-e autorizada mercado";
  if (row.status === NOMUS_NFE_STATUS_CANCELLED) return "Excluída — cancelada";
  if (!row.isMarketSale) return "Excluída — não mercado";
  if (row.billingClassification !== "MARKET_REVENUE") {
    return `Excluída — ${row.billingClassification ?? "classificação"}`;
  }
  return "Excluída — regra fiscal";
}

export function FinanceBillingNfeDetailsTable({
  nfeList,
  loading,
  error,
  onRetry,
  localFilter,
  onLocalFilterChange,
  appliedYear,
  appliedMonth,
}: {
  nfeList: FinanceBillingNfeListPayload | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  localFilter: FinanceBillingNfeLocalFilter;
  onLocalFilterChange: (value: FinanceBillingNfeLocalFilter) => void;
  appliedYear: number;
  appliedMonth: number | null;
}) {
  const filteredItems = useMemo(() => {
    if (!nfeList) return [];
    return filterBillingNfeRowsByLocalFilter(nfeList.items, localFilter, {
      year: appliedYear,
      month: appliedMonth,
    });
  }, [nfeList, localFilter, appliedYear, appliedMonth]);

  return (
    <div className="rounded-2xl border border-border/70 bg-white dark:bg-card shadow-sm overflow-hidden">
      <div className="flex flex-col gap-3 px-5 py-4 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              NF-e / Documentos ({filteredItems.length}
              {nfeList && filteredItems.length !== nfeList.items.length
                ? ` de ${nfeList.items.length}`
                : ""}
              )
            </h3>
            <FinanceFilterScopeNote className="mt-0.5">
              {FINANCE_BILLING_NFE_LIST_SCOPE}
            </FinanceFilterScopeNote>
          </div>
          <div className="flex items-center gap-2">
            <FinanceBillingSourceBadge source="nfe" />
            {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">Filtros locais</p>
          <p className="text-[10px] text-muted-foreground">
            Refinam o grid sem alterar filtros globais aplicados.
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {FINANCE_BILLING_NFE_LOCAL_FILTER_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onLocalFilterChange(opt.value)}
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
      </div>

      {error ? (
        <div className="p-5 text-sm text-red-700">
          {error}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="ml-2 underline text-primary">
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      {!loading && nfeList && filteredItems.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Nenhuma NF-e para os filtros atuais.
          </p>
          <p className="text-xs text-muted-foreground">
            Ajuste filtros globais (ano/mês/cliente) ou filtros locais. O dashboard oficial usa NF-e
            fiscal autorizada de mercado.
          </p>
        </div>
      ) : null}

      {filteredItems.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-[960px] w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  NF-e
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Cliente
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Emissão
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Processamento
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                  Valor líquido
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Mercado
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Motivo inclusão/exclusão
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {filteredItems.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold whitespace-nowrap">
                    {row.numero ?? row.externalId}
                    {row.serie ? (
                      <span className="text-muted-foreground"> /{row.serie}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 max-w-[220px]">
                    <div className="font-semibold truncate" title={row.customerName ?? undefined}>
                      {row.customerName ?? "—"}
                    </div>
                    {row.customerDocumentFormatted ? (
                      <div
                        className="text-[10px] text-muted-foreground tabular-nums truncate"
                        title={row.customerDocumentFormatted}
                      >
                        {row.customerDocumentFormatted}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                    {row.fiscalDate ? formatFinanceDateTime(row.fiscalDate) : "—"}
                  </td>
                  <td className="px-4 py-2 tabular-nums whitespace-nowrap">
                    {row.dataProcessamento ? formatFinanceDateTime(row.dataProcessamento) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums whitespace-nowrap">
                    {formatFinanceCurrency(row.valorLiquido)}
                  </td>
                  <td className="px-4 py-2">
                    <FinanceStatusChip
                      label={row.status === NOMUS_NFE_STATUS_CANCELLED ? "Cancelada" : "Autorizada"}
                      className={
                        row.status === NOMUS_NFE_STATUS_CANCELLED
                          ? "bg-red-100 text-red-800 border-red-200"
                          : "bg-green-100 text-green-800 border-green-200"
                      }
                    />
                  </td>
                  <td className="px-4 py-2">
                    {row.isMarketSale ? (
                      <span className="text-green-700 font-semibold">Sim</span>
                    ) : (
                      <span className="text-muted-foreground">Não</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[10px] text-muted-foreground max-w-[200px]">
                    {inclusionReason(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
