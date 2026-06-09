import React from "react";
import { Loader2 } from "lucide-react";
import type { FinanceBillingNfeListPayload } from "@/src/lib/financeBillingNfeList";
import { formatFinanceCurrency, formatFinanceDateTime } from "@/src/lib/financeAccountsPayableFormat";
import { FinanceBillingSourceBadge } from "@/src/components/finance/billing/FinanceBillingSourceBadge";
import { cn } from "@/src/lib/utils";
import { FinanceFilterScopeNote } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FINANCE_BILLING_NFE_LIST_SCOPE } from "@/src/lib/financeFilterScope";

function classificationBadge(cls: string | null) {
  if (!cls) return "bg-muted text-muted-foreground";
  if (cls === "MARKET_REVENUE") return "bg-green-100 text-green-800 border-green-200";
  if (cls === "INTERCOMPANY") return "bg-blue-100 text-blue-800 border-blue-200";
  if (cls === "LOGISTICS_NOT_REVENUE") return "bg-slate-100 text-slate-700 border-slate-200";
  return "bg-muted text-muted-foreground";
}

function statusBadge(status: number | null) {
  if (status === 7) return "bg-red-100 text-red-800 border-red-200";
  return "bg-green-100 text-green-800 border-green-200";
}

export function FinanceBillingNfeDetailsTable({
  nfeList,
  loading,
  error,
  onRetry,
}: {
  nfeList: FinanceBillingNfeListPayload | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white dark:bg-card shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            Detalhado NF-e ({nfeList?.total ?? 0})
          </h3>
          <FinanceFilterScopeNote className="mt-0.5">
            {FINANCE_BILLING_NFE_LIST_SCOPE}
          </FinanceFilterScopeNote>
        </div>
        <div className="flex items-center gap-2">
          <FinanceBillingSourceBadge variant="diagnostic" />
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
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

      {!loading && nfeList && nfeList.items.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">
            Aguardando sincronização de NF-e Nomus.
          </p>
          <p className="text-xs text-muted-foreground">
            A listagem diagnóstica NomusNfe está vazia para os filtros aplicados. Execute a
            sincronização de NF-e ou ajuste ano/mês/cliente. O dashboard oficial continua em
            SalesOrder.
          </p>
        </div>
      ) : null}

      {nfeList && nfeList.items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  NF
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Destinatário
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Natureza
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Classificação
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Data fiscal
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                  Valor líquido
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Mercado?
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {nfeList.items.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold">
                    {row.numero ?? row.externalId}
                    {row.serie ? <span className="text-muted-foreground"> /{row.serie}</span> : null}
                  </td>
                  <td className="px-4 py-2">{row.xmlDestCnpjCpf ?? "—"}</td>
                  <td className="px-4 py-2 max-w-[180px] truncate">{row.xmlNatOp ?? "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
                        classificationBadge(row.billingClassification)
                      )}
                    >
                      {row.billingClassification ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {row.fiscalDate ? formatFinanceDateTime(row.fiscalDate) : "—"}
                  </td>
                  <td className="px-4 py-2 text-right font-bold tabular-nums">
                    {formatFinanceCurrency(row.valorLiquido)}
                  </td>
                  <td className="px-4 py-2">
                    {row.isMarketSale ? (
                      <span className="text-green-700 font-semibold">Sim</span>
                    ) : (
                      <span className="text-muted-foreground">Não</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold",
                        statusBadge(row.status)
                      )}
                    >
                      {row.status === 7 ? "Cancelada" : "Autorizada"}
                    </span>
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
