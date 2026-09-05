import type { NomusPurchaseOrderStage } from "./nomusPurchaseOrderTypes.js";

export type ClassifyNomusPurchaseOrderInput = {
  canceled?: boolean | null;
  statusRaw?: string | null;
  orderedQuantity?: number | null;
  receivedQuantity?: number | null;
};

const CANCELED_RE = /\b(cancelad[oa]s?|cancel|anulado|anulad[oa])\b/i;
const RECEIVED_RE = /\b(recebid[oa]s?|atendid[oa]s?|entregue|conclu[ií]d[oa]|encerrad[oa]|finalizad[oa]|fechad[oa])\b/i;
const PARTIAL_RE = /\b(parcial(mente)?|atendimentoparcial|recebimentoparcial)\b/i;
const APPROVED_RE = /\b(aprovad[oa]s?|liberad[oa]s?|autorizad[oa]s?)\b/i;
const OPEN_RE = /\b(aberto|aberta|pendente|emitid[oa]|emaberto|em.andamento|aguardando)\b/i;

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
 * Classificador puro. Cancelamento primeiro. Ausência de quantidade nunca vira RECEIVED.
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
