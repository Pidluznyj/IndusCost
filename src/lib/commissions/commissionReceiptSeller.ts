/**
 * Resolução de vendedor para o relatório de fechamento por recebimento.
 * Separa status de schedule/comissão (NO_SCHEDULE, etc.) da identidade do vendedor.
 *
 * Ordem: schedule → CommissionRecord → SalesOrder.externalSellerId → SELLER_UNRESOLVED → NO_SELLER.
 * Nunca usa SalesOrder.responsible, Proposal ou CRM.
 */
import {
  formatNomusOrderSellerDisplayName,
  isNomusOrderSellerResolved,
  resolveOrderCommissionSeller,
} from "./commissionNomusOrderSellerResolver.js";
import type { CommissionSellerIdentityContext } from "./commissionSellerIdentity.js";

export type CommissionReceiptSellerResolutionStatus =
  | "RESOLVED_FROM_SCHEDULE"
  | "RESOLVED_FROM_COMMISSION_RECORD"
  | "RESOLVED_FROM_SALES_ORDER"
  | "SELLER_UNRESOLVED"
  | "NO_SELLER";

export type CommissionReceiptSellerResolution = {
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  nomusPersonId: number | null;
  sellerResolutionStatus: CommissionReceiptSellerResolutionStatus;
  sellerLabel: string;
};

export type CommissionReceiptSellerScheduleInput = {
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId?: number | null;
  rawSellerName?: string | null;
};

export type CommissionReceiptSellerRecordInput = {
  commissionPersonId: string;
  commissionPersonName: string;
  nomusSellerId?: number | null;
  nomusPersonId?: number | null;
};

export type CommissionReceiptSellerOrderInput = {
  externalSellerId: number | null;
  issueDate?: Date | string | null;
  nomusSellerName?: string | null;
};

const NO_SELLER_LABEL = "Sem vendedor no pedido Nomus";

function sellerUnresolvedLabel(nomusId: number): string {
  return `Vendedor Nomus não mapeado: ID ${nomusId}`;
}

function resolvedFromSchedule(
  schedule: CommissionReceiptSellerScheduleInput
): CommissionReceiptSellerResolution | null {
  const canonicalSellerId = schedule.canonicalSellerId?.trim() || null;
  const canonicalSellerName = schedule.canonicalSellerName?.trim() || null;
  if (!canonicalSellerId && !canonicalSellerName) return null;

  const rawSellerId = schedule.rawSellerId ?? null;
  const rawSellerName = schedule.rawSellerName?.trim() || null;
  const nomusPersonId = rawSellerId;

  return {
    rawSellerId,
    rawSellerName,
    canonicalSellerId,
    canonicalSellerName,
    nomusPersonId,
    sellerResolutionStatus: "RESOLVED_FROM_SCHEDULE",
    sellerLabel: canonicalSellerName ?? rawSellerName ?? NO_SELLER_LABEL,
  };
}

function resolvedFromCommissionRecord(
  record: CommissionReceiptSellerRecordInput
): CommissionReceiptSellerResolution | null {
  const personId = record.commissionPersonId?.trim();
  const personName = record.commissionPersonName?.trim();
  if (!personId || !personName) return null;

  const nomusPersonId = record.nomusPersonId ?? record.nomusSellerId ?? null;
  return {
    rawSellerId: record.nomusSellerId ?? nomusPersonId,
    rawSellerName: null,
    canonicalSellerId: personId,
    canonicalSellerName: personName,
    nomusPersonId,
    sellerResolutionStatus: "RESOLVED_FROM_COMMISSION_RECORD",
    sellerLabel: personName,
  };
}

function resolvedFromSalesOrder(input: {
  salesOrder: CommissionReceiptSellerOrderInput;
  identityCtx: CommissionSellerIdentityContext;
}): CommissionReceiptSellerResolution {
  const externalSellerId = input.salesOrder.externalSellerId;
  if (externalSellerId == null || externalSellerId <= 0) {
    return {
      rawSellerId: null,
      rawSellerName: null,
      canonicalSellerId: null,
      canonicalSellerName: null,
      nomusPersonId: null,
      sellerResolutionStatus: "NO_SELLER",
      sellerLabel: NO_SELLER_LABEL,
    };
  }

  const { identity, nomus } = resolveOrderCommissionSeller({
    externalSellerId,
    issueDate: input.salesOrder.issueDate,
    nomusSellerName: input.salesOrder.nomusSellerName,
    aliasSource: "SALES_ORDER",
    identityCtx: input.identityCtx,
  });

  if (isNomusOrderSellerResolved(nomus) && identity.canonicalSellerId && identity.canonicalSellerName) {
    return {
      rawSellerId: nomus.rawSellerId ?? externalSellerId,
      rawSellerName: identity.rawSellerName?.trim() || input.salesOrder.nomusSellerName?.trim() || null,
      canonicalSellerId: identity.canonicalSellerId,
      canonicalSellerName: identity.canonicalSellerName,
      nomusPersonId: nomus.rawSellerId ?? externalSellerId,
      sellerResolutionStatus: "RESOLVED_FROM_SALES_ORDER",
      sellerLabel: identity.canonicalSellerName,
    };
  }

  return {
    rawSellerId: externalSellerId,
    rawSellerName: null,
    canonicalSellerId: null,
    canonicalSellerName: sellerUnresolvedLabel(externalSellerId),
    nomusPersonId: externalSellerId,
    sellerResolutionStatus: "SELLER_UNRESOLVED",
    sellerLabel: sellerUnresolvedLabel(externalSellerId),
  };
}

/** Resolve vendedor para linha do fechamento por recebimento (independente de NO_SCHEDULE). */
export function resolveCommissionReceiptSeller(input: {
  schedule?: CommissionReceiptSellerScheduleInput | null;
  commissionRecord?: CommissionReceiptSellerRecordInput | null;
  salesOrder?: CommissionReceiptSellerOrderInput | null;
  identityCtx?: CommissionSellerIdentityContext;
}): CommissionReceiptSellerResolution {
  const fromSchedule = input.schedule ? resolvedFromSchedule(input.schedule) : null;
  if (fromSchedule) return fromSchedule;

  const fromRecord = input.commissionRecord
    ? resolvedFromCommissionRecord(input.commissionRecord)
    : null;
  if (fromRecord) return fromRecord;

  if (input.salesOrder && input.identityCtx) {
    return resolvedFromSalesOrder({
      salesOrder: input.salesOrder,
      identityCtx: input.identityCtx,
    });
  }

  if (input.salesOrder?.externalSellerId != null && input.salesOrder.externalSellerId > 0) {
    const id = input.salesOrder.externalSellerId;
    return {
      rawSellerId: id,
      rawSellerName: null,
      canonicalSellerId: null,
      canonicalSellerName: sellerUnresolvedLabel(id),
      nomusPersonId: id,
      sellerResolutionStatus: "SELLER_UNRESOLVED",
      sellerLabel: sellerUnresolvedLabel(id),
    };
  }

  return {
    rawSellerId: null,
    rawSellerName: null,
    canonicalSellerId: null,
    canonicalSellerName: null,
    nomusPersonId: null,
    sellerResolutionStatus: "NO_SELLER",
    sellerLabel: NO_SELLER_LABEL,
  };
}

/** Mapeia resolução para campos da linha de prévia/API. */
export function mapCommissionReceiptSellerToLineFields(
  resolution: CommissionReceiptSellerResolution
): {
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus: string;
} {
  const isResolved =
    resolution.sellerResolutionStatus === "RESOLVED_FROM_SCHEDULE" ||
    resolution.sellerResolutionStatus === "RESOLVED_FROM_COMMISSION_RECORD" ||
    resolution.sellerResolutionStatus === "RESOLVED_FROM_SALES_ORDER";

  return {
    rawSellerId: resolution.rawSellerId,
    rawSellerName:
      resolution.rawSellerName?.trim() ||
      (resolution.rawSellerId != null ? String(resolution.rawSellerId) : null),
    canonicalSellerId: resolution.canonicalSellerId,
    canonicalSellerName: isResolved
      ? resolution.canonicalSellerName
      : resolution.canonicalSellerName ?? resolution.sellerLabel,
    sellerResolutionStatus: resolution.sellerResolutionStatus,
  };
}

export function receiptClosingSellerGroupLabelFromLine(line: {
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string | null {
  if (line.canonicalSellerId && line.canonicalSellerName) {
    return line.canonicalSellerName;
  }
  if (line.sellerResolutionStatus === "SELLER_UNRESOLVED") {
    return line.canonicalSellerName;
  }
  if (line.sellerResolutionStatus === "NO_SELLER") {
    return NO_SELLER_LABEL;
  }
  return line.canonicalSellerName;
}

export function formatReceiptClosingRawSellerDisplay(line: {
  rawSellerId: number | null;
  rawSellerName: string | null;
}): string {
  if (line.rawSellerId != null) return String(line.rawSellerId);
  return line.rawSellerName?.trim() || "—";
}

export function formatReceiptClosingCanonicalSellerDisplay(line: {
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus?: string | null;
}): string {
  if (line.canonicalSellerName?.trim()) return line.canonicalSellerName.trim();
  if (line.sellerResolutionStatus === "NO_SELLER") return NO_SELLER_LABEL;
  if (line.sellerResolutionStatus === "SELLER_UNRESOLVED" && line.canonicalSellerName) {
    return line.canonicalSellerName;
  }
  return "—";
}

export type ReceiptClosingSellerLineFields = {
  rawSellerId: number | null;
  rawSellerName: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  sellerResolutionStatus?: string | null;
};

const RECEIPT_SELLER_RESOLVED_STATUSES = new Set([
  "RESOLVED_FROM_SCHEDULE",
  "RESOLVED_FROM_COMMISSION_RECORD",
  "RESOLVED_FROM_SALES_ORDER",
  "OK_CANONICAL",
]);

/** Vendedor resolvido para exibição/exportação (independente de NO_SCHEDULE). */
export function isCommissionReceiptSellerResolved(line: ReceiptClosingSellerLineFields): boolean {
  if (line.canonicalSellerId) return true;
  return (
    line.sellerResolutionStatus != null &&
    RECEIPT_SELLER_RESOLVED_STATUSES.has(line.sellerResolutionStatus)
  );
}

/** Colunas de vendedor alinhadas à tela e às exportações CSV/XLSX. */
export function mapReceiptClosingLineToExportSellerColumns(line: ReceiptClosingSellerLineFields): {
  vendedorRaw: string;
  vendedorCanonico: string;
  vendedorResolvido: boolean;
} {
  const vendedorRaw = formatReceiptClosingRawSellerDisplay(line);
  const vendedorCanonico = formatReceiptClosingCanonicalSellerDisplay(line);
  return {
    vendedorRaw: vendedorRaw === "—" ? "" : vendedorRaw,
    vendedorCanonico: vendedorCanonico === "—" ? "" : vendedorCanonico,
    vendedorResolvido: isCommissionReceiptSellerResolved(line),
  };
}
