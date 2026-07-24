import React, { memo, useCallback } from "react";
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
} from "@/src/lib/salesOrderListUi";
import { resolveSalesOrderListSellerLabel } from "@/src/lib/salesOrderListSellerUi";
import {
  resolveSalesOrderBillingStatus,
  SALES_ORDER_BILLING_STATUS_TOOLTIP,
  salesOrderBillingStatusBadgeClass,
  salesOrderBillingStatusLabel,
} from "@/src/lib/sales/salesOrderListBillingStatus";
import { noteDevPerfRender } from "@/src/lib/devPerfBaselineClient";
import "./sales-order-list-table.css";

/**
 * Coluna "NF" — mostra o número da última NF vinculada (fallback "—") e um
 * contador `(+N)` quando o pedido tem múltiplas NF-e além da última exibida.
 */
function formatSalesOrderListInvoiceCell(row: SalesOrderListRowSnapshot): {
  primary: string;
  extraCount: number;
  title: string;
} {
  const number = row.lastInvoiceNumber?.trim() ?? "";
  const count = row.invoiceCount ?? 0;
  if (!number) {
    return {
      primary: count > 0 ? `${count} NF-e` : "—",
      extraCount: 0,
      title:
        count > 0
          ? `${count} NF-e vinculada(s) sem número disponível`
          : "Nenhuma NF-e vinculada",
    };
  }
  const extra = Math.max(0, count - 1);
  return {
    primary: number,
    extraCount: extra,
    title:
      extra > 0
        ? `Última NF: ${number} · +${extra} outra(s) vinculada(s)`
        : `Última NF: ${number}`,
  };
}

type SalesOrderListTableRowProps = {
  row: SalesOrderListRowSnapshot;
  selected: boolean;
  showMarginEconomics: boolean;
  onRowOpenSummary: (row: SalesOrderListRowSnapshot) => void;
  onOpenDetail: (orderId: string) => void;
};

/**
 * Linha memoizada: evita recalcular formatação pt-BR / badges em digitação
 * de filtro ou abertura de drawer quando a linha e seleção não mudaram.
 */
const SalesOrderListTableRow = memo(function SalesOrderListTableRow({
  row,
  selected,
  showMarginEconomics,
  onRowOpenSummary,
  onOpenDetail,
}: SalesOrderListTableRowProps) {
  noteDevPerfRender("SalesOrderListTableRow");

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
  const sellerLabel = resolveSalesOrderListSellerLabel(row);
  const issueDateLabel = formatSalesOrderListIssueDate(row.issueDate);
  const billingStatus =
    row.billingStatus ??
    resolveSalesOrderBillingStatus({
      status: row.status,
      hasNfe: Boolean(row.hasInvoice),
    });
  const invoice = formatSalesOrderListInvoiceCell(row);

  const handleRowClick = useCallback(() => {
    onRowOpenSummary(row);
  }, [onRowOpenSummary, row]);

  const handleOpenDetail = useCallback(() => {
    onOpenDetail(row.id);
  }, [onOpenDetail, row.id]);

  return (
    <tr
      data-testid={`sales-order-row-${row.id}`}
      data-selected={selected ? "true" : "false"}
      onClick={handleRowClick}
    >
      <td>
        <div
          className="so-cell-order-code"
          data-testid="sales-order-list-order-code"
          title={row.orderCode}
        >
          {formatSalesOrderDisplayCode(row.orderCode)}
        </div>
        {proposalLine ? <div className="so-cell-meta">{proposalLine}</div> : null}
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
          title={sellerLabel}
          data-testid="sales-order-list-seller"
        >
          {sellerLabel}
        </span>
      </td>
      <td className="whitespace-nowrap text-xs tabular-nums">{issueDateLabel}</td>
      <td>
        <span
          className={salesOrderBillingStatusBadgeClass(billingStatus)}
          data-testid="sales-order-list-billing-status"
          data-billing-status={billingStatus}
          title={SALES_ORDER_BILLING_STATUS_TOOLTIP}
        >
          {salesOrderBillingStatusLabel(billingStatus)}
        </span>
      </td>
      <td>
        <span
          className="so-cell-invoice-number"
          data-testid="sales-order-list-nf"
          title={invoice.title}
        >
          <span className="font-mono text-xs tabular-nums">{invoice.primary}</span>
          {invoice.extraCount > 0 ? (
            <span className="so-cell-invoice-extra">+{invoice.extraCount}</span>
          ) : null}
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
          onClick={handleRowClick}
        >
          Ver resumo
        </button>
        <button
          type="button"
          className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent whitespace-nowrap hidden xl:inline-flex"
          onClick={handleOpenDetail}
        >
          Detalhe
        </button>
      </td>
    </tr>
  );
});

export const SalesOrderListTable = memo(function SalesOrderListTable({
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
  noteDevPerfRender("SalesOrderListTable");
  const columnCount = showMarginEconomics ? 10 : 9;
  return (
    <div
      className="sales-order-list-section overflow-hidden"
      data-testid="sales-order-list-table-wrap"
    >
      <div className="sales-order-list-grid-title">Pedidos de venda</div>
      <div className="sales-order-list-table-wrap">
        <table className="sales-order-list-table" data-testid="sales-order-list-table">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Cliente</th>
              <th>Vendedor</th>
              <th>Emissão</th>
              <th title={SALES_ORDER_BILLING_STATUS_TOOLTIP}>Faturamento</th>
              <th>NF</th>
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
              rows.map((row) => (
                <SalesOrderListTableRow
                  key={row.id}
                  row={row}
                  selected={selectedOrderId === row.id}
                  showMarginEconomics={showMarginEconomics}
                  onRowOpenSummary={onRowOpenSummary}
                  onOpenDetail={onOpenDetail}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});
