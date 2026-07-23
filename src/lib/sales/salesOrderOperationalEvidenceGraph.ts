/**
 * KAN-LINK-02 — Montagem do SalesOrderOperationalEvidenceGraph e adaptação ao motor.
 *
 * Puro: sem I/O. Não recalcula estágio — só estrutura evidências e coberturas
 * válidas para `resolveSalesOrderItemFlow` / alocações.
 */

import type {
  SalesOrderItemFlowDocumentAllocationInput,
  SalesOrderItemFlowNfeAllocationInput,
  SalesOrderItemFlowProductionLinkInput,
} from "./salesOrderItemFlowEngine.js";
import {
  buildOperationalAuditAlert,
  canOperationalLinkAdvanceKanban,
  classifyNfeValidity,
  classifyOutputDocumentValidity,
  confidenceForOperationalLinkSourceType,
  nfeValidityAdvancesKanban,
  outputDocumentValidityAdvancesKanban,
  pickPreferredOperationalLink,
  type SalesOrderOperationalAuditAlert,
  type SalesOrderOperationalDocumentCoverage,
  type SalesOrderOperationalEvidenceGraph,
  type SalesOrderOperationalItemEvidence,
  type SalesOrderOperationalLinkEdge,
  type SalesOrderOperationalNfeCoverage,
  type SalesOrderOperationalObligation,
  type SalesOrderOperationalProductionCoverage,
  type SalesOrderOperationalShipmentCoverage,
} from "./salesOrderOperationalEvidenceContract.js";

export type BuildSalesOrderOperationalEvidenceGraphInput = {
  salesOrderId: string;
  orderCode?: string | null;
  externalSalesOrderId?: number | null;
  obligations: SalesOrderOperationalObligation[];
  links: SalesOrderOperationalLinkEdge[];
  /**
   * Documentos candidatos já associados ao pedido por cadeia canônica
   * (NfeLink / idNfe / referência direta). Não inclui match por cliente/valor/data.
   */
  documents?: Array<{
    outputDocumentId: string | null;
    outputDocumentExternalId: number | null;
    salesOrderItemId: string | null;
    quantity: number;
    isCancelled?: boolean | null;
    statusRaw?: string | null;
    tipoDocumentoEstoque?: string | null;
    idNfe?: number | null;
    processing?: boolean | null;
    link: SalesOrderOperationalLinkEdge;
  }>;
  nfes?: Array<{
    nfeId: string | null;
    nfeExternalId: number | null;
    salesOrderItemId: string | null;
    quantity: number;
    statusNormalized?: string | null;
    isCanceled?: boolean | null;
    isValidForBilling?: boolean | null;
    statusRaw?: number | string | null;
    hasDocument?: boolean;
    link: SalesOrderOperationalLinkEdge;
  }>;
  productionLinks?: Array<{
    salesOrderItemId: string;
    productionOrderId: string | null;
    productionOrderExternalId: number | null;
    linkedQuantity: number;
    isCurrent?: boolean;
    link: SalesOrderOperationalLinkEdge;
  }>;
  /** Alertas de auditoria (nunca viram vínculo). */
  auditAlerts?: SalesOrderOperationalAuditAlert[];
};

function sumQty(values: readonly number[]): number {
  return values.reduce((s, q) => s + (Number.isFinite(q) ? q : 0), 0);
}

/**
 * Monta o grafo por item com coberturas que avançam o Kanban somente
 * quando vínculo + validade permitem.
 */
export function buildSalesOrderOperationalEvidenceGraph(
  input: BuildSalesOrderOperationalEvidenceGraphInput
): SalesOrderOperationalEvidenceGraph {
  const warnings: string[] = [];
  for (const alert of input.auditAlerts ?? []) {
    warnings.push(
      `[audit:${alert.kind}] ${alert.detail} (provesLink=${alert.provesLink})`
    );
  }

  const orderLinks = input.links.filter((l) => l.salesOrderItemId == null);
  const items: SalesOrderOperationalItemEvidence[] = input.obligations.map(
    (obligation) => {
      const itemId = obligation.salesOrderItemId;
      const itemLinks = input.links.filter((l) => l.salesOrderItemId === itemId);

      const production: SalesOrderOperationalProductionCoverage[] = (
        input.productionLinks ?? []
      )
        .filter((p) => p.salesOrderItemId === itemId && p.isCurrent !== false)
        .map((p) => {
          const advances =
            canOperationalLinkAdvanceKanban(p.link.sourceType) &&
            p.linkedQuantity > 0;
          return {
            salesOrderItemId: itemId,
            productionOrderId: p.productionOrderId,
            productionOrderExternalId: p.productionOrderExternalId,
            linkedQuantity: Math.max(0, p.linkedQuantity),
            link: p.link,
            advancesKanban: advances,
          };
        });

      // Sem salesOrderItemId não inventa item (evita alocar DS em pedido inteiro).
      const itemDocuments = (input.documents ?? [])
        .filter((d) => d.salesOrderItemId === itemId)
        .map((d) => {
          const validity = classifyOutputDocumentValidity(d);
          const advances =
            canOperationalLinkAdvanceKanban(d.link.sourceType) &&
            outputDocumentValidityAdvancesKanban(validity) &&
            d.quantity > 0;
          return {
            salesOrderItemId: itemId,
            outputDocumentId: d.outputDocumentId,
            outputDocumentExternalId: d.outputDocumentExternalId,
            nfeExternalId: d.idNfe ?? null,
            quantity: Math.max(0, d.quantity),
            validity,
            link: d.link,
            advancesKanban: advances,
          } satisfies SalesOrderOperationalDocumentCoverage;
        });

      const nfes: SalesOrderOperationalNfeCoverage[] = (input.nfes ?? [])
        .filter((n) => n.salesOrderItemId === itemId)
        .map((n) => {
          const validity = classifyNfeValidity(n);
          const advances =
            canOperationalLinkAdvanceKanban(n.link.sourceType) &&
            nfeValidityAdvancesKanban(validity) &&
            n.quantity > 0;
          return {
            salesOrderItemId: itemId,
            nfeId: n.nfeId,
            nfeExternalId: n.nfeExternalId,
            quantity: Math.max(0, n.quantity),
            validity,
            hasDocument: n.hasDocument === true,
            link: n.link,
            advancesKanban: advances,
          };
        });

      const documentedQuantity = sumQty(
        itemDocuments.filter((d) => d.advancesKanban).map((d) => d.quantity)
      );
      const invoicedQuantity = sumQty(
        nfes.filter((n) => n.advancesKanban).map((n) => n.quantity)
      );
      const productionOrderQuantity = sumQty(
        production.filter((p) => p.advancesKanban).map((p) => p.linkedQuantity)
      );

      const shipment: SalesOrderOperationalShipmentCoverage = {
        salesOrderItemId: itemId,
        quantity: invoicedQuantity,
        evidence: invoicedQuantity > 0 ? "NFE_PROXY" : "NONE",
        advancesKanban: invoicedQuantity > 0,
        warnings:
          invoicedQuantity > 0
            ? [
                "Envio por proxy de NF autorizada (sem data de expedição explícita).",
              ]
            : [],
      };

      const inconsistencies: Array<{ code: string; detail: string }> = [];
      for (const d of itemDocuments) {
        if (d.validity === "CANCELLED" && d.quantity > 0) {
          inconsistencies.push({
            code: "OUTPUT_DOCUMENT_CANCELLED",
            detail: `DS ${d.outputDocumentExternalId ?? "?"} cancelado não avança Kanban.`,
          });
        }
      }
      for (const n of nfes) {
        if (n.validity === "CANCELLED" && n.quantity > 0) {
          inconsistencies.push({
            code: "NFE_CANCELLED",
            detail: `NF ${n.nfeExternalId ?? "?"} cancelada não avança faturamento.`,
          });
        }
        if (n.advancesKanban && !n.hasDocument) {
          inconsistencies.push({
            code: "NFE_WITHOUT_DOCUMENT",
            detail: `NF ${n.nfeExternalId ?? "?"} autorizada sem documento de saída associado.`,
          });
        }
      }
      for (const link of itemLinks) {
        if (link.sourceType === "AMBIGUOUS") {
          inconsistencies.push({
            code: "AMBIGUOUS_LINK",
            detail: link.reason,
          });
        }
        if (link.sourceType === "UNRESOLVED") {
          inconsistencies.push({
            code: "UNRESOLVED_LINK",
            detail: link.reason,
          });
        }
      }

      return {
        salesOrderItemId: itemId,
        obligation,
        production,
        documents: itemDocuments,
        nfes,
        shipment,
        coverage: {
          productionOrderQuantity,
          documentedQuantity,
          invoicedQuantity,
          shippedQuantity: shipment.quantity,
        },
        inconsistencies,
        links: itemLinks,
      };
    }
  );

  return {
    contractVersion: "sales-order-operational-evidence/v1",
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode ?? null,
    externalSalesOrderId: input.externalSalesOrderId ?? null,
    items,
    orderLinks,
    warnings,
  };
}

export type OperationalEvidenceMotorAllocations = {
  documentAllocations: SalesOrderItemFlowDocumentAllocationInput[];
  nfeAllocations: SalesOrderItemFlowNfeAllocationInput[];
  productionLinks: SalesOrderItemFlowProductionLinkInput[];
};

/**
 * Adapta coberturas válidas do grafo para o motor canônico de item
 * (`resolveSalesOrderItemFlow`) — sem recalcular estágio aqui.
 */
export function adaptOperationalEvidenceItemToMotorAllocations(
  graph: SalesOrderOperationalEvidenceGraph,
  salesOrderItemId: string
): OperationalEvidenceMotorAllocations {
  const item = graph.items.find((i) => i.salesOrderItemId === salesOrderItemId);
  if (!item) {
    return {
      documentAllocations: [],
      nfeAllocations: [],
      productionLinks: [],
    };
  }

  const documentAllocations: SalesOrderItemFlowDocumentAllocationInput[] =
    item.documents
      .filter((d) => d.advancesKanban)
      .map((d, index) => ({
        allocationKey:
          d.link.sourceRecordId?.trim() ||
          `op-ev-doc:${d.outputDocumentExternalId ?? "x"}:${salesOrderItemId}:${index}`,
        quantity: d.quantity,
        isValid: true,
        isCanceled: false,
      }));

  const nfeAllocations: SalesOrderItemFlowNfeAllocationInput[] = item.nfes
    .filter((n) => n.advancesKanban && n.nfeExternalId != null)
    .map((n) => ({
      nfeExternalId: n.nfeExternalId!,
      quantity: n.quantity,
      isCanceled: false,
      isValidForBilling: true,
      hasDocument: n.hasDocument,
      hasShipDate: item.shipment.evidence === "EXPLICIT_SHIP_DATE",
    }));

  // Motor só consome linkedQuantity/isCurrent; IDs ficam no grafo.
  const productionLinks: SalesOrderItemFlowProductionLinkInput[] =
    item.production
      .filter((p) => p.advancesKanban && p.linkedQuantity > 0)
      .map((p) => ({
        linkedQuantity: p.linkedQuantity,
        isCurrent: true,
      }));

  return { documentAllocations, nfeAllocations, productionLinks };
}

/** Helper para montar aresta tipada com confiança default do sourceType. */
export function makeOperationalLinkEdge(
  partial: Omit<SalesOrderOperationalLinkEdge, "confidence" | "warnings"> & {
    confidence?: SalesOrderOperationalLinkEdge["confidence"];
    warnings?: string[];
  }
): SalesOrderOperationalLinkEdge {
  return {
    ...partial,
    confidence:
      partial.confidence ??
      confidenceForOperationalLinkSourceType(partial.sourceType),
    warnings: partial.warnings ?? [],
  };
}

export {
  buildOperationalAuditAlert,
  pickPreferredOperationalLink,
};
