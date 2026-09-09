import React from "react";
import { Scale } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type {
  SellerDashboardOwnerBreakdownRow,
  SellerDashboardOwnerRankingTotals,
} from "@/src/components/crmSellerDashboardTypes";

export type CrmCommercialOwnerComparisonTableProps = {
  rows: SellerDashboardOwnerBreakdownRow[];
  totals: SellerDashboardOwnerRankingTotals;
  formatIntelCurrency: (v: unknown) => string;
  formatNumberPt: (v: number | null | undefined) => string;
  /** Resolve a chave do filtro "Responsável da carteira" a partir do nome exibido (best-effort). */
  resolveOwnerSellerKey: (label: string) => string | null;
  onSelectOwner: (key: string) => void;
  maxRows?: number;
};

/**
 * Comparação entre responsáveis. Visível só quando "Todos os responsáveis"
 * está selecionado — comparar uma pessoa contra ela mesma não ajuda
 * ninguém. Mostra participação (% do total), não só valor absoluto, para
 * dar contexto de tamanho de carteira sem inventar uma métrica nova: os
 * números vêm do mesmo motor oficial (`loadCrmSalesOrderMetrics`) usado
 * pela Gestão Geral.
 */
export const CrmCommercialOwnerComparisonTable: React.FC<CrmCommercialOwnerComparisonTableProps> = ({
  rows,
  totals,
  formatIntelCurrency,
  formatNumberPt,
  resolveOwnerSellerKey,
  onSelectOwner,
  maxRows = 15,
}) => {
  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, maxRows);
  const totalValue = totals.value > 0 ? totals.value : 1;

  return (
    <section
      className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
      aria-label="Comparação entre responsáveis"
      data-testid="crm-seller-owner-comparison"
    >
      <div className="px-4 pt-4 pb-3 border-b border-border/60 flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
          <Scale className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Comparação entre responsáveis</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pedidos e valor por Responsável Comercial no período — mesma fonte oficial dos KPIs
            acima. Participação (%) dá contexto de tamanho; não é um score de performance.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 bg-muted/20 text-left">
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide">
                Responsável
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Pedidos
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Valor
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                % do total
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Ticket médio
              </th>
              <th className="px-4 py-2.5 font-semibold text-muted-foreground text-[11px] uppercase tracking-wide text-right">
                Ação
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, idx) => {
              const share = (row.value / totalValue) * 100;
              const ticket = row.orders > 0 ? row.value / row.orders : 0;
              const sellerKey = resolveOwnerSellerKey(row.label);
              const isUnassigned = row.label.toLowerCase().includes("sem responsável");
              return (
                <tr
                  key={`${row.key}-${idx}`}
                  className={cn(
                    "border-b border-border/40 last:border-0",
                    isUnassigned ? "bg-amber-50/40" : idx % 2 === 1 ? "bg-muted/10" : ""
                  )}
                >
                  <td className="px-4 py-2.5 font-medium text-foreground">
                    {row.label}
                    {isUnassigned ? (
                      <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-900">
                        Atenção
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumberPt(row.orders)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                    {formatIntelCurrency(row.value)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {share.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {formatIntelCurrency(ticket)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {sellerKey ? (
                      <button
                        type="button"
                        onClick={() => onSelectOwner(sellerKey)}
                        className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                      >
                        Ver carteira
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totals.truncatedForDisplay ? (
        <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border/60">
          Mostrando os {visibleRows.length} maiores de {formatNumberPt(totals.groups)} responsáveis.
          Total do período: {formatNumberPt(totals.orders)} pedido(s) ·{" "}
          {formatIntelCurrency(totals.value)}.
        </p>
      ) : null}
    </section>
  );
};
