/**
 * FIN-03 — Classificador canônico do atendimento do item (agenda financeira).
 *
 * Função pura: converte status/quantidades Nomus já reconhecidos no código em
 * classificação financeira única. Não espalha códigos/textos Nomus — reutiliza
 * `normalizeNomusSalesOrderItemStatus` / mapa oficial em
 * `src/lib/sales/nomusSalesOrderItemStatus.ts`.
 *
 * Política: `docs/finance/effective-schedule-policy.md` (FIN-02).
 */

import {
  normalizeNomusSalesOrderItemStatus,
  type NomusSalesOrderItemStatusNormalized,
  type ParsedNomusSalesOrderItemStatus,
} from "@/src/lib/sales/nomusSalesOrderItemStatus.js";

export type SalesOrderItemFinancialFulfillmentClassification =
  | "NOT_FULFILLED"
  | "PARTIALLY_FULFILLED"
  | "FULLY_FULFILLED"
  | "FULFILLED_WITH_CUT"
  | "CANCELED"
  | "UNKNOWN";

export type SalesOrderItemFinancialFulfillmentEvidence = {
  statusRaw: string | null;
  statusNormalized: NomusSalesOrderItemStatusNormalized;
  negativeQuantityBlocked: boolean;
  quantityInconsistency: boolean;
  cutByOfficialStatus: boolean;
  /** Diferença ordered−fulfilled sem status de corte — nunca promove a FULFILLED_WITH_CUT. */
  quantityShortfallWithoutCutStatus: boolean;
  classificationPendingAlert: boolean;
};

export type ClassifySalesOrderItemFinancialFulfillmentInput = {
  /** Status bruto Nomus (código ou texto). */
  status?: unknown;
  /**
   * Status já normalizado pelo parser oficial (`FULFILLED`, `PARTIAL`, …).
   * Quando válido, tem precedência sobre `status`.
   */
  statusNormalized?: string | null;
  statusRaw?: string | null;
  orderedQuantity?: number | null;
  fulfilledQuantity?: number | null;
  /** Flag persistida — não classifica corte sozinha. */
  nomusIsCut?: boolean | null;
  /** Flag persistida de cancelamento. */
  nomusIsCanceled?: boolean | null;
};

export type ClassifySalesOrderItemFinancialFulfillmentResult = {
  classification: SalesOrderItemFinancialFulfillmentClassification;
  orderedQuantity: number | null;
  fulfilledQuantity: number | null;
  remainingQuantity: number | null;
  hasFutureObligation: boolean;
  isCut: boolean;
  reason: string;
  evidence: SalesOrderItemFinancialFulfillmentEvidence;
};

const QTY_EPS = 1e-9;

const NORMALIZED_SET = new Set<NomusSalesOrderItemStatusNormalized>([
  "FULFILLED",
  "FULFILLED_WITH_CUT",
  "RELEASED",
  "CANCELED",
  "PARTIAL",
  "PENDING",
  "STALE",
  "UNKNOWN",
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

function parseQuantity(value: unknown): {
  value: number | null;
  negativeBlocked: boolean;
} {
  if (value == null || value === "") {
    return { value: null, negativeBlocked: false };
  }
  let n: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) n = value;
  else if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim().replace(",", "."));
    n = Number.isFinite(parsed) ? parsed : null;
  }
  if (n == null) return { value: null, negativeBlocked: false };
  if (n < -QTY_EPS) return { value: null, negativeBlocked: true };
  if (Math.abs(n) <= QTY_EPS) return { value: 0, negativeBlocked: false };
  return { value: n, negativeBlocked: false };
}

function coerceNormalized(
  value: string | null | undefined
): NomusSalesOrderItemStatusNormalized | null {
  if (value == null) return null;
  const upper = value.trim().toUpperCase();
  if (!upper) return null;
  if (NORMALIZED_SET.has(upper as NomusSalesOrderItemStatusNormalized)) {
    return upper as NomusSalesOrderItemStatusNormalized;
  }
  return null;
}

function mapNormalizedToClassification(
  normalized: NomusSalesOrderItemStatusNormalized
): SalesOrderItemFinancialFulfillmentClassification {
  switch (normalized) {
    case "PENDING":
    case "RELEASED":
      return "NOT_FULFILLED";
    case "PARTIAL":
      return "PARTIALLY_FULFILLED";
    case "FULFILLED":
      return "FULLY_FULFILLED";
    case "FULFILLED_WITH_CUT":
      return "FULFILLED_WITH_CUT";
    case "CANCELED":
      return "CANCELED";
    case "STALE":
    case "UNKNOWN":
    default:
      return "UNKNOWN";
  }
}

function reasonFor(
  classification: SalesOrderItemFinancialFulfillmentClassification,
  evidence: SalesOrderItemFinancialFulfillmentEvidence
): string {
  if (evidence.negativeQuantityBlocked) {
    return "Quantidade negativa bloqueada; classificação pelo status oficial Nomus.";
  }
  if (evidence.quantityInconsistency) {
    return "Quantidade atendida excede a pedida (inconsistência); classificação pelo status oficial.";
  }
  switch (classification) {
    case "NOT_FULFILLED":
      return "Item não atendido (pendente/liberado) — obrigação futura ativa.";
    case "PARTIALLY_FULFILLED":
      return "Atendimento parcial — saldo residual com obrigação futura ativa.";
    case "FULLY_FULFILLED":
      return "Atendido totalmente — residual zero.";
    case "FULFILLED_WITH_CUT":
      return "Atendido com corte (status oficial) — residual zero; diferença é corte comercial.";
    case "CANCELED":
      return "Item cancelado — residual zero.";
    case "UNKNOWN":
      return "Status desconhecido — previsão provisória do não coberto; alerta de classificação pendente.";
  }
}

/**
 * Classifica o atendimento financeiro do item a partir de status/quantidades Nomus.
 * Puro — sem I/O.
 */
export function classifySalesOrderItemFinancialFulfillment(
  input: ClassifySalesOrderItemFinancialFulfillmentInput
): ClassifySalesOrderItemFinancialFulfillmentResult {
  const orderedParsed = parseQuantity(input.orderedQuantity);
  const fulfilledParsed = parseQuantity(input.fulfilledQuantity);
  const negativeQuantityBlocked =
    orderedParsed.negativeBlocked || fulfilledParsed.negativeBlocked;

  const orderedQuantity = orderedParsed.value;
  const fulfilledQuantity = fulfilledParsed.value;

  const quantityInconsistency =
    orderedQuantity != null &&
    fulfilledQuantity != null &&
    fulfilledQuantity > orderedQuantity + QTY_EPS;

  const fromNormalized = coerceNormalized(input.statusNormalized ?? null);
  let statusNormalized: NomusSalesOrderItemStatusNormalized =
    fromNormalized ?? normalizeNomusSalesOrderItemStatus(input.status);

  if (input.nomusIsCanceled === true) {
    statusNormalized = "CANCELED";
  }

  // Corte só por status oficial FULFILLED_WITH_CUT — nunca só por shortfall de qty
  // nem só pela flag nomusIsCut quando o status não é de corte.
  const cutByOfficialStatus = statusNormalized === "FULFILLED_WITH_CUT";

  let classification = mapNormalizedToClassification(statusNormalized);

  // UNKNOWN / não-corte: flag de corte isolada não promove classificação.
  if (
    !cutByOfficialStatus &&
    input.nomusIsCut === true &&
    classification !== "CANCELED"
  ) {
    // Mantém classification; evidencia shortfall sem status de corte abaixo.
  }

  if (cutByOfficialStatus) {
    classification = "FULFILLED_WITH_CUT";
  }

  const isCut = classification === "FULFILLED_WITH_CUT";

  const quantityShortfallWithoutCutStatus =
    !isCut &&
    orderedQuantity != null &&
    fulfilledQuantity != null &&
    fulfilledQuantity + QTY_EPS < orderedQuantity;

  let remainingQuantity: number | null = null;
  switch (classification) {
    case "CANCELED":
    case "FULLY_FULFILLED":
    case "FULFILLED_WITH_CUT":
      remainingQuantity = 0;
      break;
    case "NOT_FULFILLED":
      remainingQuantity = orderedQuantity;
      break;
    case "PARTIALLY_FULFILLED":
      if (orderedQuantity != null && fulfilledQuantity != null) {
        remainingQuantity = Math.max(0, orderedQuantity - fulfilledQuantity);
      } else if (orderedQuantity != null) {
        remainingQuantity = orderedQuantity;
      } else {
        remainingQuantity = null;
      }
      break;
    case "UNKNOWN":
      // Nunca zerar silenciosamente: residual provisório quando houver qty.
      if (orderedQuantity != null && fulfilledQuantity != null) {
        remainingQuantity = Math.max(0, orderedQuantity - fulfilledQuantity);
      } else if (orderedQuantity != null) {
        remainingQuantity = orderedQuantity;
      } else {
        remainingQuantity = null;
      }
      break;
  }

  if (negativeQuantityBlocked) {
    remainingQuantity = null;
  }

  const hasFutureObligation =
    classification === "NOT_FULFILLED" ||
    classification === "PARTIALLY_FULFILLED" ||
    classification === "UNKNOWN";

  const classificationPendingAlert = classification === "UNKNOWN";

  const statusRaw =
    input.statusRaw ??
    asStatusRaw(input.status) ??
    (input.statusNormalized != null ? String(input.statusNormalized) : null);

  const evidence: SalesOrderItemFinancialFulfillmentEvidence = {
    statusRaw,
    statusNormalized,
    negativeQuantityBlocked,
    quantityInconsistency,
    cutByOfficialStatus,
    quantityShortfallWithoutCutStatus,
    classificationPendingAlert,
  };

  return {
    classification,
    orderedQuantity,
    fulfilledQuantity,
    remainingQuantity,
    hasFutureObligation,
    isCut,
    reason: reasonFor(classification, evidence),
    evidence,
  };
}

/** Atalho a partir do parser oficial de item Nomus. */
export function classifySalesOrderItemFinancialFulfillmentFromParsed(
  parsed: ParsedNomusSalesOrderItemStatus
): ClassifySalesOrderItemFinancialFulfillmentResult {
  return classifySalesOrderItemFinancialFulfillment({
    status: parsed.statusRaw,
    statusNormalized: parsed.statusNormalized,
    statusRaw: parsed.statusRaw,
    orderedQuantity: parsed.quantityOrdered,
    fulfilledQuantity: parsed.quantityFulfilled,
    nomusIsCut: parsed.isCut,
    nomusIsCanceled: parsed.isCanceled,
  });
}
