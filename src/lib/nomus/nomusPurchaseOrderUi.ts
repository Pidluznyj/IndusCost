import type { NomusPurchaseOrderStage } from "./nomusPurchaseOrderTypes.js";

export type NomusPurchaseOrderBadgeTone = "sky" | "emerald" | "amber" | "rose" | "violet" | "slate";

export const NOMUS_PURCHASE_ORDER_STAGE_LABELS: Record<NomusPurchaseOrderStage, string> = {
  OPEN: "Aberto",
  APPROVED: "Aprovado",
  PARTIALLY_RECEIVED: "Parcialmente recebido",
  RECEIVED: "Recebido",
  CANCELED: "Cancelado",
  UNKNOWN: "Não classificado",
};

export const NOMUS_PURCHASE_ORDER_STAGE_TONES: Record<NomusPurchaseOrderStage, NomusPurchaseOrderBadgeTone> = {
  OPEN: "sky",
  APPROVED: "violet",
  PARTIALLY_RECEIVED: "amber",
  RECEIVED: "emerald",
  CANCELED: "rose",
  UNKNOWN: "slate",
};

export function nomusPurchaseOrderStageLabel(stage: string): string {
  return NOMUS_PURCHASE_ORDER_STAGE_LABELS[stage as NomusPurchaseOrderStage] ?? stage;
}

export function nomusPurchaseOrderStageTone(stage: string): NomusPurchaseOrderBadgeTone {
  return NOMUS_PURCHASE_ORDER_STAGE_TONES[stage as NomusPurchaseOrderStage] ?? "slate";
}

export function formatNomusPurchaseOrderProgress(input: {
  orderedQuantity: number | null;
  receivedQuantity: number | null;
}): string {
  if (input.orderedQuantity == null && input.receivedQuantity == null) {
    return "Informação de recebimento indisponível";
  }
  const ordered = input.orderedQuantity ?? 0;
  const received = input.receivedQuantity ?? 0;
  if (ordered <= 0) return "Informação de recebimento indisponível";
  const pct = Math.round((received / ordered) * 100);
  return `${received} / ${ordered} (${pct}%)`;
}
