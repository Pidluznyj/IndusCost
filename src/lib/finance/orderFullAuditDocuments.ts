/**
 * Helpers puros de Documentos de Saída na Auditoria 360º.
 * Mantém deep link, stub de cabeçalho e rascunhos de alerta testáveis.
 */

import { buildOutputDocumentAuditHref } from "@/src/lib/outputDocumentsUi.js";
import type { OrderFullAuditStockDocument } from "./orderFullAuditClient.js";

export type OrderFullAuditDocumentAlertDraft = {
  code: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  origin: string;
  action: string;
  financialImpact: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Stub completo do cabeçalho DS — evita literais incompletos após novos campos.
 */
export function emptyOrderFullAuditStockDocument(
  externalId: number,
  partial: Partial<OrderFullAuditStockDocument> = {}
): OrderFullAuditStockDocument {
  const base: OrderFullAuditStockDocument = {
    stockDocumentExternalId: externalId,
    stockDocumentId: null,
    documentNumber: null,
    tipoDocumentoEstoque: null,
    dataDocumento: null,
    dataMovimentacao: null,
    customerName: null,
    companyName: null,
    idNfe: null,
    totalValue: 0,
    allocatedValue: 0,
    allocatedToAllOrders: 0,
    unallocatedBalance: 0,
    overAllocation: 0,
    coveragePercent: null,
    coverageStatus: null,
    outsideOrderValue: 0,
    quantityDocument: 0,
    quantityUsedForOrder: 0,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    hasExcess: false,
    hasOutside: false,
    productLines: 0,
    status: null,
    isCancelled: false,
    linkOrigin: "UNKNOWN",
    linkedOrders: [],
    href: buildOutputDocumentAuditHref({ stockDocumentExternalId: externalId }),
    alerts: [],
  };
  const merged: OrderFullAuditStockDocument = {
    ...base,
    ...partial,
    stockDocumentExternalId: externalId,
  };
  // Garante deep link coerente com id/número após merge.
  if (
    partial.stockDocumentId !== undefined ||
    partial.documentNumber !== undefined ||
    !partial.href
  ) {
    merged.href = buildOutputDocumentAuditHref({
      stockDocumentId: merged.stockDocumentId,
      documentNumber: merged.documentNumber,
      stockDocumentExternalId: merged.stockDocumentExternalId,
    });
  }
  return merged;
}

/**
 * Alertas de cabeçalho DS (antes da enriquecimento category/linkedTab).
 */
export function buildOrderFullAuditDocumentHeaderAlertDrafts(
  docs: OrderFullAuditStockDocument[]
): OrderFullAuditDocumentAlertDraft[] {
  const drafts: OrderFullAuditDocumentAlertDraft[] = [];

  for (const doc of docs) {
    if (doc.hasExcess) {
      drafts.push({
        code: "DOCUMENT_WITH_EXCESS",
        severity: "warning",
        title: "Documento com excedente",
        description: `Documento ${doc.stockDocumentExternalId} tem quantidade excedente ao pedido.`,
        origin: "Documento de saída",
        action: "Revisar alocação item × documento.",
        financialImpact:
          doc.outsideOrderValue > 0 ? round2(doc.outsideOrderValue) : null,
      });
    }
    if (doc.hasOutside) {
      drafts.push({
        code: "DOCUMENT_EXTRA_ITEM",
        severity: "warning",
        title: "Produto fora do pedido no documento",
        description: `Documento ${doc.stockDocumentExternalId} contém produto não pertencente ao pedido.`,
        origin: "Documento de saída",
        action:
          "Confirmar se o vínculo é intencional ou emitir documento separado.",
        financialImpact: round2(doc.outsideOrderValue),
      });
    }
    if (doc.idNfe == null) {
      drafts.push({
        code: "DOCUMENT_WITHOUT_NFE",
        severity: "warning",
        title: "Documento sem NF-e vinculada",
        description: `Documento de saída ${doc.stockDocumentExternalId} sem NF-e vinculada.`,
        origin: "Documento de saída",
        action: "Confirmar emissão da NF ou vínculo com o pedido.",
        financialImpact: null,
      });
    }
    if (
      doc.linkOrigin === "HEADER_ONLY" ||
      doc.linkOrigin === "SALES_ORDER_NFE_LINK"
    ) {
      drafts.push({
        code: "DOCUMENT_ALLOCATED_BY_HEADER_ONLY",
        severity: "info",
        title: "Documento vinculado só pelo cabeçalho",
        description: `Documento ${doc.stockDocumentExternalId} não possui evidência linha a linha do pedido (${doc.linkOrigin}).`,
        origin: "Documento de saída",
        action:
          "Rever mapper para produzir evidência item × documento (linha, não header).",
        financialImpact: null,
      });
    }
    if (doc.alerts.includes("DOCUMENT_ALLOCATED_TO_CANCELED_ITEM")) {
      drafts.push({
        code: "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM",
        severity: "warning",
        title: "Documento alocado em item cancelado",
        description: `Documento ${doc.stockDocumentExternalId} tem item alocado a linha do pedido cancelada/stale.`,
        origin: "Documento de saída × SalesOrderItem",
        action: "Reprocessar alocação ou reverter documento no Nomus.",
        financialImpact: null,
      });
    }
    if (doc.alerts.includes("DOCUMENT_WITHOUT_ORDER_ITEM")) {
      drafts.push({
        code: "DOCUMENT_WITHOUT_ORDER_ITEM",
        severity: "warning",
        title: "Documento sem item de pedido",
        description: `Documento ${doc.stockDocumentExternalId} não casou com nenhum SalesOrderItem.`,
        origin: "Documento de saída",
        action: "Verificar sync do documento ou vínculo com o pedido.",
        financialImpact: null,
      });
    }
    if (doc.isCancelled || doc.alerts.includes("DOCUMENT_CANCELLED")) {
      const label =
        doc.documentNumber?.trim() || String(doc.stockDocumentExternalId);
      drafts.push({
        code: "DOCUMENT_CANCELLED",
        severity: "warning",
        title: "Documento de saída cancelado",
        description: `Documento ${label} está cancelado no stage Nomus.`,
        origin: "NomusStockDocument.isCancelled",
        action:
          "Manter para auditoria; não tratar como atendimento financeiro (CR continua master).",
        financialImpact: null,
      });
    }
    if (
      doc.coverageStatus === "superalocado" ||
      doc.alerts.includes("DOCUMENT_OVER_ALLOCATED")
    ) {
      drafts.push({
        code: "DOCUMENT_OVER_ALLOCATED",
        severity: "warning",
        title: "Documento superalocado",
        description: `Documento ${doc.stockDocumentExternalId} tem cobertura superalocada neste pedido.`,
        origin: "Documento de saída × alocação O2C",
        action: "Revisar vínculos e redistribuir alocação entre pedidos.",
        financialImpact: doc.overAllocation ?? null,
      });
    }
  }

  return drafts;
}
