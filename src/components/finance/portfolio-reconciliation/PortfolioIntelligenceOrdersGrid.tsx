import React, { useMemo, useState } from "react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceOrderRow } from "@/src/lib/financePortfolioReconciliationClient";
import { cn } from "@/src/lib/utils";
import { financeModuleFilterFieldClass } from "@/src/lib/financeModuleUiStandards";

const CONFIDENCE_LABEL: Record<string, string> = {
  ALTA: "Alta",
  MEDIA: "Média",
  BAIXA: "Baixa",
  MUITO_BAIXA: "Muito baixa",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  ALTA: "bg-emerald-100 text-emerald-900 border-emerald-200",
  MEDIA: "bg-sky-100 text-sky-900 border-sky-200",
  BAIXA: "bg-amber-100 text-amber-900 border-amber-200",
  MUITO_BAIXA: "bg-rose-100 text-rose-900 border-rose-200",
};

function yesNo(v: boolean): string {
  return v ? "Sim" : "Não";
}

function daysSinceForecast(forecastDate: string | null): number | null {
  if (!forecastDate) return null;
  const [y, m, d] = forecastDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const forecast = new Date(y, m - 1, d);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((start.getTime() - forecast.getTime()) / 86_400_000);
}

type Props = {
  rows: PortfolioIntelligenceOrderRow[];
  searchQuery?: string;
  onSearchChange?: (q: string) => void;
  onOpenOrder?: (salesOrderId: string) => void;
};

/**
 * Grid de pedidos do drilldown de maturidade (somente formatação).
 */
export function PortfolioIntelligenceOrdersGrid({
  rows,
  searchQuery = "",
  onSearchChange,
  onOpenOrder,
}: Props) {
  const [localSearch, setLocalSearch] = useState("");
  const q = (onSearchChange ? searchQuery : localSearch).trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = [
        r.orderCode,
        r.customerName,
        r.sellerName,
        r.statusPrincipal,
        r.mainReason,
        r.externalSalesOrderId != null ? String(r.externalSalesOrderId) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [rows, q]);

  if (rows.length === 0) {
    return (
      <p
        className="px-1 py-4 text-center text-xs text-muted-foreground"
        data-testid="portfolio-intelligence-grid-empty"
      >
        Nenhum pedido neste status.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="portfolio-intelligence-orders-grid">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className={cn(financeModuleFilterFieldClass(), "max-w-xs text-xs")}
          placeholder="Buscar pedido, cliente, vendedor…"
          value={onSearchChange ? searchQuery : localSearch}
          onChange={(e) =>
            onSearchChange ? onSearchChange(e.target.value) : setLocalSearch(e.target.value)
          }
          data-testid="portfolio-intelligence-grid-search"
        />
        <span className="text-[10px] text-muted-foreground">
          {filtered.length} de {rows.length} pedido(s)
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">
          Nenhum pedido corresponde à busca.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border/70">
          <table className="min-w-[1600px] w-full border-collapse text-left text-xs">
            <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">Pedido</th>
                <th className="px-2 py-2 font-semibold">Cliente</th>
                <th className="px-2 py-2 font-semibold">Vendedor</th>
                <th className="px-2 py-2 font-semibold">Emissão</th>
                <th className="px-2 py-2 font-semibold">Prevista</th>
                <th className="px-2 py-2 font-semibold text-right">Dias emissão</th>
                <th className="px-2 py-2 font-semibold text-right">Dias previsão</th>
                <th className="px-2 py-2 font-semibold text-right">Valor pedido</th>
                <th className="px-2 py-2 font-semibold text-right">Valor CR</th>
                <th className="px-2 py-2 font-semibold text-right">Recebido</th>
                <th className="px-2 py-2 font-semibold text-right">Aberto</th>
                <th className="px-2 py-2 font-semibold">Status</th>
                <th className="px-2 py-2 font-semibold">Confiança</th>
                <th className="px-2 py-2 font-semibold">Motivo</th>
                <th className="px-2 py-2 font-semibold">Ação</th>
                <th className="px-2 py-2 font-semibold">ID Nomus</th>
                <th className="px-2 py-2 font-semibold">Produto</th>
                <th className="px-2 py-2 font-semibold">NF</th>
                <th className="px-2 py-2 font-semibold">Doc. saída</th>
                <th className="px-2 py-2 font-semibold">CR</th>
                <th className="px-2 py-2 font-semibold">Baixa</th>
                <th className="px-2 py-2 font-semibold">Última evidência</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const canOpen = Boolean(row.salesOrderId && onOpenOrder);
                const conf = row.confidenceLabel?.toUpperCase() ?? "";
                return (
                  <tr
                    key={row.salesOrderId ?? row.orderCode}
                    className={cn(
                      "border-t border-border/50 align-top",
                      canOpen && "cursor-pointer hover:bg-sky-50/50"
                    )}
                    onClick={() => {
                      if (row.salesOrderId && onOpenOrder) onOpenOrder(row.salesOrderId);
                    }}
                    data-testid="portfolio-intelligence-grid-row"
                  >
                    <td className="px-2 py-2 font-medium text-foreground">{row.orderCode}</td>
                    <td className="px-2 py-2">
                      <div className="max-w-[140px] truncate">{row.customerName ?? "—"}</div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="max-w-[120px] truncate">
                        {row.sellerName ?? "Informação não disponível na importação atual."}
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{formatFinanceDate(row.issueDate)}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatFinanceDate(row.forecastDate ?? row.expectedDeliveryDate)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {row.daysSinceIssue != null ? formatFinanceInteger(row.daysSinceIssue) : "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {(() => {
                        const d = daysSinceForecast(row.forecastDate);
                        return d != null ? formatFinanceInteger(d) : "—";
                      })()}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.orderValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivableTotalValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.receivedValue)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {formatFinanceCurrency(row.openReceivableValue)}
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[10px] font-medium">
                        {row.statusPrincipal}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                          CONFIDENCE_CLASS[conf] ?? "bg-muted text-muted-foreground border-border"
                        )}
                      >
                        {CONFIDENCE_LABEL[conf] ?? row.confidenceLabel} ({row.confidenceScore})
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <div className="max-w-[220px] truncate text-muted-foreground" title={row.mainReason}>
                        {row.mainReason}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div
                        className="max-w-[180px] truncate text-muted-foreground"
                        title={row.recommendedAction}
                      >
                        {row.recommendedAction}
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.externalSalesOrderId != null ? row.externalSalesOrderId : "—"}
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.productExternalIds[0] != null ? row.productExternalIds[0] : "—"}
                    </td>
                    <td className="px-2 py-2">{yesNo(row.evidenceFlags?.hasNfe)}</td>
                    <td className="px-2 py-2">{yesNo(row.evidenceFlags?.hasStockDocument)}</td>
                    <td className="px-2 py-2">{yesNo(row.evidenceFlags?.hasReceivable)}</td>
                    <td className="px-2 py-2">{yesNo(row.evidenceFlags?.hasReceived)}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {formatFinanceDate(row.updatedAt ?? row.nextRelevantDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
