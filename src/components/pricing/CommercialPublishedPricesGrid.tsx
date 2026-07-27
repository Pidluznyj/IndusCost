import React from "react";
import { Loader2 } from "lucide-react";
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
import "@/src/components/sales/sales-order-list-table.css";
import "@/src/components/commercial/commercial-price-table-grid.css";

export type CommercialPublishedPricesGridVariant = "formation" | "consult";

type CommercialPublishedPricesGridProps = {
  tables: CommercialPublishedPriceGridTable[];
  rows: CommercialPublishedPriceGridRow[];
  loading: boolean;
  emptyMessage: string | null;
  openingRowId?: string | null;
  /** formation = Formação de Preço; consult = Tabela comercial (vendedor). */
  variant?: CommercialPublishedPricesGridVariant;
  onRowClick: (row: CommercialPublishedPriceGridRow) => void;
  onPriceCellClick: (row: CommercialPublishedPriceGridRow, tableId: string) => void;
};

function resolvePriceForTable(row: CommercialPublishedPriceGridRow, tableId: string) {
  return row.prices.find((price) => price.tableId === tableId) ?? null;
}

export function CommercialPublishedPricesGrid({
  tables,
  rows,
  loading,
  emptyMessage,
  openingRowId,
  variant = "formation",
  onRowClick,
  onPriceCellClick,
}: CommercialPublishedPricesGridProps) {
  const isConsult = variant === "consult";
  const columnCount = isConsult ? 2 + tables.length : 3 + tables.length + 2;

  if (loading) {
    return (
      <div
        className={cn(
          isConsult
            ? "sales-order-list-section commercial-price-table-grid p-12 text-center"
            : "bg-card rounded-2xl border border-border p-12 text-center"
        )}
      >
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
      </div>
    );
  }

  if (isConsult) {
    return (
      <div
        className="sales-order-list-section commercial-price-table-grid overflow-hidden"
        data-testid="commercial-price-table-grid"
        data-variant="consult"
      >
        <div className="sales-order-list-grid-title">Tabela comercial</div>
        <div className="sales-order-list-table-wrap">
          <table className="sales-order-list-table" style={{ minWidth: tables.length > 2 ? 960 : 640 }}>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Produto</th>
                {tables.map((table) => (
                  <th key={table.tableId} className="cpt-price-cell" title={table.tableCode}>
                    {table.tableName}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {emptyMessage ? (
                <tr>
                  <td colSpan={columnCount} className="p-12 text-center text-muted-foreground">
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.productId}>
                    <td className="cpt-sku">{row.sku}</td>
                    <td>
                      <p className="cpt-product-name so-cell-ellipsis">{row.productName}</p>
                    </td>
                    {tables.map((table) => {
                      const price = resolvePriceForTable(row, table.tableId);
                      const hasPrice =
                        price != null &&
                        typeof price.salePrice === "number" &&
                        Number.isFinite(price.salePrice);
                      return (
                        <td key={`${row.productId}-${table.tableId}`} className="cpt-price-cell">
                          {hasPrice ? (
                            <span className="cpt-price-value">{formatCurrency(price.salePrice, 2)}</span>
                          ) : (
                            <span className="cpt-price-empty">Sem preço</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm"
      data-testid="commercial-price-table-grid"
      data-variant="formation"
    >
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
