import React from "react";
import { Calculator, Edit2, Loader2 } from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import type {
  CommercialPublishedPriceGridRow,
  CommercialPublishedPriceGridTable,
} from "@/src/lib/pricing/commercialPublishedPrices.types";
import {
  formatPublishedAtLabel,
  formatPublishedRowStatus,
} from "@/src/lib/pricing/commercialPublishedPricesUi";
import { isPublishedPriceCellClickable } from "@/src/lib/pricing/publishedPriceFormationView";

type PremissaRow = {
  id: string;
  productId: string;
  taxRuleId?: string | null;
};

type CommercialPublishedPricesGridProps = {
  tables: CommercialPublishedPriceGridTable[];
  rows: CommercialPublishedPriceGridRow[];
  loading: boolean;
  emptyMessage: string | null;
  allowSimulate: boolean;
  pricings: PremissaRow[];
  openingRowId?: string | null;
  onRowClick: (row: CommercialPublishedPriceGridRow) => void;
  onPriceCellClick: (row: CommercialPublishedPriceGridRow, tableId: string) => void;
  onCalculate: (productId: string, taxRuleId: string) => void;
  onEditPremissa: (premissa: PremissaRow) => void;
  onCreatePremissa: (productId: string, taxRuleId: string | null) => void;
};

function resolvePriceForTable(row: CommercialPublishedPriceGridRow, tableId: string) {
  return row.prices.find((price) => price.tableId === tableId) ?? null;
}

export function CommercialPublishedPricesGrid({
  tables,
  rows,
  loading,
  emptyMessage,
  allowSimulate,
  pricings,
  openingRowId,
  onRowClick,
  onPriceCellClick,
  onCalculate,
  onEditPremissa,
  onCreatePremissa,
}: CommercialPublishedPricesGridProps) {
  const columnCount = 3 + tables.length + 3;

  if (loading) {
    return (
      <div className="bg-card rounded-2xl border border-border p-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-4 font-bold text-xs uppercase text-muted-foreground whitespace-nowrap">SKU</th>
              <th className="p-4 font-bold text-xs uppercase text-muted-foreground min-w-[180px]">Produto</th>
              <th className="p-4 font-bold text-xs uppercase text-muted-foreground whitespace-nowrap">Info Tributária</th>
              {tables.map((table) => (
                <th
                  key={table.tableId}
                  className="p-4 font-bold text-xs uppercase text-muted-foreground text-right whitespace-nowrap"
                  title={table.tableCode}
                >
                  {table.tableName}
                </th>
              ))}
              <th className="p-4 font-bold text-xs uppercase text-muted-foreground whitespace-nowrap">
                Última publicação
              </th>
              <th className="p-4 font-bold text-xs uppercase text-muted-foreground whitespace-nowrap">Status</th>
              <th className="p-4 font-bold text-xs uppercase text-muted-foreground text-center whitespace-nowrap">
                Ações
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {emptyMessage ? (
              <tr>
                <td colSpan={columnCount} className="p-12 text-center text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const fiscalRuleId = row.taxInfo?.fiscalRuleId ?? null;
                const premissa = pricings.find(
                  (pricing) =>
                    pricing.productId === row.productId &&
                    (!fiscalRuleId || pricing.taxRuleId === fiscalRuleId)
                );

                return (
                  <tr
                    key={row.productId}
                    className={cn(
                      "hover:bg-accent/20 cursor-pointer",
                      openingRowId === row.productId && "opacity-70"
                    )}
                    onClick={() => onRowClick(row)}
                  >
                    <td className="p-4 font-mono text-xs text-muted-foreground whitespace-nowrap">{row.sku}</td>
                    <td className="p-4">
                      <p className="font-bold text-sm tracking-tight">{row.productName}</p>
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <div className="flex flex-col gap-1">
                        <span className="inline-flex w-fit bg-primary/10 text-primary px-2 py-1 rounded text-[10px] uppercase font-bold tracking-widest">
                          {row.taxInfo?.fiscalRuleName ?? "—"}
                        </span>
                        {row.taxInfo?.taxPercent != null ? (
                          <span className="text-[10px] text-muted-foreground">
                            Imposto {row.taxInfo.taxPercent.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                          </span>
                        ) : null}
                      </div>
                    </td>
                    {tables.map((table) => {
                      const price = resolvePriceForTable(row, table.tableId);
                      const clickable = isPublishedPriceCellClickable(price);
                      const handleCellOpen = (event: React.MouseEvent | React.KeyboardEvent) => {
                        event.stopPropagation();
                        if (!clickable) return;
                        onPriceCellClick(row, table.tableId);
                      };

                      return (
                        <td
                          key={`${row.productId}-${table.tableId}`}
                          className={cn(
                            "p-4 text-right whitespace-nowrap",
                            clickable
                              ? "cursor-pointer hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/40"
                              : "cursor-default"
                          )}
                          role={clickable ? "button" : undefined}
                          tabIndex={clickable ? 0 : undefined}
                          aria-label={
                            clickable
                              ? `Abrir resultado publicado da tabela ${table.tableName} com preço ${formatCurrency(price.salePrice, 2)}`
                              : `Sem preço publicado na tabela ${table.tableName}`
                          }
                          onClick={clickable ? handleCellOpen : undefined}
                          onKeyDown={
                            clickable
                              ? (event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handleCellOpen(event);
                                  }
                                }
                              : undefined
                          }
                        >
                          {clickable ? (
                            <span className="font-bold text-primary underline-offset-2 hover:underline">
                              {formatCurrency(price.salePrice, 2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs font-medium">Sem preço</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-4 text-xs text-muted-foreground whitespace-nowrap">
                      {formatPublishedAtLabel(row.lastPublishedAt)}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide",
                          row.status === "OK" && "bg-green-100 text-green-800",
                          row.status === "PARTIAL" && "bg-amber-100 text-amber-800",
                          row.status === "NO_PRICE" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {formatPublishedRowStatus(row.status)}
                      </span>
                    </td>
                    <td className="p-4 btn-acoes" onClick={(event) => event.stopPropagation()}>
                      <div className="flex gap-2 justify-center">
                        {allowSimulate && fiscalRuleId ? (
                          <button
                            type="button"
                            title="Simulação ao vivo (premissa)"
                            onClick={() => onCalculate(row.productId, fiscalRuleId)}
                            className="p-2 text-primary bg-primary/10 hover:bg-primary hover:text-white rounded-lg transition-colors"
                          >
                            <Calculator className="h-4 w-4" />
                          </button>
                        ) : null}
                        {premissa ? (
                          <button
                            type="button"
                            title="Editar premissa"
                            onClick={() => onEditPremissa(premissa)}
                            className="p-2 text-muted-foreground hover:bg-accent hover:text-primary rounded-lg transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Nova premissa para este produto"
                            onClick={() => onCreatePremissa(row.productId, fiscalRuleId)}
                            className="p-2 text-muted-foreground hover:bg-accent hover:text-primary rounded-lg transition-colors"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
