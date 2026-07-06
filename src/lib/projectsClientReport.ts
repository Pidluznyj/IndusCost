import {
  buildProjectAmortizationTargets,
  roundProjectMoney,
} from "./projectsCostAmortization.js";
import {
  buildProjectCostSnapshot,
  computeProjectCostSetTotal,
  resolveProjectCostFinalUnitPrice,
  resolveProjectCostSetPriceLabel,
  resolveProjectPricingItemSku,
} from "./projectsCostSnapshot.js";
import {
  PROJECT_CLIENT_REPORT_BUTTON_LABEL,
  PROJECT_CLIENT_REPORT_DISCLAIMER,
  PROJECT_CLIENT_REPORT_EXECUTIVE_SUMMARY,
  PROJECT_CLIENT_REPORT_ISSUER_NAME,
  PROJECT_CLIENT_REPORT_NOT_INFORMED,
  PROJECT_CLIENT_REPORT_ROUTE_SUFFIX,
  PROJECT_CLIENT_REPORT_TITLE,
  PROJECT_CLIENT_REPORT_VERSION,
  CLIENT_PROPOSAL_DEFAULT_QUANTITY_PER_SET,
  type ProjectClientProposalQuantityRow,
  type ProjectClientReportCommercialTerms,
  type ProjectClientReportPayload,
  type ProjectClientReportProduct,
} from "./projectsClientReportShared.js";
import { formatExecutiveReportDate, formatExecutiveReportMoney } from "./projectsExecutiveReport.js";
import type { ProjectDetail } from "@/src/types/projects.js";

export {
  PROJECT_CLIENT_REPORT_BUTTON_LABEL,
  PROJECT_CLIENT_REPORT_ROUTE_SUFFIX,
  PROJECT_CLIENT_REPORT_TITLE,
  CLIENT_PROPOSAL_DEFAULT_QUANTITY_PER_SET,
};

export type { ProjectClientProposalQuantityRow } from "./projectsClientReportShared.js";

const INTERNAL_PAYLOAD_DENYLIST = [
  "costBaseUnit",
  "finalUnitCost",
  "amortizationUnitCost",
  "marginAmount",
  "targetMarginPercent",
  "markupPercent",
  "markup",
  "memoria de calculo",
  "memória de cálculo",
] as const;

export function getProjectClientReportPath(projectId: string): string {
  return `/projects/${projectId}/client-report`;
}

export function isProjectClientReportPath(pathname: string): boolean {
  return /\/projects\/[^/]+\/client-report\/?$/.test(pathname.replace(/\/+$/, ""));
}

function resolveCommercialTerms(detail: ProjectDetail): ProjectClientReportCommercialTerms {
  return {
    paymentTerms: null,
    deliveryTerms: null,
    proposalValidity: null,
    freightTerms: null,
    exclusivity: null,
    notes: detail.notes?.trim() || null,
  };
}

function resolveProductNotes(detail: ProjectDetail, productId: string): string | null {
  const product = detail.simulatedProducts.find((row) => row.id === productId);
  return product?.notes?.trim() || null;
}

function resolveProductUnit(detail: ProjectDetail, productId: string): string {
  return detail.simulatedProducts.find((row) => row.id === productId)?.unit?.trim() || "UN";
}

export function normalizeClientProposalQuantityPerSet(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

export function resolveClientProposalQuantityPerSet(
  targetItemId: string,
  savedQuantities?: Map<string, number> | Record<string, number>
): number {
  if (savedQuantities) {
    const raw =
      savedQuantities instanceof Map
        ? savedQuantities.get(targetItemId)
        : savedQuantities[targetItemId];
    const normalized = normalizeClientProposalQuantityPerSet(raw);
    if (normalized != null) return normalized;
  }
  return CLIENT_PROPOSAL_DEFAULT_QUANTITY_PER_SET;
}

export function recalculateProjectClientReportProduct(
  product: ProjectClientReportProduct,
  quantityPerSet: number
): ProjectClientReportProduct {
  const normalized = normalizeClientProposalQuantityPerSet(quantityPerSet);
  if (normalized == null) {
    return product;
  }
  return {
    ...product,
    quantityPerSet: normalized,
    finalTotalPrice:
      product.finalUnitPrice != null
        ? roundProjectMoney(product.finalUnitPrice * normalized)
        : null,
  };
}

export function applyProjectClientReportQuantities(
  payload: ProjectClientReportPayload,
  quantitiesByProductId: Record<string, number>
): ProjectClientReportPayload {
  const products = payload.products.map((product) => {
    const quantity = quantitiesByProductId[product.id];
    if (quantity == null) return product;
    return recalculateProjectClientReportProduct(product, quantity);
  });
  return rebuildProjectClientReportSummary(payload, products);
}

function rebuildProjectClientReportSummary(
  payload: ProjectClientReportPayload,
  products: ProjectClientReportProduct[]
): ProjectClientReportPayload {
  const finalSetPrice = computeProjectClientReportFinalSetPrice(products);
  const totalProposalValue =
    finalSetPrice != null && payload.summary.estimatedQuantity != null
      ? roundProjectMoney(finalSetPrice * payload.summary.estimatedQuantity)
      : finalSetPrice;

  return {
    ...payload,
    products,
    summary: {
      ...payload.summary,
      productsCount: products.length,
      finalSetPrice,
      totalProposalValue,
    },
  };
}

export function validateProjectClientReportQuantities(
  products: ProjectClientReportProduct[],
  quantitiesByProductId: Record<string, number>
): { ok: true } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  for (const product of products) {
    const raw = quantitiesByProductId[product.id];
    if (raw == null) {
      errors[product.id] = "Quantidade obrigatória.";
      continue;
    }
    const normalized = normalizeClientProposalQuantityPerSet(raw);
    if (normalized == null) {
      errors[product.id] = "Informe um número inteiro maior que zero.";
    }
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}

export function buildProjectClientReportProducts(
  detail: ProjectDetail,
  savedQuantities?: Map<string, number> | Record<string, number>
): ProjectClientReportProduct[] {
  const snapshot = buildProjectCostSnapshot(detail, { quantitiesByTargetId: savedQuantities });

  return snapshot.pricing.view.items.map((item) => {
    const quantityPerSet = resolveClientProposalQuantityPerSet(
      item.targetItemId,
      savedQuantities
    );
    const finalUnitPrice = resolveProjectCostFinalUnitPrice(item);
    const finalTotalPrice =
      finalUnitPrice != null
        ? roundProjectMoney(finalUnitPrice * quantityPerSet)
        : null;

    return {
      id: item.targetItemId,
      sku: resolveProjectPricingItemSku(detail, item.targetItemId),
      name: item.displayName,
      description: item.displayName,
      quantityPerSet,
      unit: resolveProductUnit(detail, item.targetItemId),
      finalUnitPrice,
      finalTotalPrice,
      notes: resolveProductNotes(detail, item.targetItemId),
    } satisfies ProjectClientReportProduct;
  });
}

export function computeProjectClientReportFinalSetPrice(
  products: ProjectClientReportProduct[]
): number | null {
  if (products.length === 0) return null;
  const lines: number[] = [];
  for (const product of products) {
    if (product.finalTotalPrice == null || !Number.isFinite(product.finalTotalPrice)) {
      return null;
    }
    lines.push(product.finalTotalPrice);
  }
  return roundProjectMoney(lines.reduce((sum, value) => sum + value, 0));
}

export function buildProjectClientReport(
  detail: ProjectDetail,
  savedQuantities?: Map<string, number> | Record<string, number>
): ProjectClientReportPayload {
  const snapshot = buildProjectCostSnapshot(detail, { quantitiesByTargetId: savedQuantities });
  const products = buildProjectClientReportProducts(detail, savedQuantities);
  const finalSetPrice =
    snapshot.totals.finalSetPrice ??
    computeProjectCostSetTotal(snapshot.pricing.view.items, savedQuantities);
  const estimatedQuantity =
    detail.expectedMonthlyVolume != null && Number.isFinite(detail.expectedMonthlyVolume)
      ? detail.expectedMonthlyVolume
      : null;
  const totalProposalValue =
    finalSetPrice != null && estimatedQuantity != null
      ? roundProjectMoney(finalSetPrice * estimatedQuantity)
      : finalSetPrice;

  const productsCount = products.length;
  const finalSetPriceLabel = resolveProjectCostSetPriceLabel(productsCount);
  const pricingPending = snapshot.totals.pricingPending;

  return {
    generatedAt: new Date().toISOString(),
    reportVersion: PROJECT_CLIENT_REPORT_VERSION,
    title: PROJECT_CLIENT_REPORT_TITLE,
    disclaimer: PROJECT_CLIENT_REPORT_DISCLAIMER,
    executiveSummary: PROJECT_CLIENT_REPORT_EXECUTIVE_SUMMARY,
    project: {
      id: detail.id,
      code: detail.code,
      name: detail.title,
      customerName: detail.customerName?.trim() || PROJECT_CLIENT_REPORT_NOT_INFORMED,
      commercialResponsibleName: detail.commercialOwner?.trim() || null,
      issuedAt: new Date().toISOString(),
      validUntil: null,
      issuerName: PROJECT_CLIENT_REPORT_ISSUER_NAME,
    },
    products,
    summary: {
      productsCount,
      finalSetPrice,
      finalSetPriceLabel,
      estimatedQuantity,
      totalProposalValue,
      currency: "BRL",
      pricingPending,
    },
    commercialTerms: resolveCommercialTerms(detail),
  };
}

export function formatClientReportMoney(value: number | null | undefined): string {
  return formatExecutiveReportMoney(value);
}

export function formatClientReportDate(value: string | null | undefined): string {
  return formatExecutiveReportDate(value);
}

export function assertProjectClientReportPayloadIsSafe(payload: ProjectClientReportPayload): void {
  const { disclaimer: _disclaimer, executiveSummary: _summary, ...rest } = payload;
  const serialized = JSON.stringify(rest).toLowerCase();
  for (const token of INTERNAL_PAYLOAD_DENYLIST) {
    if (serialized.includes(token.toLowerCase())) {
      throw new Error(`Payload do relatório cliente contém campo interno proibido: ${token}`);
    }
  }
}

export function clientReportPdfContainsInternalTerms(pdfText: string): boolean {
  const disclaimerMarker = "Os valores apresentados correspondem";
  const body = pdfText.includes(disclaimerMarker)
    ? pdfText.slice(0, pdfText.indexOf(disclaimerMarker))
    : pdfText;
  const normalized = body.toLowerCase();
  const forbidden = [
    "custo de materia-prima",
    "custo de mao de obra",
    "custo hora maquina",
    "markup",
    " hh ",
    " hm ",
    " mp ",
    "amortizacao interna",
    "costbaseunit",
    "finalunitcost",
  ];
  return forbidden.some((term) => normalized.includes(term));
}
