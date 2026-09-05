import type { NomusPurchaseOrderListRowDto, PurchaseOrderFinancialStatus } from "./nomusPurchaseOrder360.js";
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

export const NOMUS_PURCHASE_ORDER_FINANCIAL_LABELS: Record<PurchaseOrderFinancialStatus, string> = {
  PLANNED_ONLY: "Planejado",
  PARTIALLY_CONFIRMED: "Parcialmente confirmado",
  CONFIRMED: "Confirmado",
  PARTIALLY_PAID: "Parcial pago",
  PAID: "Pago",
  NO_FINANCIAL_DATA: "Sem vínculo",
};

export const NOMUS_PURCHASE_ORDER_FINANCIAL_TONES: Record<
  PurchaseOrderFinancialStatus,
  NomusPurchaseOrderBadgeTone
> = {
  PLANNED_ONLY: "sky",
  PARTIALLY_CONFIRMED: "violet",
  CONFIRMED: "violet",
  PARTIALLY_PAID: "amber",
  PAID: "emerald",
  NO_FINANCIAL_DATA: "slate",
};

export function nomusPurchaseOrderFinancialLabel(status: string): string {
  return (
    NOMUS_PURCHASE_ORDER_FINANCIAL_LABELS[status as PurchaseOrderFinancialStatus] ?? status
  );
}

export function nomusPurchaseOrderFinancialTone(status: string): NomusPurchaseOrderBadgeTone {
  return NOMUS_PURCHASE_ORDER_FINANCIAL_TONES[status as PurchaseOrderFinancialStatus] ?? "slate";
}

export function formatNomusPurchaseOrderListSupplier(row: {
  supplierResolvedName: string | null;
  supplierExternalId: number | null;
}): string {
  return (
    row.supplierResolvedName?.trim() ||
    (row.supplierExternalId != null ? `Fornecedor Nomus #${row.supplierExternalId}` : "—")
  );
}

export function formatNomusPurchaseOrderListInvoiceCell(row: Pick<
  NomusPurchaseOrderListRowDto,
  "lastInvoiceNumber" | "invoiceCount"
>): { primary: string; extraCount: number; title: string } {
  const number = row.lastInvoiceNumber?.trim() ?? "";
  const count = row.invoiceCount ?? 0;
  if (!number) {
    return {
      primary: count > 0 ? `${count} NF-e` : "—",
      extraCount: 0,
      title:
        count > 0
          ? `${count} NF-e vinculada(s) sem número disponível`
          : "Nenhuma NF-e vinculada pelos dados disponíveis",
    };
  }
  const extra = Math.max(0, count - 1);
  return {
    primary: number,
    extraCount: extra,
    title:
      extra > 0
        ? `Última NF: ${number} · +${extra} outra(s) vinculada(s)`
        : `Última NF: ${number}`,
  };
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
