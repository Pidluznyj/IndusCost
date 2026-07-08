import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";
import { SalesOrderListMarginCell } from "@/src/components/sales/SalesOrderListMarginCell";
import type { SalesOrderListRowSnapshot } from "@/src/components/sales/SalesOrderQuickSummaryDrawer";
import {
  buildSalesOrderListCustomerMeta,
  formatSalesOrderDisplayCode,
  formatSalesOrderListIssueDate,
  formatSalesOrderListItemsCount,
  formatSalesOrderListNetValue,
  resolveSalesOrderListCustomerName,
  SALES_ORDER_LIST_STATUS_LABELS,
} from "@/src/lib/salesOrderListUi";
import { resolveSalesOrderListSellerLabel } from "@/src/lib/salesOrderListSellerUi";
import "./sales-order-list-table.css";

export function SalesOrderListTable({
  rows,
  loading,
  selectedOrderId,
  showMarginEconomics = true,
  onRowOpenSummary,
  onOpenDetail,
}: {
  rows: SalesOrderListRowSnapshot[];
  loading: boolean;
  selectedOrderId: string | null;
  showMarginEconomics?: boolean;
  onRowOpenSummary: (row: SalesOrderListRowSnapshot) => void;
  onOpenDetail: (orderId: string) => void;
}) {
  const columnCount = showMarginEconomics ? 9 : 8;
  return (
    <div
      className="bg-card rounded-xl border border-border overflow-hidden shadow-sm"
      data-testid="sales-order-list-table-wrap"
    >
      <div className="sales-order-list-table-wrap">
        <table className="sales-order-list-table" data-testid="sales-order-list-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Vendedor</th>
              <th>Emissão</th>
              <th>Situação</th>
              <th className="so-value-cell">Valor líquido</th>
              {showMarginEconomics ? <th className="so-value-cell">Margem</th> : null}
              <th className="so-value-cell">Itens</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columnCount} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columnCount} className="p-8 text-center text-muted-foreground">
                  Nenhum pedido de venda encontrado.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const customerName = resolveSalesOrderListCustomerName({
                  companyName: row.Customer?.companyName,
                  tradeName: row.Customer?.tradeName,
                });
                const customerMeta = buildSalesOrderListCustomerMeta({
                  proposalNumber: row.Proposal?.number,
                  externalProposalCode: row.Proposal?.externalProposalCode,
                });
                const netValue = formatSalesOrderListNetValue(row.totalNetValue);
                const items = formatSalesOrderListItemsCount(row.totalItems);
                const proposalLine =
                  row.Proposal?.number != null ? `Proposta #${row.Proposal.number}` : null;

                return (
                  <tr
                    key={row.id}
                    data-testid={`sales-order-row-${row.id}`}
                    data-selected={selectedOrderId === row.id ? "true" : "false"}
                    onClick={() => onRowOpenSummary(row)}
                  >
                    <td>
                      <div
                        className="so-cell-order-code"
                        data-testid="sales-order-list-order-code"
                        title={row.orderCode}
                      >
                        {formatSalesOrderDisplayCode(row.orderCode)}
                      </div>
                      {proposalLine ? (
                        <div className="so-cell-meta">{proposalLine}</div>
                      ) : null}
                    </td>
                    <td className="max-w-[14rem]" onClick={(e) => e.stopPropagation()}>
                      {row.customerId ? (
                        <Link
                          to={buildCustomerIntelligencePath(row.customerId)}
                          className="inline-flex max-w-full items-center gap-1 font-medium text-primary hover:underline"
                          title={customerName}
                        >
                          <span className="so-cell-ellipsis">{customerName}</span>
                          <Sparkles className="h-3 w-3 shrink-0 opacity-70" />
                        </Link>
                      ) : (
                        <span className="so-cell-ellipsis block" title={customerName}>
                          {customerName}
                        </span>
                      )}
                      {customerMeta ? (
                        <div className="so-cell-meta so-cell-ellipsis" title={customerMeta}>
                          {customerMeta}
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <span
                        className="so-cell-ellipsis block max-w-[10rem]"
                        title={resolveSalesOrderListSellerLabel(row)}
                        data-testid="sales-order-list-seller"
                      >
                        {resolveSalesOrderListSellerLabel(row)}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-xs tabular-nums">
                      {formatSalesOrderListIssueDate(row.issueDate)}
                    </td>
                    <td>
                      <span
                        className="so-status-badge"
                        title={SALES_ORDER_LIST_STATUS_LABELS[row.status] ?? row.status}
                      >
                        {SALES_ORDER_LIST_STATUS_LABELS[row.status] ?? row.status ?? "—"}
                      </span>
                    </td>
                    <td className="so-value-cell font-medium" title={netValue.title}>
                      {netValue.display}
                    </td>
                    {showMarginEconomics ? (
                      <td>
                        <SalesOrderListMarginCell
                          marginSummary={row.marginSummary}
                          marginItems={row.marginItems}
                          orderIssueDate={row.issueDate}
                        />
                      </td>
                    ) : null}
                    <td className="so-value-cell text-muted-foreground" title={items.title}>
                      {items.display}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold hover:bg-accent whitespace-nowrap"
                        data-testid="sales-order-list-open-summary"
                        onClick={() => onRowOpenSummary(row)}
                      >
                        Ver resumo
                      </button>
                      <button
                        type="button"
                        className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent whitespace-nowrap hidden xl:inline-flex"
                        onClick={() => onOpenDetail(row.id)}
                      >
                        Detalhe
                      </button>
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
