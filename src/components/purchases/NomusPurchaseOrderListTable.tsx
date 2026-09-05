import React, { memo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/src/lib/utils";
import type { NomusPurchaseOrderListRowDto } from "@/src/lib/nomus/nomusPurchaseOrder360";
import {
  formatNomusPurchaseOrderListInvoiceCell,
  formatNomusPurchaseOrderListSupplier,
  nomusPurchaseOrderFinancialLabel,
  nomusPurchaseOrderFinancialTone,
  nomusPurchaseOrderStageLabel,
  nomusPurchaseOrderStageTone,
} from "@/src/lib/nomus/nomusPurchaseOrderUi";
import { OverlayBadge } from "@/src/components/ui/overlay";
import "@/src/components/sales/sales-order-list-table.css";
import "./nomus-purchase-order-list-table.css";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

type RowProps = {
  row: NomusPurchaseOrderListRowDto;
  selected: boolean;
  onOpenDetail: (id: string) => void;
};

const NomusPurchaseOrderListTableRow = memo(function NomusPurchaseOrderListTableRow({
  row,
  selected,
  onOpenDetail,
}: RowProps) {
  const invoice = formatNomusPurchaseOrderListInvoiceCell(row);
  const supplier = formatNomusPurchaseOrderListSupplier(row);

  const handleOpen = useCallback(() => {
    onOpenDetail(row.id);
  }, [onOpenDetail, row.id]);

  return (
    <tr
      data-testid={`nomus-purchase-order-row-${row.id}`}
      data-selected={selected ? "true" : "false"}
      onClick={handleOpen}
    >
      <td>
        <div className="so-cell-order-code" title={row.orderNumber ?? String(row.externalId)}>
          {row.orderNumber ?? `Nomus #${row.externalId}`}
        </div>
        <div className="so-cell-meta">Nomus #{row.externalId}</div>
      </td>
      <td className="max-w-[14rem]">
        <span className="so-cell-ellipsis block" title={supplier}>
          {supplier}
        </span>
        {row.supplierMatched ? <div className="so-cell-meta">Fornecedor identificado</div> : null}
      </td>
      <td>
        {row.buyerPersonId != null ? (
          <span className="so-cell-ellipsis block" title={`Comprador Nomus #${row.buyerPersonId}`}>
            Comprador #{row.buyerPersonId}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="whitespace-nowrap text-xs tabular-nums">{formatDate(row.issuedAt)}</td>
      <td className="whitespace-nowrap text-xs tabular-nums">
        {formatDate(row.expectedAt)}
        {row.overdue ? (
          <OverlayBadge tone="rose" className="ml-1">
            Atrasado
          </OverlayBadge>
        ) : null}
      </td>
      <td>
        <OverlayBadge tone={nomusPurchaseOrderStageTone(row.stage)}>
          {nomusPurchaseOrderStageLabel(row.stage)}
        </OverlayBadge>
      </td>
      <td>
        <span className="so-cell-invoice-number" title={invoice.title} data-testid="npo-list-nf">
          <span className="font-mono text-xs tabular-nums">{invoice.primary}</span>
          {invoice.extraCount > 0 ? (
            <span className="so-cell-invoice-extra">+{invoice.extraCount}</span>
          ) : null}
        </span>
      </td>
      <td>
        <OverlayBadge tone={nomusPurchaseOrderFinancialTone(row.financialStatus)}>
          {nomusPurchaseOrderFinancialLabel(row.financialStatus)}
        </OverlayBadge>
      </td>
      <td className="so-value-cell font-medium">
        {row.plannedInstallmentsTotal == null
          ? "—"
          : formatCurrency(row.plannedInstallmentsTotal)}
      </td>
      <td className="so-value-cell text-muted-foreground">{row.itemCount}</td>
      <td onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs font-medium hover:bg-accent whitespace-nowrap"
          data-testid="npo-list-open-detail"
          onClick={handleOpen}
        >
          Detalhe
        </button>
      </td>
    </tr>
  );
});

export const NomusPurchaseOrderListTable = memo(function NomusPurchaseOrderListTable({
  rows,
  loading,
  selectedOrderId,
  onOpenDetail,
}: {
  rows: NomusPurchaseOrderListRowDto[];
  loading: boolean;
  selectedOrderId: string | null;
  onOpenDetail: (id: string) => void;
}) {
  return (
    <div className="npo-list-section sales-order-list-section" data-testid="nomus-purchase-order-list-table-wrap">
      <div className="sales-order-list-grid-title">Pedidos de compra Nomus</div>
      <div className="sales-order-list-table-wrap">
        <table
          className="sales-order-list-table npo-list-table"
          data-testid="nomus-purchase-order-list-table"
        >
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Fornecedor</th>
              <th>Comprador</th>
              <th>Emissão</th>
              <th>Entrega</th>
              <th>Situação</th>
              <th>NF</th>
              <th>Financeiro</th>
              <th className="so-value-cell">Total planejado</th>
              <th className="so-value-cell">Itens</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={11} className="p-8 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin inline text-primary" />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-8 text-center text-muted-foreground">
                  Nenhum pedido Nomus sincronizado.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <NomusPurchaseOrderListTableRow
                  key={row.id}
                  row={row}
                  selected={selectedOrderId === row.id}
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
