import React from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { PortfolioReconciliationOrderRow } from "@/src/lib/financePortfolioReconciliationClient";
import {
  PortfolioAlertsInline,
  PortfolioConfidenceBadge,
  PortfolioStatusBadge,
  formatPortfolioForecastSourceLabel,
} from "./PortfolioReconciliationBadges";

type Props = {
  rows: PortfolioReconciliationOrderRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onOpenOrder: (salesOrderId: string) => void;
};

export function PortfolioReconciliationOrdersTable({
  rows,
  page,
  pageSize,
  totalRows,
  totalPages,
  onPageChange,
  onOpenOrder,
}: Props) {
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  return (
    <section
      className={cn(financeBiCardClass, "overflow-hidden")}
      data-testid="portfolio-reconciliation-orders-table"
    >
      <div className="border-b border-border/70 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Pedidos conciliados</h2>
        <p className="text-xs text-muted-foreground">
          Comparativo pedido × alocação × CR × previsão (dados materializados).
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Pedido</th>
              <th className="px-3 py-2 font-semibold">Cliente</th>
              <th className="px-3 py-2 font-semibold text-right">Valor pedido</th>
              <th className="px-3 py-2 font-semibold text-right">Valor alocado</th>
              <th className="px-3 py-2 font-semibold text-right">CR</th>
              <th className="px-3 py-2 font-semibold text-right">Recebido</th>
              <th className="px-3 py-2 font-semibold text-right">Saldo</th>
              <th className="px-3 py-2 font-semibold">Forecast</th>
              <th className="px-3 py-2 font-semibold">Fonte</th>
              <th className="px-3 py-2 font-semibold">Confiança</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Alertas</th>
              <th className="px-3 py-2 font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canOpen = Boolean(row.salesOrderId);
              return (
                <tr
                  key={row.salesOrderId ?? `${row.pedido}-${row.customerExternalId}`}
                  className={cn(
                    "border-t border-border/60 align-top",
                    row.hasIssues ? "bg-amber-50/40" : "bg-card"
                  )}
                >
                  <td className="px-3 py-2.5 font-medium text-foreground">
                    {row.pedido ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 text-foreground">
                    <div className="min-w-0">
                      <div className="truncate">{row.cliente ?? "—"}</div>
                      {row.customerExternalId != null ? (
                        <div className="text-[11px] text-muted-foreground">
                          ID {row.customerExternalId}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatFinanceCurrency(row.valorPedido)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatFinanceCurrency(row.valorAlocado)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatFinanceCurrency(row.valorCR)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {formatFinanceCurrency(row.recebido)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">
                    {formatFinanceCurrency(row.saldo)}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {formatFinanceDate(row.forecastDate)}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {formatPortfolioForecastSourceLabel(row.forecastSource)}
                  </td>
                  <td className="px-3 py-2.5">
                    <PortfolioConfidenceBadge level={row.confidenceLevel} />
                  </td>
                  <td className="px-3 py-2.5">
                    <PortfolioStatusBadge status={row.status} />
                  </td>
                  <td className="px-3 py-2.5 min-w-[140px]">
                    <PortfolioAlertsInline alerts={row.alertas} />
                  </td>
                  <td className="px-3 py-2.5">
                    <button
                      type="button"
                      disabled={!canOpen}
                      onClick={() => {
                        if (row.salesOrderId) onOpenOrder(row.salesOrderId);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold text-foreground shadow-sm",
                        canOpen
                          ? "hover:bg-muted/60"
                          : "cursor-not-allowed opacity-50"
                      )}
                      data-testid="portfolio-reconciliation-open-order"
                      title={
                        canOpen
                          ? "Abrir detalhe do pedido"
                          : "Pedido sem identificador para detalhe"
                      }
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Detalhe
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Exibindo {from}–{to} de {totalRows}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <span className="text-xs text-muted-foreground">
            Página {page} / {Math.max(1, totalPages)}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}
