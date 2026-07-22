/**
 * Documento PDF do Pedido de Compra — reutiliza layout portrait existente.
 */
import {
  buildFormattedPortraitPdf,
  formatPdfMoneyBr,
  formatPdfNumberBr,
  type PdfLine,
} from "../proposalInternalManagementPdfLayout.js";

export type PurchaseOrderPdfInput = {
  code: string;
  status: string;
  supplierName: string;
  supplierDocument: string | null;
  currency: string;
  quotationCode: string | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  freightValue: number | null;
  taxes: number | null;
  discounts: number | null;
  leadTimeDays: number | null;
  totalAmount: number | null;
  initialComparable: number | null;
  negotiatedComparable: number | null;
  totalGain: number | null;
  awardJustification: string | null;
  evidenceCount: number;
  operationalCommitmentAt: string | null;
  futureEntryPending: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  notes: string | null;
  items: Array<{
    lineNumber: number;
    description: string;
    materialCode: string | null;
    quantity: number;
    unit: string;
    initialUnitPrice: number | null;
    negotiatedUnitPrice: number;
    lineTotal: number;
    lineGain: number | null;
  }>;
};

export function buildPurchaseOrderPdfLines(po: PurchaseOrderPdfInput): PdfLine[] {
  const lines: PdfLine[] = [
    { type: "title", text: `Pedido de Compra ${po.code}` },
    { type: "subtitle", text: `Status: ${po.status}` },
    { type: "kv", label: "Fornecedor", value: po.supplierName },
    { type: "kv", label: "Documento", value: po.supplierDocument || "-" },
    { type: "kv", label: "Moeda", value: po.currency },
    { type: "kv", label: "Cotacao", value: po.quotationCode || "-" },
    { type: "kv", label: "Evidencias", value: String(po.evidenceCount) },
    { type: "kv", label: "Pagamento", value: po.paymentTerms || "-" },
    { type: "kv", label: "Entrega", value: po.deliveryTerms || "-" },
    {
      type: "kv",
      label: "Prazo",
      value: po.leadTimeDays != null ? `${po.leadTimeDays} dias` : "-",
    },
    { type: "spacer" },
    { type: "subtitle", text: "Itens (snapshots congelados)" },
    {
      type: "table",
      headers: ["#", "Item", "Qtd", "Inicial", "Negoc.", "Total", "Ganho"],
      rows: po.items.map((it) => [
        String(it.lineNumber),
        `${it.materialCode ? `${it.materialCode} ` : ""}${it.description}`.slice(0, 40),
        `${formatPdfNumberBr(it.quantity)} ${it.unit}`,
        formatPdfMoneyBr(it.initialUnitPrice),
        formatPdfMoneyBr(it.negotiatedUnitPrice),
        formatPdfMoneyBr(it.lineTotal),
        formatPdfMoneyBr(it.lineGain),
      ]),
      colWidths: [28, 160, 70, 70, 70, 70, 70],
    },
    { type: "spacer" },
    { type: "subtitle", text: "Totais e ganho" },
    { type: "kv", label: "Frete", value: formatPdfMoneyBr(po.freightValue) },
    { type: "kv", label: "Impostos NR", value: formatPdfMoneyBr(po.taxes) },
    { type: "kv", label: "Descontos", value: formatPdfMoneyBr(po.discounts) },
    { type: "kv", label: "Comparavel inicial", value: formatPdfMoneyBr(po.initialComparable) },
    { type: "kv", label: "Negociado", value: formatPdfMoneyBr(po.negotiatedComparable) },
    { type: "kv", label: "Ganho", value: formatPdfMoneyBr(po.totalGain) },
    { type: "kv", label: "Total pedido", value: formatPdfMoneyBr(po.totalAmount) },
    { type: "spacer" },
    { type: "banner", text: "Compromisso operacional sem estoque e sem Contas a Pagar." },
    {
      type: "kv",
      label: "Compromisso",
      value: po.operationalCommitmentAt || "Pendente",
    },
    {
      type: "kv",
      label: "Entrada futura",
      value: po.futureEntryPending ? "Pendente" : "Nao",
    },
  ];

  if (po.awardJustification) {
    lines.push({ type: "spacer" });
    lines.push({ type: "subtitle", text: "Justificativa" });
    lines.push({ type: "text", text: po.awardJustification });
  }
  if (po.approvedAt) {
    lines.push({
      type: "kv",
      label: "Aprovado",
      value: `${po.approvedAt}${po.approvedBy ? ` por ${po.approvedBy}` : ""}`,
    });
  }
  if (po.notes) {
    lines.push({ type: "text", text: `Obs.: ${po.notes}` });
  }

  return lines;
}

export function buildPurchaseOrderPdfBuffer(po: PurchaseOrderPdfInput): Buffer {
  return buildFormattedPortraitPdf({
    title: `Pedido de Compra ${po.code}`,
    lines: buildPurchaseOrderPdfLines(po),
  });
}
