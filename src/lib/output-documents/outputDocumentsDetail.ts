/**
 * DS-04.2 — Mapper puro do detalhe geral + itens.
 * Sem rawJson. Item sem vínculo permanece visível.
 */

import { decimalToNumber } from "@/src/lib/executiveDashboardHelpers.js";
import { moneyCentsToNumber } from "@/src/lib/output-documents/auditOutputDocumentsFinancial.js";
import type { ResolvedOutputDocument } from "@/src/lib/output-documents/nomusOutputDocumentResolver.js";
import type { OutputDocumentAllocationProjection } from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import type {
  OutputDocumentDetailItem,
  OutputDocumentDetailPayload,
  OutputDocumentDetailResolution,
} from "@/src/lib/output-documents/outputDocumentsDetailTypes.js";

export type OutputDocumentDetailSyncMeta = {
  syncedAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  presentInLastPayload: boolean;
  cancelledAt: Date | null;
  cancellationReason: string | null;
};

function toIso(value: Date | null | undefined): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  return value.toISOString();
}

function toIsoRequired(value: Date): string {
  if (Number.isNaN(value.getTime())) return new Date(0).toISOString();
  return value.toISOString();
}

function moneyOrNull(value: unknown): number | null {
  return decimalToNumber(value);
}

function moneyOrZero(value: unknown): number {
  return decimalToNumber(value) ?? 0;
}

/**
 * Monta o payload de detalhe a partir do resolver + projeção de alocação.
 * Não exige O2C para listar itens; projeção marca unresolved quando aplicável.
 */
export function buildOutputDocumentDetailPayload(input: {
  resolved: ResolvedOutputDocument;
  projection: OutputDocumentAllocationProjection;
  sync: OutputDocumentDetailSyncMeta;
  now?: Date;
}): OutputDocumentDetailPayload {
  const { resolved, projection, sync } = input;
  const doc = resolved.document;
  const generatedAt = (input.now ?? new Date()).toISOString();

  const items: OutputDocumentDetailItem[] = projection.items.map((item) => ({
    id: item.stockDocumentItemId,
    externalItemId: item.externalItemId,
    externalProductId: item.externalProductId,
    quantity: item.quantityDocument,
    unitValue: item.unitValue,
    totalValue: item.totalValue,
    allocatedValue: item.allocatedValue,
    unallocatedBalance: moneyCentsToNumber(item.unallocatedBalanceCents),
    linkStatus: item.linkStatus,
    linkOrigin: item.linkOrigin,
    productLink: {
      externalProductId: item.externalProductId,
      hasProductId:
        item.externalProductId != null && item.externalProductId > 0,
    },
    links: item.links.map((link) => ({
      salesOrderId: link.salesOrderId,
      salesOrderItemId: link.salesOrderItemId,
      orderCode: link.orderCode,
      allocatedValue: moneyCentsToNumber(link.allocatedValueCents),
      quantityUsedForOrder: link.quantityUsedForOrder,
      source: link.source,
    })),
    alerts: [...item.alerts],
  }));

  const resolution = summarizeItemResolution(items);

  const itemsSum = items.reduce((s, i) => s + i.totalValue, 0);

  return {
    document: {
      id: doc.id,
      externalId: doc.externalId,
      documentNumber: doc.documentNumber,
      tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
      statusRaw: doc.statusRaw,
      cancellation: {
        isCancelled: doc.isCancelled,
        cancelledAt: toIso(sync.cancelledAt),
        reason: sync.cancellationReason,
      },
      company: {
        externalId: doc.companyExternalId,
        name: doc.companyName,
      },
      customer: {
        externalId: doc.personExternalId,
        name: doc.personName,
      },
      dataDocumento: toIso(doc.dataDocumento),
      movementDate: toIso(doc.movementDate),
      idNfe: doc.idNfe,
      paymentTermsRaw: doc.paymentTermsRaw,
      totalValue: moneyOrNull(doc.totalValue),
      sync: {
        syncedAt: toIsoRequired(sync.syncedAt),
        firstSeenAt: toIsoRequired(sync.firstSeenAt),
        lastSeenAt: toIsoRequired(sync.lastSeenAt),
        presentInLastPayload: sync.presentInLastPayload === true,
      },
    },
    items,
    values: {
      totalValue:
        projection.document.totalValueSource === "zero" &&
        moneyOrNull(doc.totalValue) == null
          ? null
          : projection.document.totalValue,
      totalValueSource: projection.document.totalValueSource,
      itemsSum: Math.round(itemsSum * 100) / 100,
      allocatedToOrders: projection.document.allocatedToAllOrders,
      unallocatedBalance: projection.document.unallocatedBalance,
      overAllocation: projection.document.overAllocation,
      coverageStatus: projection.document.coverageStatus,
    },
    resolution,
    generatedAt,
  };
}

export function summarizeItemResolution(
  items: ReadonlyArray<Pick<OutputDocumentDetailItem, "linkStatus">>
): OutputDocumentDetailResolution {
  let itemsResolved = 0;
  let itemsUnresolved = 0;
  let itemsPartial = 0;
  let itemsConflict = 0;

  for (const item of items) {
    switch (item.linkStatus) {
      case "resolved":
        itemsResolved += 1;
        break;
      case "partial":
        itemsPartial += 1;
        break;
      case "conflict":
        itemsConflict += 1;
        break;
      default:
        itemsUnresolved += 1;
        break;
    }
  }

  return {
    listedFromStage: true,
    dependsOnO2cForListing: false,
    itemCount: items.length,
    itemsResolved,
    itemsUnresolved,
    itemsPartial,
    itemsConflict,
  };
}

/** Aceita UUID interno ou externalId numérico. */
export function parseOutputDocumentDetailIdParam(
  raw: string | undefined | null
):
  | { kind: "uuid"; value: string }
  | { kind: "externalId"; value: number }
  | { kind: "invalid"; message: string } {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    return { kind: "invalid", message: "Identificador do documento ausente." };
  }

  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRe.test(value)) {
    return { kind: "uuid", value: value.toLowerCase() };
  }

  if (/^\d+$/.test(value)) {
    const n = Number.parseInt(value, 10);
    if (Number.isFinite(n) && n > 0) {
      return { kind: "externalId", value: n };
    }
  }

  return {
    kind: "invalid",
    message: "Identificador do documento inválido.",
  };
}

export function safeMoneyOrZero(value: unknown): number {
  return moneyOrZero(value);
}
