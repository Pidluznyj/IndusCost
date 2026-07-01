import { buildMinimalPdfDocument } from "./minimalPdfWriter.js";
import {
  assertProjectClientReportPayloadIsSafe,
  buildProjectClientReport,
  clientReportPdfContainsInternalTerms,
  computeProjectClientReportFinalSetPrice,
  formatClientReportDate,
  formatClientReportMoney,
} from "./projectsClientReport.js";
import type { ProjectClientReportPayload } from "./projectsClientReportShared.js";
import { loadProjectDetail } from "./projectsService.js";

export {
  assertProjectClientReportPayloadIsSafe,
  buildProjectClientReport,
  buildProjectClientReportProducts,
  clientReportPdfContainsInternalTerms,
  computeProjectClientReportFinalSetPrice,
  formatClientReportDate,
  formatClientReportMoney,
  getProjectClientReportPath,
  isProjectClientReportPath,
  PROJECT_CLIENT_REPORT_BUTTON_LABEL,
} from "./projectsClientReport.js";

export type { ProjectClientReportPayload } from "./projectsClientReportShared.js";

import { loadProjectClientProposalQuantities } from "./projectsClientProposalService.js";

export async function loadProjectClientReport(
  projectId: string
): Promise<ProjectClientReportPayload | null> {
  const detail = await loadProjectDetail(projectId);
  if (!detail) return null;
  const savedQuantities = await loadProjectClientProposalQuantities(projectId);
  const payload = buildProjectClientReport(detail, savedQuantities);
  assertProjectClientReportPayloadIsSafe(payload);
  return payload;
}

function pdfSafeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}

export function buildProjectClientReportPdfFilename(code: string): string {
  const safe = code.replace(/[^\w.-]+/g, "_");
  return `proposta-cliente-${safe}.pdf`;
}

export function buildProjectClientReportPdfBuffer(
  payload: ProjectClientReportPayload
): Buffer {
  assertProjectClientReportPayloadIsSafe(payload);

  const lines: string[] = [
    payload.title,
    "",
    `Projeto: ${payload.project.code} — ${payload.project.name}`,
    `Cliente: ${payload.project.customerName}`,
    `Responsavel comercial: ${payload.project.commercialResponsibleName ?? "Nao informado"}`,
    `Emissao: ${formatClientReportDate(payload.project.issuedAt)}`,
    `Empresa emissora: ${payload.project.issuerName}`,
    "",
    payload.executiveSummary,
    "",
    "Produtos / Pecas",
  ];

  payload.products.forEach((product, index) => {
    lines.push(
      `${index + 1}. ${product.name} | Qtd ${product.quantityPerSet} ${product.unit} | Unit ${formatClientReportMoney(product.finalUnitPrice)} | Total ${formatClientReportMoney(product.finalTotalPrice)}`
    );
  });

  lines.push(
    "",
    `${payload.summary.finalSetPriceLabel}: ${formatClientReportMoney(payload.summary.finalSetPrice)}`,
    `Quantidade de produtos: ${payload.summary.productsCount}`,
  );

  if (payload.summary.estimatedQuantity != null) {
    lines.push(
      `Quantidade estimada: ${payload.summary.estimatedQuantity}`,
      `Valor total estimado: ${formatClientReportMoney(payload.summary.totalProposalValue)}`
    );
  }

  if (payload.commercialTerms.notes) {
    lines.push("", `Observacoes comerciais: ${payload.commercialTerms.notes}`);
  }

  lines.push("", payload.disclaimer);
  lines.push("", `Gerado em ${formatClientReportDate(payload.generatedAt)}`);

  const buffer = buildMinimalPdfDocument({
    title: pdfSafeText(payload.title),
    lines: lines.map((line) => pdfSafeText(line)),
  });

  const pdfText = buffer.toString("latin1");
  if (clientReportPdfContainsInternalTerms(pdfText)) {
    throw new Error("PDF do relatório cliente contém termos internos proibidos.");
  }

  return buffer;
}
