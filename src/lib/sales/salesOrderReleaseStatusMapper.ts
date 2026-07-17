/**
 * OP-47 — Mapper puro de liberação do Pedido de Venda.
 *
 * Fonte normativa:
 * - `docs/commercial/sales-order-flow/current-state-audit.md` (§3.2–3.3)
 * - `docs/commercial/sales-order-flow/state-machine.md` (WAITING_RELEASE)
 * - mapa oficial `nomusSalesOrderItemStatus.ts` (códigos 1–6)
 *
 * Não inferir liberação por OP, Documento de Saída ou NF-e.
 * Status desconhecido nunca é tratado como liberado.
 */

import {
  normalizeNomusSalesOrderItemStatus,
  type NomusSalesOrderItemStatusNormalized,
} from "./nomusSalesOrderItemStatus.js";

export const SALES_ORDER_RELEASE_CLASSIFICATIONS = [
  "AWAITING_RELEASE",
  "RELEASED",
  "BLOCKED",
  "CANCELED",
  "UNKNOWN",
] as const;

export type SalesOrderReleaseClassification =
  (typeof SALES_ORDER_RELEASE_CLASSIFICATIONS)[number];

export const SALES_ORDER_RELEASE_REASON_CODES = [
  "ALL_ACTIVE_AWAITING_RELEASE",
  "HAS_AWAITING_RELEASE_ITEMS",
  "ALL_ACTIVE_PAST_RELEASE",
  "ALL_ITEMS_CANCELED",
  "ORDER_STATUS_CANCELLED",
  "ORDER_STATUS_ERROR",
  "EXPLICIT_BLOCKED_STATUS",
  "UNKNOWN_ITEM_STATUS",
  "MISSING_STATUS_FIELD",
  "NO_ITEMS",
  "NO_ACTIVE_ITEMS",
] as const;

export type SalesOrderReleaseReasonCode =
  (typeof SALES_ORDER_RELEASE_REASON_CODES)[number];

export const SALES_ORDER_RELEASE_CLASSIFICATION_LABELS = {
  AWAITING_RELEASE: "Aguardando liberação",
  RELEASED: "Liberado",
  BLOCKED: "Bloqueado",
  CANCELED: "Cancelado",
  UNKNOWN: "Desconhecido",
} as const satisfies Record<SalesOrderReleaseClassification, string>;

/** Bucket interno por item (não é coluna do Kanban). */
export type SalesOrderItemReleaseBucket =
  | "AWAITING_RELEASE"
  | "PAST_RELEASE"
  | "BLOCKED"
  | "CANCELED"
  | "STALE"
  | "UNKNOWN"
  | "MISSING";

export type SalesOrderReleaseItemInput = {
  /** Status bruto Nomus (código ou texto). */
  status?: unknown;
  /** Status normalizado já persistido (`PENDING`, `RELEASED`, …). */
  statusNormalized?: string | null;
  statusRaw?: string | null;
  nomusIsCanceled?: boolean | null;
  nomusIsStale?: boolean | null;
};

export type MapSalesOrderReleaseStatusInput = {
  items?: readonly SalesOrderReleaseItemInput[] | null;
  /**
   * `SalesOrder.status` IndusCost (fluxo de integração).
   * Só `CANCELLED` / `ERROR` influenciam este mapper; não usa DRAFT/SENT como liberação.
   */
  orderStatus?: string | null;
  /**
   * Status de cabeçalho Nomus (`status` / `situacao` / `statusPedido` …),
   * quando já extraído. Não inferir a partir de OP/DS/NF.
   */
  headerStatusRaw?: unknown;
};

export type SalesOrderReleaseItemEvidence = {
  statusRaw: string | null;
  statusNormalized: NomusSalesOrderItemStatusNormalized | "MISSING";
  bucket: SalesOrderItemReleaseBucket;
};

export type SalesOrderReleaseStatusEvidence = {
  itemCount: number;
  activeItemCount: number;
  awaitingReleaseCount: number;
  pastReleaseCount: number;
  canceledCount: number;
  blockedCount: number;
  unknownCount: number;
  missingCount: number;
  staleCount: number;
  orderStatus: string | null;
  headerStatusRaw: string | null;
  items: SalesOrderReleaseItemEvidence[];
};

export type SalesOrderReleaseStatusResult = {
  classification: SalesOrderReleaseClassification;
  isReleased: boolean;
  isBlocked: boolean;
  isCanceled: boolean;
  reasonCode: SalesOrderReleaseReasonCode;
  evidence: SalesOrderReleaseStatusEvidence;
  sourceFields: string[];
};

const NORMALIZED_SET = new Set<string>([
  "FULFILLED",
  "FULFILLED_WITH_CUT",
  "RELEASED",
  "CANCELED",
  "PARTIAL",
  "PENDING",
  "STALE",
  "UNKNOWN",
]);

const PAST_RELEASE = new Set<NomusSalesOrderItemStatusNormalized>([
  "RELEASED",
  "PARTIAL",
  "FULFILLED",
  "FULFILLED_WITH_CUT",
]);

function asStatusRaw(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const t = value.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return null;
}

function looksBlockedStatus(raw: string | null): boolean {
  if (!raw) return false;
  return /bloquead/i.test(raw.trim());
}

function resolveNormalized(
  item: SalesOrderReleaseItemInput
): {
  statusRaw: string | null;
  statusNormalized: NomusSalesOrderItemStatusNormalized | "MISSING";
  sourceFields: string[];
} {
  const sourceFields: string[] = [];
  const statusRaw =
    asStatusRaw(item.statusRaw) ??
    asStatusRaw(item.status) ??
    null;

  if (item.statusRaw != null && asStatusRaw(item.statusRaw) != null) {
    sourceFields.push("statusRaw");
  } else if (item.status != null && asStatusRaw(item.status) != null) {
    sourceFields.push("status");
  }

  const persisted = item.statusNormalized?.trim() ?? "";
  if (persisted && NORMALIZED_SET.has(persisted)) {
    sourceFields.push("statusNormalized");
    return {
      statusRaw,
      statusNormalized: persisted as NomusSalesOrderItemStatusNormalized,
      sourceFields,
    };
  }

  if (statusRaw == null && item.status == null) {
    return { statusRaw: null, statusNormalized: "MISSING", sourceFields };
  }

  const normalized = normalizeNomusSalesOrderItemStatus(statusRaw ?? item.status);
  return { statusRaw, statusNormalized: normalized, sourceFields };
}

/**
 * Classifica um item apenas com status Nomus / flags persistidas.
 * Não usa OP, Documento ou NF-e.
 */
export function mapSalesOrderItemReleaseBucket(
  item: SalesOrderReleaseItemInput
): {
  bucket: SalesOrderItemReleaseBucket;
  statusRaw: string | null;
  statusNormalized: NomusSalesOrderItemStatusNormalized | "MISSING";
  sourceFields: string[];
} {
  if (item.nomusIsStale === true) {
    return {
      bucket: "STALE",
      statusRaw: asStatusRaw(item.statusRaw) ?? asStatusRaw(item.status),
      statusNormalized: "STALE",
      sourceFields: ["nomusIsStale"],
    };
  }

  const resolved = resolveNormalized(item);
  const rawForBlock = resolved.statusRaw;

  if (looksBlockedStatus(rawForBlock)) {
    return {
      bucket: "BLOCKED",
      statusRaw: resolved.statusRaw,
      statusNormalized:
        resolved.statusNormalized === "MISSING"
          ? "UNKNOWN"
          : resolved.statusNormalized,
      sourceFields: [...resolved.sourceFields],
    };
  }

  if (item.nomusIsCanceled === true) {
    return {
      bucket: "CANCELED",
      statusRaw: resolved.statusRaw,
      statusNormalized: "CANCELED",
      sourceFields: [...new Set([...resolved.sourceFields, "nomusIsCanceled"])],
    };
  }

  if (resolved.statusNormalized === "MISSING") {
    return {
      bucket: "MISSING",
      statusRaw: null,
      statusNormalized: "MISSING",
      sourceFields: resolved.sourceFields,
    };
  }

  if (resolved.statusNormalized === "CANCELED") {
    return {
      bucket: "CANCELED",
      statusRaw: resolved.statusRaw,
      statusNormalized: "CANCELED",
      sourceFields: resolved.sourceFields,
    };
  }

  if (resolved.statusNormalized === "STALE") {
    return {
      bucket: "STALE",
      statusRaw: resolved.statusRaw,
      statusNormalized: "STALE",
      sourceFields: resolved.sourceFields,
    };
  }

  if (resolved.statusNormalized === "PENDING") {
    return {
      bucket: "AWAITING_RELEASE",
      statusRaw: resolved.statusRaw,
      statusNormalized: "PENDING",
      sourceFields: resolved.sourceFields,
    };
  }

  if (PAST_RELEASE.has(resolved.statusNormalized)) {
    return {
      bucket: "PAST_RELEASE",
      statusRaw: resolved.statusRaw,
      statusNormalized: resolved.statusNormalized,
      sourceFields: resolved.sourceFields,
    };
  }

  // UNKNOWN e qualquer residual não mapeado — nunca PAST_RELEASE.
  return {
    bucket: "UNKNOWN",
    statusRaw: resolved.statusRaw,
    statusNormalized: "UNKNOWN",
    sourceFields: resolved.sourceFields,
  };
}

function resultOf(
  classification: SalesOrderReleaseClassification,
  reasonCode: SalesOrderReleaseReasonCode,
  evidence: SalesOrderReleaseStatusEvidence,
  sourceFields: string[]
): SalesOrderReleaseStatusResult {
  return {
    classification,
    isReleased: classification === "RELEASED",
    isBlocked: classification === "BLOCKED",
    isCanceled: classification === "CANCELED",
    reasonCode,
    evidence,
    sourceFields: [...new Set(sourceFields)],
  };
}

/**
 * Determina a liberação agregada do Pedido a partir dos itens (e status
 * IndusCost comprovados CANCELLED/ERROR). Puro — sem I/O.
 */
export function mapSalesOrderReleaseStatus(
  input: MapSalesOrderReleaseStatusInput
): SalesOrderReleaseStatusResult {
  const items = input.items ?? [];
  const orderStatus =
    typeof input.orderStatus === "string" && input.orderStatus.trim()
      ? input.orderStatus.trim()
      : null;
  const headerStatusRaw = asStatusRaw(input.headerStatusRaw);
  const sourceFields: string[] = [];

  const itemEvidence: SalesOrderReleaseItemEvidence[] = [];
  let awaitingReleaseCount = 0;
  let pastReleaseCount = 0;
  let canceledCount = 0;
  let blockedCount = 0;
  let unknownCount = 0;
  let missingCount = 0;
  let staleCount = 0;

  for (const item of items) {
    const mapped = mapSalesOrderItemReleaseBucket(item);
    sourceFields.push(...mapped.sourceFields);
    itemEvidence.push({
      statusRaw: mapped.statusRaw,
      statusNormalized: mapped.statusNormalized,
      bucket: mapped.bucket,
    });
    switch (mapped.bucket) {
      case "AWAITING_RELEASE":
        awaitingReleaseCount += 1;
        break;
      case "PAST_RELEASE":
        pastReleaseCount += 1;
        break;
      case "CANCELED":
        canceledCount += 1;
        break;
      case "BLOCKED":
        blockedCount += 1;
        break;
      case "UNKNOWN":
        unknownCount += 1;
        break;
      case "MISSING":
        missingCount += 1;
        break;
      case "STALE":
        staleCount += 1;
        break;
    }
  }

  const activeItemCount =
    awaitingReleaseCount +
    pastReleaseCount +
    blockedCount +
    unknownCount +
    missingCount;

  const evidence: SalesOrderReleaseStatusEvidence = {
    itemCount: items.length,
    activeItemCount,
    awaitingReleaseCount,
    pastReleaseCount,
    canceledCount,
    blockedCount,
    unknownCount,
    missingCount,
    staleCount,
    orderStatus,
    headerStatusRaw,
    items: itemEvidence,
  };

  if (orderStatus) sourceFields.push("orderStatus");
  if (headerStatusRaw != null) sourceFields.push("headerStatusRaw");

  // Cancelamento oficial do pedido IndusCost.
  if (orderStatus === "CANCELLED") {
    return resultOf("CANCELED", "ORDER_STATUS_CANCELLED", evidence, sourceFields);
  }

  // Bloqueio explícito no cabeçalho Nomus (texto comprovável).
  if (looksBlockedStatus(headerStatusRaw)) {
    return resultOf("BLOCKED", "EXPLICIT_BLOCKED_STATUS", evidence, sourceFields);
  }

  // Erro de integração IndusCost — pedido bloqueado para uso operacional.
  if (orderStatus === "ERROR") {
    return resultOf("BLOCKED", "ORDER_STATUS_ERROR", evidence, sourceFields);
  }

  if (items.length === 0) {
    return resultOf("UNKNOWN", "NO_ITEMS", evidence, sourceFields);
  }

  // Todos os itens não-stale cancelados.
  const nonStale = items.length - staleCount;
  if (nonStale > 0 && canceledCount === nonStale) {
    return resultOf("CANCELED", "ALL_ITEMS_CANCELED", evidence, sourceFields);
  }

  if (activeItemCount === 0) {
    return resultOf("UNKNOWN", "NO_ACTIVE_ITEMS", evidence, sourceFields);
  }

  if (blockedCount > 0) {
    return resultOf("BLOCKED", "EXPLICIT_BLOCKED_STATUS", evidence, sourceFields);
  }

  // Status desconhecido / campo ausente: nunca liberado.
  if (unknownCount > 0) {
    return resultOf("UNKNOWN", "UNKNOWN_ITEM_STATUS", evidence, sourceFields);
  }

  if (missingCount > 0) {
    return resultOf("UNKNOWN", "MISSING_STATUS_FIELD", evidence, sourceFields);
  }

  if (awaitingReleaseCount > 0 && pastReleaseCount === 0) {
    return resultOf(
      "AWAITING_RELEASE",
      "ALL_ACTIVE_AWAITING_RELEASE",
      evidence,
      sourceFields
    );
  }

  if (awaitingReleaseCount > 0) {
    return resultOf(
      "AWAITING_RELEASE",
      "HAS_AWAITING_RELEASE_ITEMS",
      evidence,
      sourceFields
    );
  }

  if (pastReleaseCount > 0) {
    return resultOf("RELEASED", "ALL_ACTIVE_PAST_RELEASE", evidence, sourceFields);
  }

  return resultOf("UNKNOWN", "NO_ACTIVE_ITEMS", evidence, sourceFields);
}
