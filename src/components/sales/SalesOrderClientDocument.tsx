import React, { useMemo } from "react";
import type { Customer } from "@/src/types/commercial";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { formatPrintDate } from "@/src/lib/printBranding";

export type SalesOrderClientDocumentOrder = {
  orderCode: string;
  status: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  responsible: string | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  deliveryLocation: string | null;
  notes: string | null;
  totalGrossValue: unknown;
  totalDiscount: unknown;
  totalNetValue: unknown;
  totalFreight: unknown;
  Customer?: Customer | null;
  items: Array<{
    id: string;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: unknown;
    unit: string | null;
    negotiatedPrice: unknown;
    totalNetValue: unknown;
  }>;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney(value: unknown): string {
  return safeNum(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(value: unknown): string {
  const n = safeNum(value);
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function formatItemLineNo(index: number): string {
  return String((index + 1) * 10).padStart(5, "0");
}

function formatUnit(unit?: string | null): string {
  const normalized = String(unit ?? "").trim().toUpperCase();
  if (!normalized) return "PC";
  if (["PEÇA", "PECA", "PÇ", "PCA"].includes(normalized)) return "PC";
  return normalized;
}

export function SalesOrderClientDocument({
  order,
  branding,
  issuedAt,
}: {
  order: SalesOrderClientDocumentOrder;
  branding: BrandingSettingsDTO;
  issuedAt: string;
}) {
  const customer = order.Customer;
  const customerName =
    nonEmpty(customer?.companyName) || nonEmpty(customer?.tradeName) || "—";
  const statusLabel = STATUS_LABELS[order.status] ?? order.status;

  const freightLabel = useMemo(() => {
    const fc = nonEmpty(order.freightCondition) ?? "";
    if (fc === "CIF") return "CIF (frete por conta do emitente)";
    if (fc === "FOB") return "FOB (frete por conta do destinatário)";
    return fc || "—";
  }, [order.freightCondition]);

  const hasDiscount = Math.abs(safeNum(order.totalDiscount)) > 0.000001;
  const deliveryLine = order.expectedDeliveryDate
    ? formatPrintDate(order.expectedDeliveryDate)
    : "—";

  return (
    <PrintDocumentShell className="sales-order-print-document proposal-compact-document proposal-print-sheet mx-auto w-full max-w-[1180px] border border-slate-300 bg-white text-slate-800 shadow-sm print:max-w-none print:border-0 print:shadow-none">
      <div className="proposal-print-document-inner p-4 text-xs leading-snug md:p-5 md:text-[13px] print:p-3">
        <h1 className="sr-only">Pedido de venda {order.orderCode}</h1>

        <PrintHeader
          branding={branding}
          documentTitle="PEDIDO"
          documentHighlight={order.orderCode}
          metaLines={[
            { label: "Data", value: issuedAt },
            { label: "Vendedor", value: order.responsible?.trim() || "—" },
            { label: "Cliente", value: customerName },
            { label: "Status", value: statusLabel },
          ]}
          className="proposal-compact-header proposal-print-section"
        />

        <PrintSection title="Dados do cliente" className="proposal-compact-section proposal-print-section mt-4">
          <div className="mt-2 border-y border-slate-200 py-2 text-[11px] sm:text-xs">
            <p className="font-semibold text-slate-900">{customerName}</p>
            {customer?.taxId ? (
              <p>
                <span className="font-semibold text-slate-600">CNPJ: </span>
                {customer.taxId}
              </p>
            ) : null}
            {customer?.address ? <p>{customer.address}</p> : null}
            {[customer?.city, customer?.state].filter(Boolean).length > 0 ? (
              <p>
                {[customer?.city, customer?.state].filter(Boolean).join(" - ")}
                {customer?.zipCode ? ` · CEP ${customer.zipCode}` : ""}
              </p>
            ) : null}
            {customer?.phone ? (
              <p>
                <span className="font-semibold text-slate-600">Tel.: </span>
                {customer.phone}
              </p>
            ) : null}
          </div>
        </PrintSection>

        <PrintSection title="Totais do pedido" className="proposal-compact-section proposal-print-section mt-4">
          <table className="mt-2 w-full border-collapse text-[11px] sm:text-xs">
            <tbody>
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Valor bruto</th>
                <td className="py-1 text-right font-mono">{formatMoney(order.totalGrossValue)}</td>
              </tr>
              {hasDiscount ? (
                <tr className="border-b border-slate-100">
                  <th className="py-1 text-left font-semibold text-slate-600">Desconto</th>
                  <td className="py-1 text-right font-mono">{formatMoney(order.totalDiscount)}</td>
                </tr>
              ) : null}
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Valor líquido</th>
                <td className="py-1 text-right font-mono font-bold text-slate-900">
                  {formatMoney(order.totalNetValue)}
                </td>
              </tr>
              {safeNum(order.totalFreight) > 0 ? (
                <tr>
                  <th className="py-1 text-left font-semibold text-slate-600">Frete</th>
                  <td className="py-1 text-right font-mono">{formatMoney(order.totalFreight)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </PrintSection>

        <PrintSection
          title="Itens do pedido"
          flow
          className="proposal-print-items-section proposal-compact-section proposal-print-section mt-5"
        >
          <div className="proposal-print-table-wrap mt-2 overflow-visible">
            <table className="proposal-compact-table w-full border-collapse border border-slate-300 text-[10px] sm:text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-[9px] uppercase tracking-wide text-slate-700 sm:text-[10px]">
                  <th className="proposal-col-item border border-slate-300 px-1 py-1">Item</th>
                  <th className="proposal-col-code border border-slate-300 px-1 py-1">Código</th>
                  <th className="proposal-col-description border border-slate-300 px-1 py-1">Descrição</th>
                  <th className="proposal-col-unit border border-slate-300 px-1 py-1">Un.</th>
                  <th className="proposal-col-qty border border-slate-300 px-1 py-1 text-right">Qtd</th>
                  <th className="proposal-col-unit-price border border-slate-300 px-1 py-1 text-right">
                    Preço unit.
                  </th>
                  <th className="proposal-col-total border border-slate-300 px-1 py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item, index) => (
                  <tr key={item.id} className="border-b border-slate-200">
                    <td className="proposal-cell-item px-1.5 py-1 font-mono">{formatItemLineNo(index)}</td>
                    <td className="proposal-cell-code px-1.5 py-1 font-mono">{item.skuSnapshot}</td>
                    <td className="proposal-cell-description px-1.5 py-1">{item.productNameSnapshot}</td>
                    <td className="proposal-cell-unit px-1.5 py-1">{formatUnit(item.unit)}</td>
                    <td className="proposal-cell-qty px-1.5 py-1 text-right font-mono">
                      {formatQty(item.quantity)}
                    </td>
                    <td className="proposal-cell-money px-1.5 py-1 text-right font-mono">
                      {formatMoney(item.negotiatedPrice)}
                    </td>
                    <td className="proposal-cell-money px-1.5 py-1 text-right font-mono font-semibold">
                      {formatMoney(item.totalNetValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PrintSection>

        <PrintSection title="Condições comerciais" className="proposal-compact-section proposal-print-section mt-5">
          <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2 sm:text-xs">
            <p>
              <span className="font-semibold text-slate-600">Pagamento: </span>
              {order.paymentTerms || "—"}
              {order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Frete: </span>
              {freightLabel}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Entrega prevista: </span>
              {deliveryLine}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Local de entrega: </span>
              {order.deliveryLocation || "—"}
            </p>
          </div>
        </PrintSection>

        {order.notes ? (
          <PrintSection title="Observações" className="proposal-compact-section proposal-print-section mt-5">
            <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700 sm:text-xs">{order.notes}</p>
          </PrintSection>
        ) : null}

        <div className="proposal-compact-footer proposal-print-section mt-6 flex flex-col justify-between gap-1 border-t border-slate-300 pt-2 text-[10px] text-slate-600 sm:flex-row sm:text-[11px]">
          <p>{branding.companyName}</p>
          <p>Documento gerado pelo IndusCost · {issuedAt}</p>
        </div>
      </div>
    </PrintDocumentShell>
  );
}
