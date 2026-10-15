import React, { memo, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { formatCurrency } from "@/src/lib/utils";
import { formatPmpDays } from "@/src/lib/purchasing/purchasePaymentTerms";
import {
  PAYMENT_TERMS_ANALYSIS_BASE_LABEL,
  type PaymentTermsCellDto,
} from "@/src/lib/purchasing/purchasePaymentTermsAnalysis";
import type { NomusPurchaseOrderListRowDto } from "@/src/lib/nomus/nomusPurchaseOrder360";
import {
  formatNomusPurchaseOrderListInvoiceCell,
  formatNomusPurchaseOrderListSupplier,
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

export type PaymentTermsSort = "pmp_asc" | "pmp_desc" | null;

function formatBaseDate(key: string | null): string {
  if (!key) return "—";
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

/** Tooltip: origem e método do cálculo (data-base = emissão do pedido; não é condição contratual). */
export function paymentTermsCellTitle(cell: PaymentTermsCellDto): string {
  if (cell.status === "NOT_IDENTIFIED") {
    return `Prazo não identificado: ${cell.reasonLabel ?? "dados insuficientes"} Não é tratado como à vista.`;
  }
  return [
    `${PAYMENT_TERMS_ANALYSIS_BASE_LABEL} (${formatBaseDate(cell.baseDate)}).`,
    `PMP = Σ(valor da parcela × dias) ÷ Σ(valor das parcelas); ${cell.installmentCount} parcela(s) planejada(s) no Nomus.`,
    "Data-base de emissão: não é condição contratual confirmada.",
    ...cell.warnings,
  ].join("\n");
}

/** Célula "Prazo de Pagamento": condição observada + PMP; meta só aparece se configurada. */
export function PaymentTermsCell({ cell }: { cell: PaymentTermsCellDto }) {
  return (
    <div className="npo-payment-terms-cell" title={paymentTermsCellTitle(cell)} data-testid="npo-list-payment-terms">
      <div
        className={cell.status === "IDENTIFIED" ? "font-mono text-xs font-medium tabular-nums" : "text-xs text-muted-foreground"}
      >
        {cell.label}
      </div>
      <div className="so-cell-meta tabular-nums">
        {formatPmpDays(cell.pmpDays)}
        {cell.gapDays != null ? (
          <span className={cell.gapDays < 0 ? "ml-1 text-amber-700" : "ml-1"} data-testid="npo-list-payment-terms-gap">
            · {cell.gapDays < 0 ? `${cell.gapDays} d da meta` : "na meta"}
          </span>
        ) : null}
      </div>
    </div>
  );
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
        <PaymentTermsCell cell={row.paymentTerms} />
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
  sort = null,
  onSortChange,
}: {
  rows: NomusPurchaseOrderListRowDto[];
  loading: boolean;
  selectedOrderId: string | null;
  onOpenDetail: (id: string) => void;
  sort?: PaymentTermsSort;
  onSortChange?: (next: PaymentTermsSort) => void;
}) {
  const nextSort: PaymentTermsSort = sort === null ? "pmp_desc" : sort === "pmp_desc" ? "pmp_asc" : null;
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
              <th aria-sort={sort === "pmp_asc" ? "ascending" : sort === "pmp_desc" ? "descending" : "none"}>
                {onSortChange ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 font-inherit"
                    onClick={() => onSortChange(nextSort)}
                    title="Ordenar pelo PMP (dias). Não identificados ficam ao final."
                    data-testid="npo-list-sort-pmp"
                  >
                    Prazo de Pagamento
                    <span aria-hidden className="text-muted-foreground">
                      {sort === "pmp_desc" ? "↓" : sort === "pmp_asc" ? "↑" : "↕"}
                    </span>
                  </button>
                ) : (
                  "Prazo de Pagamento"
                )}
              </th>
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
