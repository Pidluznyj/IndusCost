/**
 * PDF / documento gerencial interno da proposta comercial.
 * Dados da Proposal/ProposalItem + breakdown do snapshot quando disponível.
 * Não altera PDF cliente nem motores oficiais.
 */

import { extractProposalItemCostBreakdown } from "./proposalItemCostBreakdown.js";
import {
  estimateProposalItemCommissionValue,
  extractProposalItemEstimatedCommission,
  formatProposalEstimatedCommissionLabel,
} from "./proposalItemEstimatedCommission.js";
import { previewProposalCommercialMargins } from "./proposalCommercialMarginPreview.js";
import { resolveProposalItemCommercialMarginDisplay } from "./proposalCommercialMarginDisplay.js";
import { resolveProposalAnalysisCommercialMargin } from "./proposalListMargin.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";
import {
  buildFormattedLandscapePdf,
  formatPdfMoneyBr,
  formatPdfNumberBr,
  formatPdfPercentBr,
  type PdfLine,
} from "./proposalInternalManagementPdfLayout.js";

export const PROPOSAL_INTERNAL_MANAGEMENT_PDF_API =
  "/api/proposals/:proposalId/internal-management-pdf" as const;

export const PROPOSAL_INTERNAL_MANAGEMENT_PRINT_PATH =
  "/proposals/:proposalId/internal-management-print" as const;

export const PROPOSAL_INTERNAL_MANAGEMENT_PDF_BUTTON_LABEL = "PDF gerencial interno";

export const PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK =
  "Documento interno e confidencial. Não compartilhar com clientes.";

export function buildProposalInternalManagementPdfApiPath(proposalId: string): string {
  return `/api/proposals/${encodeURIComponent(proposalId)}/internal-management-pdf`;
}

export function buildProposalInternalManagementPrintPath(proposalId: string): string {
  return `/proposals/${encodeURIComponent(proposalId)}/internal-management-print`;
}

export type ProposalInternalManagementPdfItemInput = {
  sku?: string | null;
  name?: string | null;
  quantity: number | string | null;
  unit?: string | null;
  unitCost: number | string | null;
  negotiatedPrice: number | string | null;
  suggestedPrice?: number | string | null;
  discountPerc?: number | string | null;
  discountValue?: number | string | null;
  marginValue: number | string | null;
  marginPerc: number | string | null;
  commissionPerc: number | string | null;
  commissionValue: number | string | null;
  taxesValue?: number | string | null;
  freightValue?: number | string | null;
  notes?: string | null;
  pricingSnapshotJson?: unknown;
  commercialPricingSnapshotJson?: unknown;
  priceTableId?: string | null;
  priceTableVersionId?: string | null;
  priceSource?: string | null;
  productId?: string | null;
  /** Breakdown MP/HH/HM da tabela de custo de produção vigente (anexado no server). */
  productionCostBreakdown?: {
    materialCost?: number | null;
    laborCost?: number | null;
    machineCost?: number | null;
    processCost?: number | null;
  } | null;
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
  customerTradeName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
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
  lineNo: string;
  code: string;
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
  unitCost: number;
  totalCost: number;
  materialTotal: number | null;
  fabricationTotal: number | null;
  taxesValue: number;
  commissionValue: number;
  commissionPerc: number;
  commissionLabel: string;
  commissionEstimated: boolean;
  marginValue: number | null;
  marginPerc: number | null;
  markup: number | null;
  notes: string | null;
  costIncomplete: boolean;
  marginMissing: boolean;
  commissionPending: boolean;
  commissionPendingReason: string | null;
  breakdownPending: boolean;
  breakdownPendingReason: string | null;
};

export type ProposalInternalManagementPdfDocument = {
  title: string;
  confidentialMark: string;
  proposalCode: string;
  proposalTitle: string;
  customerName: string;
  customerTradeName: string | null;
  customerDocument: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerCityUf: string | null;
  customerZip: string | null;
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
    materialCost: number | null;
    fabricationCost: number | null;
    marginValue: number;
    marginPerc: number;
    markup: number | null;
    taxes: number;
    commission: number;
    commissionPerc: number | null;
    commissionLabel: string;
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

function formatDateLabel(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

function slugPart(value: string): string {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "proposta"
  );
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
  const storedCommission = n(input.totalCommission);
  const markup = cost > 0 ? net / cost : null;

  const commercialPreview = previewProposalCommercialMargins(
    items.map((item) => ({
      productId: typeof item.productId === "string" ? item.productId : null,
      quantity: n(item.quantity),
      suggestedPrice:
        item.suggestedPrice != null && item.suggestedPrice !== ""
          ? n(item.suggestedPrice)
          : null,
      negotiatedPrice: n(item.negotiatedPrice),
      discountPerc:
        item.discountPerc != null && item.discountPerc !== ""
          ? n(item.discountPerc)
          : null,
      discountValue:
        item.discountValue != null && item.discountValue !== ""
          ? n(item.discountValue)
          : null,
      priceTableId: typeof item.priceTableId === "string" ? item.priceTableId : null,
      priceTableVersionId:
        typeof item.priceTableVersionId === "string"
          ? item.priceTableVersionId
          : null,
      priceSource: typeof item.priceSource === "string" ? item.priceSource : null,
      commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
      pricingSnapshotJson: item.pricingSnapshotJson,
    }))
  );

  const commercialTotals = resolveProposalAnalysisCommercialMargin({
    totalNetValue: input.totalNetValue,
    totalMarginPerc: input.totalMarginPerc,
    totalMarginValue: input.totalMarginValue,
    items: items.map((item) => ({
      quantity: item.quantity,
      negotiatedPrice: item.negotiatedPrice,
      suggestedPrice: item.suggestedPrice,
      discountPerc: item.discountPerc,
      discountValue: item.discountValue,
      commercialPricingSnapshotJson: item.commercialPricingSnapshotJson,
      pricingSnapshotJson: item.pricingSnapshotJson,
      priceTableId: item.priceTableId,
      priceTableVersionId: item.priceTableVersionId,
      priceSource: item.priceSource,
      productId: item.productId,
    })),
  });

  const rows: ProposalInternalManagementPdfItemRow[] = items.map((item, index) => {
    const quantity = n(item.quantity);
    const unitCost = n(item.unitCost);
    const unitPrice = n(item.negotiatedPrice);
    const discountValue = n(item.discountValue);
    const totalPrice = Math.max(0, quantity * unitPrice - discountValue);
    const totalCost = quantity * unitCost;
    const previewItem = commercialPreview.byIndex[index] ?? null;
    const display = resolveProposalItemCommercialMarginDisplay(item);
    const storedMarginValue =
      item.marginValue != null && item.marginValue !== ""
        ? n(item.marginValue)
        : null;
    const storedMarginPerc =
      item.marginPerc != null && item.marginPerc !== ""
        ? n(item.marginPerc)
        : null;
    const looksLikeProduction100 =
      storedMarginPerc != null &&
      Math.abs(storedMarginPerc - 100) <= 0.051 &&
      !(unitCost > 0);

    let itemMargin: number | null = null;
    let itemMarginPerc: number | null = null;
    if (
      previewItem?.isComplete &&
      (previewItem.commercialMarginValue != null ||
        previewItem.commercialMarginPercent != null)
    ) {
      itemMargin = previewItem.commercialMarginValue;
      itemMarginPerc = previewItem.commercialMarginPercent;
    } else if (display.marginPerc != null || display.marginValue != null) {
      itemMargin = display.marginValue;
      itemMarginPerc = display.marginPerc;
    } else if (
      !looksLikeProduction100 &&
      (storedMarginPerc != null || storedMarginValue != null)
    ) {
      itemMarginPerc = storedMarginPerc;
      itemMargin =
        storedMarginValue != null
          ? storedMarginValue
          : storedMarginPerc != null && totalPrice > 0
            ? roundPricingMoney((storedMarginPerc / 100) * totalPrice)
            : null;
    }

    const storedCommissionValue = n(item.commissionValue);
    const storedCommissionPerc = n(item.commissionPerc);
    const taxesValue = n(item.taxesValue);
    const breakdown = extractProposalItemCostBreakdown(
      item.pricingSnapshotJson,
      quantity,
      { productionBreakdown: item.productionCostBreakdown ?? null }
    );
    const estimated = extractProposalItemEstimatedCommission(
      item.pricingSnapshotJson,
      item.commercialPricingSnapshotJson
    );

    const previewCommissionRate =
      previewItem?.isComplete && previewItem.commissionRate != null
        ? previewItem.commissionRate > 1
          ? previewItem.commissionRate / 100
          : previewItem.commissionRate
        : null;
    const previewCommissionPerc =
      previewCommissionRate != null
        ? roundPricingPercent(previewCommissionRate * 100)
        : null;
    const previewCommissionValue =
      previewItem?.isComplete && previewItem.commissionValue != null
        ? previewItem.commissionValue
        : previewCommissionRate != null && totalPrice > 0
          ? roundPricingMoney(totalPrice * previewCommissionRate)
          : null;

    let commissionPerc = storedCommissionPerc > 0 ? storedCommissionPerc : 0;
    let commissionValue = storedCommissionValue > 0 ? storedCommissionValue : 0;
    let commissionEstimated = false;
    let commissionPending = false;
    let commissionPendingReason: string | null = null;

    if (storedCommissionPerc > 0 || storedCommissionValue > 0) {
      if (!(storedCommissionPerc > 0) && previewCommissionPerc != null) {
        commissionPerc = previewCommissionPerc;
        commissionEstimated = true;
      } else if (!(storedCommissionPerc > 0) && estimated.commissionPerc != null) {
        commissionPerc = estimated.commissionPerc;
        commissionEstimated = true;
      }
      if (!(storedCommissionValue > 0)) {
        const estimatedValue =
          previewCommissionValue ??
          estimateProposalItemCommissionValue({
            quantity,
            lineRevenue: totalPrice,
            commissionPerc: commissionPerc > 0 ? commissionPerc : estimated.commissionPerc,
            commissionValuePerUnit: estimated.commissionValuePerUnit,
          });
        if (estimatedValue != null) {
          commissionValue = estimatedValue;
          commissionEstimated = true;
        }
      }
    } else if (previewCommissionPerc != null) {
      commissionPerc = previewCommissionPerc;
      commissionValue = previewCommissionValue ?? 0;
      commissionEstimated = true;
      commissionPending =
        previewCommissionValue == null && previewCommissionPerc > 0;
      commissionPendingReason = commissionPending
        ? "Percentual disponível; valor estimado pendente (sem base de venda)."
        : null;
    } else if (estimated.source === "SNAPSHOT" && estimated.commissionPerc != null) {
      commissionPerc = estimated.commissionPerc;
      const estimatedValue = estimateProposalItemCommissionValue({
        quantity,
        lineRevenue: totalPrice,
        commissionPerc: estimated.commissionPerc,
        commissionValuePerUnit: estimated.commissionValuePerUnit,
      });
      commissionValue = estimatedValue ?? 0;
      commissionEstimated = true;
      commissionPending = estimatedValue == null && estimated.commissionPerc > 0;
      commissionPendingReason = commissionPending
        ? "Percentual disponível; valor estimado pendente (sem base de venda)."
        : null;
    } else {
      commissionPending = true;
      commissionPendingReason =
        estimated.pendingReason ?? "Pendente: regra de comissão não resolvida.";
    }

    const costIncomplete = !(unitCost > 0);
    const marginMissing =
      itemMarginPerc == null &&
      itemMargin == null &&
      totalPrice > 0;
    const itemMarkup = totalCost > 0 ? totalPrice / totalCost : null;
    const commissionLabel = formatProposalEstimatedCommissionLabel({
      commissionPerc: commissionPending && !(commissionPerc > 0) ? null : commissionPerc,
      commissionValue:
        commissionPending && !(commissionValue > 0) && !(commissionPerc > 0)
          ? null
          : commissionValue > 0 || commissionPerc === 0
            ? commissionValue
            : null,
      pending: commissionPending && !(commissionPerc > 0),
      pendingReason: commissionPendingReason,
    });

    return {
      lineNo: String((index + 1) * 10).padStart(5, "0"),
      code: text(item.sku, "s/ código"),
      name: text(item.name, "Item sem nome"),
      quantity,
      unit: text(item.unit, "UN"),
      unitPrice,
      totalPrice,
      unitCost,
      totalCost,
      materialTotal: breakdown.materialTotal,
      fabricationTotal: breakdown.fabricationTotal,
      taxesValue,
      commissionValue,
      commissionPerc,
      commissionLabel,
      commissionEstimated,
      marginValue: itemMargin,
      marginPerc: itemMarginPerc,
      markup: itemMarkup,
      notes: item.notes?.trim() ? item.notes.trim() : null,
      costIncomplete,
      marginMissing,
      commissionPending: commissionPending && !(commissionPerc > 0),
      commissionPendingReason,
      breakdownPending: breakdown.source === "UNAVAILABLE",
      breakdownPendingReason: breakdown.pendingReason,
    };
  });

  const materialSum = rows.reduce(
    (acc, row) => (row.materialTotal != null ? acc + row.materialTotal : acc),
    0
  );
  const fabricationSum = rows.reduce(
    (acc, row) => (row.fabricationTotal != null ? acc + row.fabricationTotal : acc),
    0
  );
  const hasMaterial = rows.some((row) => row.materialTotal != null);
  const hasFabrication = rows.some((row) => row.fabricationTotal != null);

  const estimatedCommissionSum = rows.reduce((acc, row) => acc + row.commissionValue, 0);
  const commission =
    storedCommission > 0 ? storedCommission : estimatedCommissionSum;
  const revenueForCommission = rows.reduce((acc, row) => acc + row.totalPrice, 0);
  const commissionPercTotal =
    revenueForCommission > 0
      ? (commission / revenueForCommission) * 100
      : rows.find((row) => row.commissionPerc > 0 || row.commissionPerc === 0)?.commissionPerc ??
        null;

  // Margem comercial = motor/formação (mesma da listagem/formulário).
  // Não usa venda − custo de produção.
  const finalMarginValue = commercialTotals.totalMarginValue ?? 0;
  const finalMarginPerc = commercialTotals.totalMarginPerc ?? 0;

  const pendencies: string[] = [];
  if (commercialTotals.source === "NONE") {
    pendencies.push(
      "Margem comercial indisponível: sem snapshot/formação comercial resolvível nos itens."
    );
  }
  const incompleteCostItems = rows.filter((row) => row.costIncomplete);
  if (incompleteCostItems.length > 0) {
    pendencies.push(`${incompleteCostItems.length} item(ns) com custo incompleto ou zerado.`);
  }
  const missingMargin = rows.filter((row) => row.marginMissing);
  if (missingMargin.length > 0) {
    pendencies.push(`${missingMargin.length} item(ns) sem margem calculável.`);
  }
  const commissionPendingRows = rows.filter((row) => row.commissionPending);
  if (commissionPendingRows.length > 0) {
    pendencies.push(
      `${commissionPendingRows.length} item(ns) sem percentual de comissão resolvido no snapshot.`
    );
  }
  if (cost <= 0 && rows.length > 0) {
    pendencies.push("Custo total da proposta ausente ou zerado.");
  }
  const breakdownPending = rows.filter((row) => row.breakdownPending);
  if (breakdownPending.length > 0) {
    pendencies.push(
      `${breakdownPending.length} item(ns) sem breakdown MP/fabricação no snapshot.`
    );
  }

  const commissionSummaryLabel = formatProposalEstimatedCommissionLabel({
    commissionPerc: commissionPercTotal,
    commissionValue: commission,
    pending: rows.length > 0 && rows.every((row) => row.commissionPending),
    pendingReason: "regra não resolvida",
  });

  const proposalCode =
    input.number != null && Number.isFinite(Number(input.number))
      ? `CP ${String(Math.floor(Number(input.number))).padStart(5, "0")}`
      : "Proposta";

  const city = input.customerCity?.trim() || null;
  const state = input.customerState?.trim() || null;
  const cityUf = [city, state].filter(Boolean).join(" - ") || null;

  return {
    title: "Proposta Comercial — Relatório Gerencial Interno",
    confidentialMark: PROPOSAL_INTERNAL_MANAGEMENT_PDF_CONFIDENTIAL_MARK,
    proposalCode,
    proposalTitle: text(input.title, "Sem título"),
    customerName: text(input.customerName, "Cliente não informado"),
    customerTradeName: input.customerTradeName?.trim() || null,
    customerDocument: input.customerDocument?.trim() || null,
    customerPhone: input.customerPhone?.trim() || null,
    customerAddress: input.customerAddress?.trim() || null,
    customerCityUf: cityUf,
    customerZip: input.customerZip?.trim() || null,
    status: text(input.status, "—"),
    responsible: text(input.responsible, "Não informado"),
    issuer: text(input.companyIssuer, "Não informado"),
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
      materialCost: hasMaterial ? materialSum : null,
      fabricationCost: hasFabrication ? fabricationSum : null,
      marginValue: finalMarginValue,
      marginPerc: finalMarginPerc,
      markup,
      taxes: n(input.totalTaxes),
      commission,
      commissionPerc: commissionPercTotal,
      commissionLabel: commissionSummaryLabel,
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
  const lines: PdfLine[] = [
    { type: "title", text: doc.title },
    { type: "banner", text: `RELATÓRIO GERENCIAL INTERNO — ${doc.confidentialMark}` },
    { type: "spacer" },
    { type: "subtitle", text: "Identificação" },
    { type: "kv", label: "Proposta", value: doc.proposalCode },
    { type: "kv", label: "Título", value: doc.proposalTitle },
    { type: "kv", label: "Cliente", value: doc.customerName },
    {
      type: "kv",
      label: "CNPJ/CPF",
      value: doc.customerDocument ?? "—",
    },
    { type: "kv", label: "Status", value: doc.status },
    { type: "kv", label: "Vendedor", value: doc.responsible },
    { type: "kv", label: "Data", value: doc.issuedAtLabel },
    {
      type: "kv",
      label: "Validade",
      value: doc.validityDays != null ? `${doc.validityDays} dia(s)` : "—",
    },
    { type: "rule" },
    { type: "subtitle", text: "Resumo gerencial da proposta" },
    {
      type: "table",
      headers: [
        "Venda",
        "Custo total",
        "MP",
        "Fabricação",
        "Impostos",
        "Comissão",
        "Margem com. R$",
        "Margem com. %",
        "Markup",
      ],
      rows: [
        [
          formatPdfMoneyBr(doc.totals.net),
          formatPdfMoneyBr(doc.totals.cost),
          formatPdfMoneyBr(doc.totals.materialCost),
          formatPdfMoneyBr(doc.totals.fabricationCost),
          formatPdfMoneyBr(doc.totals.taxes),
          doc.totals.commissionLabel,
          formatPdfMoneyBr(doc.totals.marginValue),
          formatPdfPercentBr(doc.totals.marginPerc),
          doc.totals.markup != null ? formatPdfNumberBr(doc.totals.markup, 4) : "—",
        ],
      ],
    },
    { type: "spacer" },
    { type: "subtitle", text: "Itens — visão comercial" },
    {
      type: "table",
      headers: ["Item", "Código", "Produto", "Qtde", "Preço", "Receita"],
      colWidths: [50, 80, 280, 60, 90, 90],
      rows: doc.items.map((item) => [
        item.lineNo,
        item.code,
        item.name,
        formatPdfNumberBr(item.quantity, 0),
        formatPdfMoneyBr(item.unitPrice),
        formatPdfMoneyBr(item.totalPrice),
      ]),
    },
    { type: "spacer" },
    { type: "subtitle", text: "Itens — visão gerencial" },
    {
      type: "table",
      headers: [
        "Item",
        "MP",
        "Fabricação",
        "Impostos",
        "Comissão %",
        "Comissão R$",
        "Custo",
        "Margem com.",
        "%",
        "Markup",
      ],
      rows: doc.items.map((item) => [
        item.lineNo,
        item.materialTotal != null ? formatPdfMoneyBr(item.materialTotal) : "Pendente",
        item.fabricationTotal != null ? formatPdfMoneyBr(item.fabricationTotal) : "Pendente",
        formatPdfMoneyBr(item.taxesValue),
        item.commissionPending && !(item.commissionPerc > 0)
          ? "Pendente"
          : formatPdfPercentBr(item.commissionPerc),
        item.commissionPending && !(item.commissionValue > 0) && !(item.commissionPerc > 0)
          ? "Pendente"
          : item.commissionPerc > 0 && !(item.commissionValue > 0)
            ? "valor pendente"
            : formatPdfMoneyBr(item.commissionValue),
        formatPdfMoneyBr(item.totalCost),
        item.marginValue != null ? formatPdfMoneyBr(item.marginValue) : "—",
        item.marginPerc != null ? formatPdfPercentBr(item.marginPerc) : "—",
        item.markup != null ? formatPdfNumberBr(item.markup, 2) : "—",
      ]),
    },
    { type: "spacer" },
    { type: "subtitle", text: "Observações gerenciais" },
  ];

  if (doc.pendencies.length === 0) {
    lines.push({
      type: "text",
      text: "Nenhuma pendência crítica identificada nos dados da proposta.",
    });
  } else {
    for (const p of doc.pendencies) {
      lines.push({ type: "text", text: `- ${p}` });
    }
  }
  if (doc.internalNotes) {
    lines.push({ type: "text", text: `Notas internas: ${doc.internalNotes}` });
  }
  if (doc.commercialNotes) {
    lines.push({ type: "text", text: `Notas comerciais: ${doc.commercialNotes}` });
  }
  lines.push({ type: "spacer" });
  lines.push({ type: "banner", text: doc.confidentialMark });
  lines.push({
    type: "text",
    text: `Gerado em ${formatDateLabel(doc.generatedAt)}`,
  });

  return buildFormattedLandscapePdf({
    title: doc.title,
    lines,
  });
}

export function proposalInternalManagementPdfContainsClientOnlyGuard(
  buffer: Buffer
): boolean {
  const textContent = buffer.toString("latin1").toLowerCase();
  return (
    textContent.includes("confidencial") ||
    textContent.includes("documento interno") ||
    textContent.includes("gerencial interno")
  );
}

export function proposalInternalManagementPdfLooksFormatted(buffer: Buffer): boolean {
  const textContent = buffer.toString("latin1");
  return (
    textContent.startsWith("%PDF-") &&
    textContent.includes("WinAnsiEncoding") &&
    textContent.includes("MediaBox [0 0 842 595]") &&
    !textContent.includes("R$?")
  );
}
