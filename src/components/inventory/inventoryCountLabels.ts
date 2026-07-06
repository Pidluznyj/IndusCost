import type { InventoryCountSessionStatus } from "@/src/types/inventory";

export const INVENTORY_COUNT_STATUS_LABELS: Record<InventoryCountSessionStatus, string> = {
  OPEN: "Aberta",
  COUNTING: "Em contagem",
  WAITING_APPROVAL: "Aguardando aprovação",
  APPROVED: "Aprovada",
  ADJUSTED: "Ajustada",
  CANCELED: "Cancelada",
};

export const INVENTORY_COUNT_STATUS_OPTIONS: { value: InventoryCountSessionStatus; label: string }[] =
  (Object.entries(INVENTORY_COUNT_STATUS_LABELS) as [InventoryCountSessionStatus, string][]).map(
    ([value, label]) => ({ value, label })
  );

export function formatInventoryCountStatus(status: string): string {
  return INVENTORY_COUNT_STATUS_LABELS[status as InventoryCountSessionStatus] ?? status;
}

export const INVENTORY_COUNT_STATUS_STYLES: Record<InventoryCountSessionStatus, string> = {
  OPEN: "bg-sky-50 text-sky-800 ring-sky-200",
  COUNTING: "bg-blue-50 text-blue-800 ring-blue-200",
  WAITING_APPROVAL: "bg-amber-50 text-amber-800 ring-amber-200",
  APPROVED: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  ADJUSTED: "bg-slate-100 text-slate-800 ring-slate-300",
  CANCELED: "bg-red-50 text-red-700 ring-red-200",
};
