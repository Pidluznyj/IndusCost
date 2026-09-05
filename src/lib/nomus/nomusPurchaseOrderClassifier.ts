import type {
  NomusPurchaseOrderItemStatusKey,
  NomusPurchaseOrderStage,
} from "./nomusPurchaseOrderTypes.js";
import { toInt } from "./nomusPurchaseOrderParser.js";

export type ClassifyNomusPurchaseOrderInput = {
  canceled?: boolean | null;
  statusRaw?: string | null;
  orderedQuantity?: number | null;
  receivedQuantity?: number | null;
  itemStatusCodes?: Array<number | null | undefined>;
};

const CANCELED_RE = /\b(cancelad[oa]s?|cancel|anulado|anulad[oa])\b/i;
const RECEIVED_RE = /\b(recebid[oa]s?|atendid[oa]s?|entregue|conclu[ií]d[oa]|encerrad[oa]|finalizad[oa]|fechad[oa])\b/i;
const PARTIAL_RE = /\b(parcial(mente)?|atendimentoparcial|recebimentoparcial)\b/i;
const APPROVED_RE = /\b(aprovad[oa]s?|liberad[oa]s?|autorizad[oa]s?)\b/i;
const OPEN_RE = /\b(aberto|aberta|pendente|emitid[oa]|emaberto|em.andamento|aguardando)\b/i;

export const NOMUS_PURCHASE_ORDER_ITEM_STATUS_BY_CODE: Record<
  number,
  { code: number; key: NomusPurchaseOrderItemStatusKey; label: string }
> = {
  1: { code: 1, key: "WAITING_RELEASE", label: "Aguardando liberação" },
  2: { code: 2, key: "RELEASED", label: "Liberado" },
  3: { code: 3, key: "PARTIALLY_RECEIVED", label: "Atendido parcialmente" },
  4: { code: 4, key: "FULLY_RECEIVED", label: "Atendido totalmente" },
  5: { code: 5, key: "RECEIVED_WITH_CUT", label: "Atendido com corte" },
  6: { code: 6, key: "CANCELED", label: "Cancelado" },
  7: { code: 7, key: "PARTIALLY_RETURNED", label: "Devolvido parcialmente" },
  8: { code: 8, key: "FULLY_RETURNED", label: "Devolvido totalmente" },
};

export function mapNomusPurchaseOrderItemStatus(raw: unknown): {
  code: number | null;
  key: NomusPurchaseOrderItemStatusKey | null;
  label: string | null;
} {
  const code = toInt(raw);
  if (code == null) return { code: null, key: null, label: null };
  const mapped = NOMUS_PURCHASE_ORDER_ITEM_STATUS_BY_CODE[code];
  if (!mapped) return { code, key: null, label: null };
  return { code: mapped.code, key: mapped.key, label: mapped.label };
}

function normalizeStatus(statusRaw: string | null | undefined): string {
  return (statusRaw ?? "").trim();
}

function hasPositive(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value) && value > 0;
}

function quantitiesSupportReceived(
  orderedQuantity: number | null | undefined,
  receivedQuantity: number | null | undefined
): boolean {
  return (
    hasPositive(orderedQuantity) &&
    receivedQuantity != null &&
    Number.isFinite(receivedQuantity) &&
    receivedQuantity + 1e-9 >= orderedQuantity!
  );
}

function quantitiesSupportPartial(
  orderedQuantity: number | null | undefined,
  receivedQuantity: number | null | undefined
): boolean {
  return (
    hasPositive(receivedQuantity) &&
    (orderedQuantity == null ||
      !Number.isFinite(orderedQuantity) ||
      receivedQuantity! + 1e-9 < orderedQuantity)
  );
}

/**
 * Fase do pedido a partir dos status oficiais 1–8 dos itens.
 * RECEIVED só se todos forem 4. 5/7/8 não viram RECEIVED nem CANCELED.
 */
export function classifyNomusPurchaseOrderStageFromItemStatuses(
  itemStatusCodes: Array<number | null | undefined>
): NomusPurchaseOrderStage | null {
  const codes = itemStatusCodes.filter(
    (code): code is number => code != null && Number.isInteger(code) && code >= 1 && code <= 8
  );
  if (codes.length === 0) return null;

  const all = (pred: (code: number) => boolean) => codes.every(pred);
  const any = (pred: (code: number) => boolean) => codes.some(pred);

  if (all((code) => code === 6)) return "CANCELED";
  if (all((code) => code === 4)) return "RECEIVED";
  if (all((code) => code === 2)) return "APPROVED";
  if (all((code) => code === 1)) return "OPEN";
  if (all((code) => code === 1 || code === 2)) return "OPEN";

  const hasOpenish = any((code) => code === 1 || code === 2);
  const hasPartial = any((code) => code === 3 || code === 5 || code === 7);
  const hasFull = any((code) => code === 4);
  const hasReturn = any((code) => code === 8);
  const hasCancel = any((code) => code === 6);

  if (hasPartial || (hasFull && (hasOpenish || hasCancel || hasReturn))) {
    return "PARTIALLY_RECEIVED";
  }
  if (all((code) => code === 5) || all((code) => code === 7)) return "PARTIALLY_RECEIVED";
  if (all((code) => code === 8) || all((code) => code === 6 || code === 8)) return "UNKNOWN";
  if (hasOpenish && !hasFull && !hasPartial) return "OPEN";
  return "UNKNOWN";
}

/**
 * Classificador puro. Cancelamento de cabeçalho primeiro.
 * Status de item (1–8) tem precedência sobre texto de cabeçalho ausente.
 * Ausência de quantidade nunca vira RECEIVED.
 */
export function classifyNomusPurchaseOrderStage(
  input: ClassifyNomusPurchaseOrderInput
): NomusPurchaseOrderStage {
  if (input.canceled === true) return "CANCELED";

  const status = normalizeStatus(input.statusRaw);
  if (status && CANCELED_RE.test(status)) return "CANCELED";

  if (quantitiesSupportReceived(input.orderedQuantity, input.receivedQuantity)) {
    return "RECEIVED";
  }
  if (quantitiesSupportPartial(input.orderedQuantity, input.receivedQuantity)) {
    return "PARTIALLY_RECEIVED";
  }

  const fromItems = classifyNomusPurchaseOrderStageFromItemStatuses(input.itemStatusCodes ?? []);
  if (fromItems) return fromItems;

  if (!status) {
    return input.canceled === false || input.orderedQuantity != null || input.receivedQuantity != null
      ? "OPEN"
      : "UNKNOWN";
  }

  if (PARTIAL_RE.test(status)) return "PARTIALLY_RECEIVED";
  if (RECEIVED_RE.test(status)) return "RECEIVED";
  if (APPROVED_RE.test(status)) return "APPROVED";
  if (OPEN_RE.test(status)) return "OPEN";

  return "UNKNOWN";
}

export function isNomusPurchaseOrderOpenStage(stage: NomusPurchaseOrderStage): boolean {
  return stage === "OPEN" || stage === "APPROVED" || stage === "PARTIALLY_RECEIVED";
}

export function isNomusPurchaseOrderOverdue(input: {
  stage: NomusPurchaseOrderStage;
  expectedAt: Date | null | undefined;
  now?: Date;
}): boolean {
  if (!input.expectedAt || !isNomusPurchaseOrderOpenStage(input.stage)) return false;
  const now = input.now ?? new Date();
  return input.expectedAt.getTime() < now.getTime();
}
