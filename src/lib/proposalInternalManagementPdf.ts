/**
 * PDF gerencial interno da proposta comercial.
 * Usa dados próprios da Proposal/ProposalItem (custo, margem, comissão já gravados).
 * Não altera PDF cliente nem motor de comissão realizada.
 */

import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";

export const PROPOSAL_INTERNAL_MANAGEMENT_PDF_API =
  "/api/proposals/:proposalId/internal-management-pdf" as const;

export const PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL = "PDF gerencial interno";

export const PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK =
  "Documento interno e confidencial. Nao compartilhar com clientes.";

export function buildProposalInternalManagementPdfApiPath(proposalId: string): string {
  return `/api/proposals/${encodeURIComponent(proposalId)}/internal-management-pdf`;
}

export type ProposalInternalManagementPdfItemInput = {
  sku?: string | null;
  name?: string | null;
  quantity: number | string | null;
  unit?: string | null;
  unitCost: number | string | null;
  negotiatedPrice: number | string | null;
  suggestedPrice?: number | string | null;
  marginValue: number | string | null;
  marginPerc: number | string | null;
  commissionPerc: number | string | null;
  commissionValue: number | string | null;
  taxesValue?: number | string | null;
  freightValue?: number | string | null;
  notes?: string | null;
};

export type ProposalInternalManagementPdfInput = {
  id: string;
  number: number | null;
  title?: string | null;
  status?: string | null;
  responsible?: string | null;
  companyIssuer?: string | null;
  validityDays?: number | null;
  paymentTerms?: string | null;
  paymentMethod?: string | null;
  freightCondition?: string | null;
  deliveryLocation?: string | null;
  notes?: string | null;
  internalNotes?: string | null;
  createdAt?: string | Date | null;
  customerName?: string | null;
  customerDocument?: string | null;
  totalGrossValue: number | string | null;
  totalDiscount: number | string | null;
  totalNetValue: number | string | null;
  totalCost: number | string | null;
  totalMarginValue: number | string | null;
  totalMarginPerc: number | string | null;
  totalTaxes: number | string | null;
  totalCommission: number | string | null;
  totalFreight: number | string | null;
  items: ProposalInternalManagementPdfItemInput[];
};

export type ProposalInternalManagementPdfItemRow = {
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  unitCost: number;
  totalCost: number;
  marginValue: number;
  marginPerc: number;
  commissionValue: number;
  commissionPerc: number;
  notes: string | null;
  costIncomplete: boolean;
  marginMissing: boolean;
  commissionPending: boolean;
};

export type ProposalInternalManagementPdfDocument = {
  title: string;
  confidentialMark: string;
  proposalCode: string;
  proposalTitle: string;
  customerName: string;
  customerDocument: string | null;
  status: string;
  responsible: string;
  issuer: string;
  issuedAtLabel: string;
  validityDays: number | null;
  paymentTerms: string | null;
  paymentMethod: string | null;
  freightCondition: string | null;
  deliveryLocation: string | null;
  commercialNotes: string | null;
  internalNotes: string | null;
  totals: {
    gross: number;
    discount: number;
    net: number;
    cost: number;
    marginValue: number;
    marginPerc: number;
    markup: number | null;
    taxes: number;
    commission: number;
    freight: number;
  };
  commissionSummaryLabel: string;
  items: ProposalInternalManagementPdfItemRow[];
  pendencies: string[];
  generatedAt: string;
};

function n(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  const num = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : fallback;
}

function text(value: unknown, fallback = "—"): string {
  if (value == null) return fallback;
  const s = String(value).trim();
  return s || fallback;
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

function formatMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

function formatDateLabel(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

function slugPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "proposta";
}

export function buildProposalInternalManagementPdfFilename(input: {
  proposalNumber: number | null;
  customerName?: string | null;
}): string {
  const code =
    input.proposalNumber != null && Number.isFinite(input.proposalNumber)
      ? `CP-${input.proposalNumber}`
      : "proposta";
  const customer = slugPart(input.customerName ?? "cliente");
  return `proposta-gerencial-interna-${code}-${customer}.pdf`;
}

export function buildProposalInternalManagementPdfDocument(
  input: ProposalInternalManagementPdfInput
): ProposalInternalManagementPdfDocument {
  const items = Array.isArray(input.items) ? input.items : [];
  const net = n(input.totalNetValue);
  const cost = n(input.totalCost);
  const marginValue = n(input.totalMarginValue);
  const marginPerc = n(input.totalMarginPerc);
  const commission = n(input.totalCommission);
  const markup = cost > 0 ? net / cost : null;

  const rows: ProposalInternalManagementPdfItemRow[] = items.map((item) => {
    const quantity = n(item.quantity);
    const unitCost = n(item.unitCost);
    const unitPrice = n(item.negotiatedPrice);
    const totalPrice = quantity * unitPrice;
    const totalCost = quantity * unitCost;
    const itemMargin = n(item.marginValue);
    const itemMarginPerc = n(item.marginPerc);
    const itemCommission = n(item.commissionValue);
    const itemCommissionPerc = n(item.commissionPerc);
    const costIncomplete = !(unitCost > 0);
    const marginMissing = !(itemMargin !== 0 || itemMarginPerc !== 0) && totalPrice > 0 && costIncomplete;
    const commissionPending = !(itemCommission > 0 || itemCommissionPerc > 0);
    return {
      code: text(item.sku, "s/ codigo"),
      name: text(item.name, "Item sem nome"),
      quantity,
      unit: text(item.unit, "UN"),
      unitPrice,
      totalPrice,
      unitCost,
      totalCost,
      marginValue: itemMargin,
      marginPerc: itemMarginPerc,
      commissionValue: itemCommission,
      commissionPerc: itemCommissionPerc,
      notes: item.notes?.trim() ? item.notes.trim() : null,
      costIncomplete,
      marginMissing,
      commissionPending,
    };
  });

  const pendencies: string[] = [];
  const incompleteCostItems = rows.filter((row) => row.costIncomplete);
  if (incompleteCostItems.length > 0) {
    pendencies.push(
      `${incompleteCostItems.length} item(ns) com custo incompleto ou zerado.`
    );
  }
  const missingMargin = rows.filter((row) => row.marginMissing);
  if (missingMargin.length > 0) {
    pendencies.push(`${missingMargin.length} item(ns) sem margem calculavel.`);
  }
  if (!(commission > 0) && rows.every((row) => row.commissionPending)) {
    pendencies.push("Comissao estimada nao informada na proposta (exibir como pendente).");
  }
  if (cost <= 0 && rows.length > 0) {
    pendencies.push("Custo total da proposta ausente ou zerado.");
  }

  const commissionSummaryLabel =
    commission > 0
      ? formatMoney(commission)
      : "Pendente: comissao nao informada na proposta";

  const proposalCode =
    input.number != null && Number.isFinite(Number(input.number))
      ? `CP ${input.number}`
      : "Proposta";

  return {
    title: "Proposta Comercial — Relatorio Gerencial Interno",
    confidentialMark: PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK,
    proposalCode,
    proposalTitle: text(input.title, "Sem titulo"),
    customerName: text(input.customerName, "Cliente nao informado"),
    customerDocument: input.customerDocument?.trim() || null,
    status: text(input.status, "—"),
    responsible: text(input.responsible, "Nao informado"),
    issuer: text(input.companyIssuer, "Nao informado"),
    issuedAtLabel: formatDateLabel(input.createdAt),
    validityDays:
      input.validityDays != null && Number.isFinite(Number(input.validityDays))
        ? Number(input.validityDays)
        : null,
    paymentTerms: input.paymentTerms?.trim() || null,
    paymentMethod: input.paymentMethod?.trim() || null,
    freightCondition: input.freightCondition?.trim() || null,
    deliveryLocation: input.deliveryLocation?.trim() || null,
    commercialNotes: input.notes?.trim() || null,
    internalNotes: input.internalNotes?.trim() || null,
    totals: {
      gross: n(input.totalGrossValue),
      discount: n(input.totalDiscount),
      net,
      cost,
      marginValue,
      marginPerc,
      markup,
      taxes: n(input.totalTaxes),
      commission,
      freight: n(input.totalFreight),
    },
    commissionSummaryLabel,
    items: rows,
    pendencies,
    generatedAt: new Date().toISOString(),
  };
}

export function buildProposalInternalManagementPdfBuffer(
  doc: ProposalInternalManagementPdfDocument
): Buffer {
  const lines: string[] = [
    doc.confidentialMark,
    "",
    "=== CAPA / IDENTIFICACAO ===",
    `Proposta: ${doc.proposalCode}`,
    `Titulo: ${doc.proposalTitle}`,
    `Cliente: ${doc.customerName}`,
    doc.customerDocument ? `Documento cliente: ${doc.customerDocument}` : "Documento cliente: —",
    `Status: ${doc.status}`,
    `Responsavel comercial: ${doc.responsible}`,
    `Empresa emissora: ${doc.issuer}`,
    `Data: ${doc.issuedAtLabel}`,
    doc.validityDays != null ? `Validade: ${doc.validityDays} dia(s)` : "Validade: —",
    "",
    "=== RESUMO EXECUTIVO INTERNO ===",
    `Valor bruto: ${formatMoney(doc.totals.gross)}`,
    `Desconto: ${formatMoney(doc.totals.discount)}`,
    `Valor liquido / preco final proposto: ${formatMoney(doc.totals.net)}`,
    `Custo total estimado: ${formatMoney(doc.totals.cost)}`,
    `Margem bruta: ${formatMoney(doc.totals.marginValue)} (${formatPercent(doc.totals.marginPerc)})`,
    `Markup (venda/custo): ${
      doc.totals.markup != null
        ? doc.totals.markup.toLocaleString("pt-BR", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 4,
          })
        : "pendente"
    }`,
    `Impostos estimados: ${formatMoney(doc.totals.taxes)}`,
    `Comissao estimada: ${doc.commissionSummaryLabel}`,
    `Frete: ${formatMoney(doc.totals.freight)}`,
    doc.paymentTerms ? `Condicao de pagamento: ${doc.paymentTerms}` : "Condicao de pagamento: —",
    doc.paymentMethod ? `Forma de pagamento: ${doc.paymentMethod}` : "Forma de pagamento: —",
    doc.freightCondition ? `Frete: ${doc.freightCondition}` : null,
    doc.deliveryLocation ? `Local de entrega: ${doc.deliveryLocation}` : null,
    "",
    "=== ITENS / PRODUTOS ===",
  ].filter((line): line is string => line != null);

  if (doc.items.length === 0) {
    lines.push("Nenhum item na proposta.");
  } else {
    doc.items.forEach((item, index) => {
      lines.push(
        `${index + 1}. ${item.code} — ${item.name} | Qtd ${item.quantity} ${item.unit}`
      );
      lines.push(
        `   Preco unit ${formatMoney(item.unitPrice)} | Preco total ${formatMoney(item.totalPrice)}`
      );
      lines.push(
        `   Custo unit ${formatMoney(item.unitCost)} | Custo total ${formatMoney(item.totalCost)}`
      );
      lines.push(
        `   Margem ${formatMoney(item.marginValue)} (${formatPercent(item.marginPerc)}) | Comissao ${
          item.commissionPending && !(item.commissionValue > 0)
            ? "pendente"
            : `${formatMoney(item.commissionValue)} (${formatPercent(item.commissionPerc)})`
        }`
      );
      if (item.costIncomplete) lines.push("   ALERTA: custo incompleto.");
      if (item.marginMissing) lines.push("   ALERTA: margem ausente.");
      if (item.notes) lines.push(`   Obs.: ${item.notes}`);
    });
  }

  lines.push("", "=== OBSERVACOES GERENCIAIS ===");
  if (doc.pendencies.length === 0) {
    lines.push("Nenhuma pendencia critica identificada nos dados da proposta.");
  } else {
    doc.pendencies.forEach((p) => lines.push(`- ${p}`));
  }
  if (doc.internalNotes) {
    lines.push(`Notas internas: ${doc.internalNotes}`);
  }
  if (doc.commercialNotes) {
    lines.push(`Notas comerciais: ${doc.commercialNotes}`);
  }
  lines.push("", doc.confidentialMark);
  lines.push(`Gerado em ${formatDateLabel(doc.generatedAt)}`);

  return buildMinimalPdfDocument({
    title: pdfSafeText(doc.title),
    lines: lines.map((line) => pdfSafeText(line)),
  });
}

export function proposalInternalManagementPdfContainsClientOnlyGuard(
  buffer: Buffer
): boolean {
  const textContent = buffer.toString("latin1").toLowerCase();
  return (
    textContent.includes("confidencial") ||
    textContent.includes("documento interno") ||
    textContent.includes("nao compartilhar")
  );
}
