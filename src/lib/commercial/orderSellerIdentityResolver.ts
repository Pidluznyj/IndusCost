/**
 * Resolução única de Vendedor do Pedido (Nomus) para Auditoria 360º, CRM e telas
 * executivas. Reutiliza o resolver de Comissões (`resolveNomusOrderSeller` /
 * `resolveCommissionSellerIdentity`).
 *
 * Conceitos:
 * - raw: externalSellerId / nomusSellerName (auditoria técnica)
 * - canônico: CommissionPerson / Alias
 * - Responsável Comercial (CRM) é outro eixo — nunca misturar aqui
 */
import { resolveNomusOrderSeller } from "@/src/lib/commissions/commissionNomusOrderSellerResolver.js";
import {
  resolveCommissionSellerIdentity,
  type CommissionSellerIdentityContext,
} from "@/src/lib/commissions/commissionSellerIdentity.js";
import { extractNomusSellerFromPedido } from "@/src/lib/salesOrderNomusSeller.shared.js";

export const ORDER_SELLER_NOT_INFORMED_LABEL = "Sem vendedor informado";
export const ORDER_SELLER_UNMAPPED_LABEL = "Vendedor não mapeado";
export const COMMERCIAL_RESPONSIBLE_NONE_LABEL = "Sem responsável comercial";

export type OrderSellerIdentitySource =
  | "SALES_ORDER"
  | "COMMISSION_SNAPSHOT"
  | "ALIAS"
  | "FALLBACK"
  | "NONE";

export type OrderSellerIdentityAlertCode =
  | "SELLER_NOT_INFORMED"
  | "SELLER_ALIAS_NOT_MAPPED"
  | "SELLER_SOURCE_MISMATCH"
  | "SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT"
  | "SELLER_SOURCE_FROM_COMMISSION_SNAPSHOT";

export type CommissionSnapshotSellerRef = {
  rawSellerId?: number | null;
  rawSellerName?: string | null;
  canonicalSellerId?: string | null;
  canonicalSellerName?: string | null;
};

export type ResolveOrderSellerIdentityInput = {
  salesOrder: {
    externalSellerId?: number | null;
    nomusSellerName?: string | null;
    issueDate?: Date | string | null;
    nomusRawResponse?: unknown;
  };
  commissionSnapshot?: CommissionSnapshotSellerRef | null;
};

export type ResolvedOrderSellerIdentity = {
  rawExternalId: number | null;
  rawName: string | null;
  canonicalId: string | null;
  canonicalName: string | null;
  displayName: string;
  isInformed: boolean;
  isMapped: boolean;
  matchType: string;
  source: OrderSellerIdentitySource;
  unresolvedReason?: string;
  alertCodes: OrderSellerIdentityAlertCode[];
};

export type ResolvedCommercialResponsibleDisplay = {
  id: string | null;
  name: string | null;
  displayName: string;
  source: "CRM" | "AUTO_ASSIGNED" | "NONE";
};

/** Label técnico "Vendedor ID 1399" — nunca como nome executivo. */
export function isSellerIdOnlyLabel(name: string | null | undefined): boolean {
  return /^vendedor\s+id\s*[:\s]?\s*\d+$/i.test((name ?? "").trim());
}

function asPedidoRecord(raw: unknown): Record<string, unknown> | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (obj.pedido && typeof obj.pedido === "object" && !Array.isArray(obj.pedido)) {
    return obj.pedido as Record<string, unknown>;
  }
  return obj;
}

function positiveId(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) && value > 0 ? value : null;
}

function cleanName(value: string | null | undefined): string | null {
  const t = (value ?? "").trim().replace(/\s+/g, " ");
  if (!t || isSellerIdOnlyLabel(t)) return null;
  return t;
}

function collectRawFromSalesOrder(order: ResolveOrderSellerIdentityInput["salesOrder"]): {
  rawExternalId: number | null;
  rawName: string | null;
} {
  let rawExternalId = positiveId(order.externalSellerId ?? null);
  let rawName = cleanName(order.nomusSellerName);

  if (rawExternalId == null || !rawName) {
    const pedido = asPedidoRecord(order.nomusRawResponse);
    if (pedido) {
      const extracted = extractNomusSellerFromPedido(pedido);
      if (rawExternalId == null) rawExternalId = positiveId(extracted.externalSellerId);
      if (!rawName) rawName = cleanName(extracted.nomusSellerName);
    }
  }

  return { rawExternalId, rawName };
}

/**
 * Resolve vendedor do pedido com a mesma língua da aba Comissões.
 */
export function resolveOrderSellerIdentity(
  input: ResolveOrderSellerIdentityInput,
  ctx: CommissionSellerIdentityContext
): ResolvedOrderSellerIdentity {
  const fromSo = collectRawFromSalesOrder(input.salesOrder);
  const snap = input.commissionSnapshot ?? null;
  const snapRawId = positiveId(snap?.rawSellerId ?? null);
  const snapRawName = cleanName(snap?.rawSellerName);
  const snapCanonicalName = cleanName(snap?.canonicalSellerName);
  const snapCanonicalId = snap?.canonicalSellerId?.trim() || null;

  const salesOrderInformed = fromSo.rawExternalId != null || Boolean(fromSo.rawName);
  const snapshotInformed = snapRawId != null || Boolean(snapRawName) || Boolean(snapCanonicalName);

  let rawExternalId = fromSo.rawExternalId ?? snapRawId;
  let rawName = fromSo.rawName ?? snapRawName;
  const alertCodes: OrderSellerIdentityAlertCode[] = [];

  if (!salesOrderInformed && snapshotInformed) {
    alertCodes.push("SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT");
    alertCodes.push("SELLER_SOURCE_FROM_COMMISSION_SNAPSHOT");
  }

  if (
    fromSo.rawExternalId != null &&
    snapRawId != null &&
    fromSo.rawExternalId !== snapRawId
  ) {
    alertCodes.push("SELLER_SOURCE_MISMATCH");
  }

  if (rawExternalId == null && !rawName && !snapCanonicalName) {
    return {
      rawExternalId: null,
      rawName: null,
      canonicalId: null,
      canonicalName: null,
      displayName: ORDER_SELLER_NOT_INFORMED_LABEL,
      isInformed: false,
      isMapped: false,
      matchType: "NONE",
      source: "NONE",
      unresolvedReason: "SELLER_NOT_INFORMED",
      alertCodes: ["SELLER_NOT_INFORMED"],
    };
  }

  const nomus = resolveNomusOrderSeller(
    {
      externalSellerId: rawExternalId,
      issueDate: input.salesOrder.issueDate,
      nomusSellerName: rawName,
      aliasSource: "NOMUS_ORDER",
    },
    ctx
  );

  if (
    nomus.status === "RESOLVED_BY_NOMUS_PERSON_ID" ||
    nomus.status === "RESOLVED_BY_ALIAS" ||
    nomus.status === "RESOLVED_BY_HISTORICAL_RULE"
  ) {
    const source: OrderSellerIdentitySource =
      nomus.status === "RESOLVED_BY_ALIAS"
        ? "ALIAS"
        : fromSo.rawExternalId != null
          ? "SALES_ORDER"
          : snapRawId != null
            ? "COMMISSION_SNAPSHOT"
            : "SALES_ORDER";
    return {
      rawExternalId: nomus.rawSellerId ?? rawExternalId,
      rawName,
      canonicalId: nomus.canonicalCommissionPersonId,
      canonicalName: nomus.canonicalSellerName,
      displayName: (nomus.canonicalSellerName ?? rawName ?? ORDER_SELLER_UNMAPPED_LABEL).trim(),
      isInformed: true,
      isMapped: true,
      matchType: nomus.status,
      source,
      alertCodes,
    };
  }

  // Fallback: mesma árvore do comissionamento (ID + nome + aliases).
  const byCommission = resolveCommissionSellerIdentity(
    {
      rawSellerId: rawExternalId,
      rawSellerName: rawName,
      source: "NOMUS_ORDER",
    },
    ctx
  );
  if (
    byCommission.canonicalSellerName &&
    (byCommission.resolutionStatus === "OK_CANONICAL" ||
      byCommission.resolutionStatus === "MULTIPLE_EXTERNAL_IDS_SAME_NAME" ||
      byCommission.resolutionStatus === "MISSING_EXTERNAL_ID")
  ) {
    return {
      rawExternalId: rawExternalId ?? byCommission.rawSellerId,
      rawName: rawName ?? byCommission.rawSellerName,
      canonicalId: byCommission.canonicalSellerId,
      canonicalName: byCommission.canonicalSellerName,
      displayName: byCommission.canonicalSellerName.trim(),
      isInformed: true,
      isMapped: true,
      matchType: byCommission.resolutionMethod ?? byCommission.resolutionStatus,
      source: fromSo.rawExternalId != null ? "SALES_ORDER" : "ALIAS",
      alertCodes,
    };
  }

  // Snapshot ACTIVE já materializou o canônico (ex.: PD 02523).
  if (snapCanonicalName) {
    return {
      rawExternalId: rawExternalId ?? snapRawId,
      rawName: rawName ?? snapRawName,
      canonicalId: snapCanonicalId,
      canonicalName: snapCanonicalName,
      displayName: snapCanonicalName,
      isInformed: true,
      isMapped: true,
      matchType: "COMMISSION_ORDER_SNAPSHOT",
      source: "COMMISSION_SNAPSHOT",
      alertCodes: [
        ...alertCodes.filter((c) => c !== "SELLER_SOURCE_FROM_COMMISSION_SNAPSHOT"),
        ...(fromSo.rawExternalId == null && !fromSo.rawName
          ? (["SELLER_SOURCE_FROM_COMMISSION_SNAPSHOT"] as const)
          : []),
      ],
    };
  }

  if (rawExternalId != null || rawName) {
    alertCodes.push("SELLER_ALIAS_NOT_MAPPED");
    return {
      rawExternalId,
      rawName,
      canonicalId: null,
      canonicalName: null,
      displayName: ORDER_SELLER_UNMAPPED_LABEL,
      isInformed: true,
      isMapped: false,
      matchType: nomus.status === "SELLER_UNRESOLVED" ? "SELLER_UNRESOLVED" : "UNMAPPED",
      source: "FALLBACK",
      unresolvedReason: "SELLER_ALIAS_NOT_MAPPED",
      alertCodes: [...new Set(alertCodes)],
    };
  }

  return {
    rawExternalId: null,
    rawName: null,
    canonicalId: null,
    canonicalName: null,
    displayName: ORDER_SELLER_NOT_INFORMED_LABEL,
    isInformed: false,
    isMapped: false,
    matchType: "NONE",
    source: "NONE",
    unresolvedReason: "SELLER_NOT_INFORMED",
    alertCodes: ["SELLER_NOT_INFORMED"],
  };
}

/**
 * Responsável Comercial (CRM) — eixo separado do Vendedor do Pedido.
 * Nunca promove "Vendedor ID N" a nome de carteira.
 */
export function resolveCommercialResponsibleDisplay(input: {
  ownerId?: string | null;
  canonicalName?: string | null;
  responsibleName?: string | null;
  source?: string | null;
}): ResolvedCommercialResponsibleDisplay {
  const name =
    cleanName(input.canonicalName) || cleanName(input.responsibleName) || null;
  if (!name) {
    return {
      id: null,
      name: null,
      displayName: COMMERCIAL_RESPONSIBLE_NONE_LABEL,
      source: "NONE",
    };
  }
  const src = (input.source ?? "").toUpperCase();
  const source: ResolvedCommercialResponsibleDisplay["source"] =
    src.includes("AUTO") ? "AUTO_ASSIGNED" : "CRM";
  return {
    id: input.ownerId?.trim() || null,
    name,
    displayName: name,
    source,
  };
}

/** DTO oficial embutido na Auditoria 360º. */
export function toOrderSellerDto(resolved: ResolvedOrderSellerIdentity): {
  rawExternalId: string | null;
  rawName: string | null;
  canonicalId: string | null;
  canonicalName: string | null;
  displayName: string;
  isInformed: boolean;
  isMapped: boolean;
  matchType: string;
  source: OrderSellerIdentitySource;
} {
  return {
    rawExternalId:
      resolved.rawExternalId != null ? String(resolved.rawExternalId) : null,
    rawName: resolved.rawName,
    canonicalId: resolved.canonicalId,
    canonicalName: resolved.canonicalName,
    displayName: resolved.displayName,
    isInformed: resolved.isInformed,
    isMapped: resolved.isMapped,
    matchType: resolved.matchType,
    source: resolved.source,
  };
}
