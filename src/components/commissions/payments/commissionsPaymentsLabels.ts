export const COMMISSION_PAYMENT_BATCH_STATUS_OPTIONS = [
  { value: "", label: "Todos os status" },
  { value: "DRAFT", label: "Rascunho" },
  { value: "APPROVED", label: "Aprovado" },
  { value: "PAID", label: "Pago" },
  { value: "CANCELLED", label: "Cancelado" },
] as const;

export const COMMISSION_PAYMENT_PERSON_TYPE_OPTIONS = [
  { value: "", label: "Todos os tipos" },
  { value: "SELLER", label: "Vendedor" },
  { value: "REPRESENTATIVE", label: "Representante" },
  { value: "MANAGER", label: "Gerente" },
  { value: "OTHER", label: "Outro" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  APPROVED: "Aprovado",
  PAID: "Pago",
  CANCELLED: "Cancelado",
};

export function formatPaymentBatchStatus(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function paymentBatchStatusClassName(status: string): string {
  switch (status) {
    case "DRAFT":
      return "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700";
    case "APPROVED":
      return "rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800";
    case "PAID":
      return "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800";
    case "CANCELLED":
      return "rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800";
    default:
      return "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground";
  }
}

export function canApproveBatch(status: string): boolean {
  return status === "DRAFT";
}

export function canMarkBatchPaid(status: string): boolean {
  return status === "APPROVED";
}

export function canCancelBatch(status: string): boolean {
  return status === "DRAFT" || status === "APPROVED";
}

export function isBatchLocked(status: string): boolean {
  return status === "PAID" || status === "CANCELLED";
}
