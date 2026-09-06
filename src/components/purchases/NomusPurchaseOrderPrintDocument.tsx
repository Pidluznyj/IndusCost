import React from "react";
import { PrintDocumentShell } from "@/src/components/print/PrintDocumentShell";
import { PrintHeader } from "@/src/components/print/PrintHeader";
import { PrintSection } from "@/src/components/print/PrintSection";
import { formatPrintDate, formatPrintDateTime } from "@/src/lib/printBranding";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import type { NomusPurchaseOrder360Detail } from "@/src/lib/nomus/nomusPurchaseOrder360Client";
import {
  nomusPurchaseOrderFinancialLabel,
  nomusPurchaseOrderStageLabel,
} from "@/src/lib/nomus/nomusPurchaseOrderUi";
import "@/src/sales-order-print.css";
import "@/src/proposal-print.css";

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoney(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}

function formatPrintDateLoose(value: string | null | undefined): string {
  if (!value) return "—";
  const printed = formatPrintDate(value);
  if (printed !== "—") return printed;
  return /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value : "—";
}

function formatUnit(unit?: string | null, unitId?: number | null): string {
  const normalized = String(unit ?? "").trim().toUpperCase();
  if (normalized) {
    if (["PEÇA", "PECA", "PÇ", "PCA"].includes(normalized)) return "PC";
    return normalized;
  }
  return unitId != null ? `#${unitId}` : "—";
}

function lineTotal(item: NomusPurchaseOrder360Detail["items"][number]): number | null {
  if (item.totalAmount != null && Number.isFinite(item.totalAmount)) return item.totalAmount;
  return null;
}

export function NomusPurchaseOrderPrintDocument({
  payload,
  branding,
}: {
  payload: NomusPurchaseOrder360Detail;
  branding: BrandingSettingsDTO;
}): React.ReactElement {
  const { order, supplier, items, plannedInstallments, receiving, fiscal, financialSummary, confirmedPayables } =
    payload;
  const header = order.header ?? {};
  const orderCode = order.orderNumber ?? `Nomus #${order.externalId}`;
  const supplierName =
    nonEmpty(supplier.resolvedName) ||
    nonEmpty(supplier.nomusName) ||
    (supplier.nomusExternalId != null ? `Fornecedor Nomus #${supplier.nomusExternalId}` : "—");
  const supplierDocument = nonEmpty(supplier.resolvedDocument) || nonEmpty(supplier.nomusDocument);
  const issuedAt = formatPrintDateLoose(order.issuedAt);
  const deliveryLine = formatPrintDateLoose(order.expectedAt);
  const buyer = header.buyerPersonId != null ? String(header.buyerPersonId) : "—";
  const paymentTerms = nonEmpty(header.paymentConditionText) || nonEmpty(order.paymentTerms) || "—";
  const paymentMethod = header.paymentMethodId != null ? String(header.paymentMethodId) : "";
  const notes = nonEmpty(header.comments) || nonEmpty(order.comments);
  const freight = header.freightAmount;
  const insurance = header.insuranceAmount;
  const extras = header.otherExpensesAmount;
  const itemsTotal = items.reduce((sum, item) => sum + (lineTotal(item) ?? 0), 0);
  const hasItemTotals = items.some((item) => lineTotal(item) != null);

  return (
    <PrintDocumentShell
      rootId="npo-detail-print-root"
      className="sales-order-print-document proposal-compact-document proposal-print-sheet mx-auto w-full max-w-[1180px] border border-slate-300 bg-white text-slate-800 shadow-sm print:max-w-none print:border-0 print:shadow-none"
    >
      <div className="proposal-print-document-inner p-4 text-xs leading-snug md:p-5 md:text-[13px] print:p-3">
        <h1 className="sr-only">Pedido de compra {orderCode}</h1>

        <PrintHeader
          branding={branding}
          documentKind="Compras · Pedidos Nomus"
          documentTitle="PEDIDO DE COMPRA"
          documentHighlight={orderCode}
          metaLines={[
            { label: "Data", value: issuedAt },
            { label: "Comprador", value: buyer },
            { label: "Fornecedor", value: supplierName },
            { label: "Status", value: nomusPurchaseOrderStageLabel(order.stage) },
          ]}
          className="proposal-compact-header proposal-print-section"
        />

        <PrintSection title="Dados do fornecedor" className="proposal-compact-section proposal-print-section mt-4">
          <div className="mt-2 border-y border-slate-200 py-2 text-[11px] sm:text-xs">
            <p className="font-semibold text-slate-900">{supplierName}</p>
            {supplierDocument ? (
              <p>
                <span className="font-semibold text-slate-600">CNPJ: </span>
                {supplierDocument}
              </p>
            ) : null}
            {supplier.nomusExternalId != null ? (
              <p>
                <span className="font-semibold text-slate-600">ID Nomus: </span>
                {supplier.nomusExternalId}
              </p>
            ) : null}
          </div>
        </PrintSection>

        <PrintSection title="Totais do pedido" className="proposal-compact-section proposal-print-section mt-4">
          <table className="mt-2 w-full border-collapse text-[11px] sm:text-xs">
            <tbody>
              {hasItemTotals ? (
                <tr className="border-b border-slate-100">
                  <th className="py-1 text-left font-semibold text-slate-600">Itens</th>
                  <td className="py-1 text-right font-mono">{formatMoney(itemsTotal)}</td>
                </tr>
              ) : null}
              {safeNum(freight) > 0 ? (
                <tr className="border-b border-slate-100">
                  <th className="py-1 text-left font-semibold text-slate-600">Frete</th>
                  <td className="py-1 text-right font-mono">{formatMoney(freight)}</td>
                </tr>
              ) : null}
              {safeNum(insurance) > 0 ? (
                <tr className="border-b border-slate-100">
                  <th className="py-1 text-left font-semibold text-slate-600">Seguro</th>
                  <td className="py-1 text-right font-mono">{formatMoney(insurance)}</td>
                </tr>
              ) : null}
              {safeNum(extras) > 0 ? (
                <tr className="border-b border-slate-100">
                  <th className="py-1 text-left font-semibold text-slate-600">Despesas acessórias</th>
                  <td className="py-1 text-right font-mono">{formatMoney(extras)}</td>
                </tr>
              ) : null}
              <tr className="border-b border-slate-100">
                <th className="py-1 text-left font-semibold text-slate-600">Total das parcelas planejadas</th>
                <td className="py-1 text-right font-mono font-bold text-slate-900">
                  {formatMoney(financialSummary.plannedInstallmentsTotal)}
                </td>
              </tr>
              <tr>
                <th className="py-1 text-left font-semibold text-slate-600">Situação financeira</th>
                <td className="py-1 text-right">
                  {nomusPurchaseOrderFinancialLabel(financialSummary.financialStatus)}
                </td>
              </tr>
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
                {items.map((item, index) => (
                  <tr key={item.id} className="border-b border-slate-200">
                    <td className="proposal-cell-item px-1.5 py-1 font-mono">
                      {item.lineCode ?? String((index + 1) * 10).padStart(5, "0")}
                    </td>
                    <td className="proposal-cell-code px-1.5 py-1 font-mono">
                      {item.productCode ?? (item.productExternalId != null ? `#${item.productExternalId}` : "—")}
                    </td>
                    <td className="proposal-cell-description px-1.5 py-1">{item.description ?? "—"}</td>
                    <td className="proposal-cell-unit px-1.5 py-1">{formatUnit(item.unit, item.unitId)}</td>
                    <td className="proposal-cell-qty px-1.5 py-1 text-right font-mono">
                      {formatQty(item.orderedQuantity)}
                    </td>
                    <td className="proposal-cell-money px-1.5 py-1 text-right font-mono">
                      {formatMoney(item.unitPrice)}
                    </td>
                    <td className="proposal-cell-money px-1.5 py-1 text-right font-mono font-semibold">
                      {formatMoney(lineTotal(item))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!receiving.receivingQuantityAvailable ? (
            <p className="mt-2 text-[10px] text-slate-600">
              Quantidade recebida não informada pela API. Status 4 não inventa quantidade recebida.
            </p>
          ) : null}
        </PrintSection>

        <PrintSection title="Condições comerciais" className="proposal-compact-section proposal-print-section mt-5">
          <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2 sm:text-xs">
            <p>
              <span className="font-semibold text-slate-600">Pagamento: </span>
              {paymentTerms}
              {paymentMethod ? ` · ${paymentMethod}` : ""}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Frete: </span>
              {formatMoney(freight) !== "—" && safeNum(freight) > 0 ? formatMoney(freight) : "—"}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Entrega prevista: </span>
              {deliveryLine}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Transportadora: </span>
              {header.carrierPersonId != null ? String(header.carrierPersonId) : "—"}
            </p>
          </div>
        </PrintSection>

        {notes ? (
          <PrintSection title="Observações" className="proposal-compact-section proposal-print-section mt-5">
            <p className="mt-2 whitespace-pre-wrap text-[11px] text-slate-700 sm:text-xs">{notes}</p>
          </PrintSection>
        ) : null}

        <PrintSection title="Recebimento" className="proposal-compact-section proposal-print-section mt-5">
          <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2 sm:text-xs">
            <p>
              <span className="font-semibold text-slate-600">Estágio: </span>
              {nomusPurchaseOrderStageLabel(receiving.stage)}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Aguardando / liberados: </span>
              {receiving.waitingRelease} / {receiving.released}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Parciais / recebidos: </span>
              {receiving.partial} / {receiving.received}
            </p>
            <p>
              <span className="font-semibold text-slate-600">Com corte / cancelados: </span>
              {receiving.receivedWithCut} / {receiving.canceled}
            </p>
          </div>
        </PrintSection>

        <PrintSection
          title="NF-e vinculadas"
          flow
          className="proposal-print-items-section proposal-compact-section proposal-print-section mt-5"
        >
          {fiscal.invoices.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-700 sm:text-xs">
              {fiscal.unresolvedLabel ??
                "Nenhuma NF-e vinculada foi identificada pelos dados disponíveis."}
            </p>
          ) : (
            <div className="proposal-print-table-wrap mt-2 overflow-visible">
              <table className="proposal-compact-table w-full border-collapse border border-slate-300 text-[10px] sm:text-[11px]">
                <thead>
                  <tr className="bg-slate-100 text-[9px] uppercase tracking-wide text-slate-700 sm:text-[10px]">
                    <th className="border border-slate-300 px-1 py-1">ID</th>
                    <th className="border border-slate-300 px-1 py-1">Número</th>
                    <th className="border border-slate-300 px-1 py-1">Série</th>
                    <th className="border border-slate-300 px-1 py-1">Emissão</th>
                    <th className="border border-slate-300 px-1 py-1 text-right">Valor</th>
                    <th className="border border-slate-300 px-1 py-1">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {fiscal.invoices.map((nfe) => (
                    <tr key={nfe.externalId} className="border-b border-slate-200">
                      <td className="px-1.5 py-1 font-mono">{nfe.externalId}</td>
                      <td className="px-1.5 py-1">{nfe.number ?? (nfe.foundLocally ? "—" : "ID sem registro local")}</td>
                      <td className="px-1.5 py-1">{nfe.series ?? "—"}</td>
                      <td className="px-1.5 py-1">{formatPrintDateLoose(nfe.issuedAt ?? nfe.processedAt)}</td>
                      <td className="px-1.5 py-1 text-right font-mono">{formatMoney(nfe.amount)}</td>
                      <td className="px-1.5 py-1">{nfe.canceled ? "Cancelada" : nfe.status ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PrintSection>

        <PrintSection
          title="Parcelas planejadas no pedido"
          flow
          className="proposal-print-items-section proposal-compact-section proposal-print-section mt-5"
        >
          <p className="mt-2 text-[11px] text-slate-700 sm:text-xs">
            Total das parcelas planejadas: {formatMoney(financialSummary.plannedInstallmentsTotal)} ·{" "}
            {financialSummary.plannedInstallmentsCount} parcela(s). Não são títulos de Contas a Pagar.
          </p>
          <div className="proposal-print-table-wrap mt-2 overflow-visible">
            <table className="proposal-compact-table w-full border-collapse border border-slate-300 text-[10px] sm:text-[11px]">
              <thead>
                <tr className="bg-slate-100 text-[9px] uppercase tracking-wide text-slate-700 sm:text-[10px]">
                  <th className="border border-slate-300 px-1 py-1">Parcela</th>
                  <th className="border border-slate-300 px-1 py-1">Vencimento</th>
                  <th className="border border-slate-300 px-1 py-1 text-right">Valor</th>
                  <th className="border border-slate-300 px-1 py-1">Forma</th>
                  <th className="border border-slate-300 px-1 py-1">Adiantamento</th>
                </tr>
              </thead>
              <tbody>
                {plannedInstallments.map((row) => (
                  <tr key={row.index} className="border-b border-slate-200">
                    <td className="px-1.5 py-1">{row.index + 1}</td>
                    <td className="px-1.5 py-1">
                      {formatPrintDateLoose(row.dueDate) !== "—"
                        ? formatPrintDateLoose(row.dueDate)
                        : row.dueDateRaw ?? "—"}
                    </td>
                    <td className="px-1.5 py-1 text-right font-mono">{formatMoney(row.amount)}</td>
                    <td className="px-1.5 py-1">{row.paymentMethodId != null ? `#${row.paymentMethodId}` : "—"}</td>
                    <td className="px-1.5 py-1">
                      {row.generatesAdvance == null ? "—" : row.generatesAdvance ? "Sim" : "Não"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PrintSection>

        <PrintSection
          title="Contas a Pagar confirmadas"
          flow
          className="proposal-print-items-section proposal-compact-section proposal-print-section mt-5"
        >
          <p className="mt-2 text-[11px] text-slate-700 sm:text-xs">
            Confirmado {formatMoney(financialSummary.confirmedAmount)} · pago{" "}
            {formatMoney(financialSummary.paidAmount)} · saldo {formatMoney(financialSummary.openAmount)} ·{" "}
            {financialSummary.count} título(s).
          </p>
          {confirmedPayables.length === 0 ? (
            <p className="mt-2 text-[11px] text-slate-700 sm:text-xs">
              Nenhuma Conta a Pagar confirmada foi identificada. O mesmo fornecedor, sozinho, não gera
              vínculo.
            </p>
          ) : (
            <div className="proposal-print-table-wrap mt-2 overflow-visible">
              <table className="proposal-compact-table w-full border-collapse border border-slate-300 text-[10px] sm:text-[11px]">
                <thead>
                  <tr className="bg-slate-100 text-[9px] uppercase tracking-wide text-slate-700 sm:text-[10px]">
                    <th className="border border-slate-300 px-1 py-1">Título</th>
                    <th className="border border-slate-300 px-1 py-1">NF origem</th>
                    <th className="border border-slate-300 px-1 py-1">Vencimento</th>
                    <th className="border border-slate-300 px-1 py-1 text-right">Valor</th>
                    <th className="border border-slate-300 px-1 py-1 text-right">Pago</th>
                    <th className="border border-slate-300 px-1 py-1 text-right">Saldo</th>
                    <th className="border border-slate-300 px-1 py-1">Forma</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmedPayables.map((row) => (
                    <tr key={row.externalId} className="border-b border-slate-200">
                      <td className="px-1.5 py-1 font-mono">{row.externalId}</td>
                      <td className="px-1.5 py-1">{row.sourceInvoiceNumber ?? "—"}</td>
                      <td className="px-1.5 py-1">{formatPrintDateLoose(row.dueDate)}</td>
                      <td className="px-1.5 py-1 text-right font-mono">{formatMoney(row.amountPayable)}</td>
                      <td className="px-1.5 py-1 text-right font-mono">{formatMoney(row.amountPaid)}</td>
                      <td className="px-1.5 py-1 text-right font-mono">{formatMoney(row.balancePayable)}</td>
                      <td className="px-1.5 py-1">{row.paymentMethodName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PrintSection>

        <div className="proposal-compact-footer proposal-print-section mt-6 flex flex-col justify-between gap-1 border-t border-slate-300 pt-2 text-[10px] text-slate-600 sm:flex-row sm:text-[11px]">
          <p>{branding.companyName}</p>
          <p>
            Documento gerado pelo IndusCost · {formatPrintDateTime(new Date().toISOString())}
            {payload.syncMetadata.syncedAt
              ? ` · sync ${formatPrintDateTime(payload.syncMetadata.syncedAt)}`
              : ""}
          </p>
        </div>
      </div>
    </PrintDocumentShell>
  );
}
