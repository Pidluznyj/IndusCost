/**
 * Labels e helpers de UI do módulo Estoque — sem dependências server-only.
 */
import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { InventoryMovementType } from "@/src/types/inventory";

export const INVENTORY_MOVEMENT_TYPE_LABELS: Record<InventoryMovementType, string> = {
  MANUAL_ENTRY: "Entrada manual",
  PURCHASE_ENTRY: "Entrada compra",
  PRODUCTION_ENTRY: "Entrada produção",
  MANUAL_EXIT: "Saída manual",
  REQUISITION_EXIT: "Requisição",
  PRODUCTION_EXIT: "Saída produção",
  TRANSFER: "Transferência",
  POSITIVE_ADJUSTMENT: "Ajuste positivo",
  NEGATIVE_ADJUSTMENT: "Ajuste negativo",
  BLOCK: "Bloqueio",
  UNBLOCK: "Desbloqueio",
  RESERVE: "Reserva",
  CANCEL_RESERVATION: "Cancel. reserva",
  LOSS: "Perda",
  SCRAP: "Sucata",
  RETURN: "Devolução",
  REVERSAL: "Estorno",
};

export const INVENTORY_OPERATIONAL_STATUS_LABELS: Record<string, string> = {
  OK: "Normal",
  ATTENTION: "Atenção",
  CRITICAL: "Crítico",
  OUT_OF_STOCK: "Sem estoque",
  NEGATIVE: "Saldo negativo",
  BLOCKED: "Com bloqueio",
  QUARANTINE: "Quarentena",
  INACTIVE: "Inativo",
};

export function formatInventoryMovementType(type: string): string {
  return INVENTORY_MOVEMENT_TYPE_LABELS[type as InventoryMovementType] ?? type;
}

export function formatInventoryOperationalStatus(status: string): string {
  return INVENTORY_OPERATIONAL_STATUS_LABELS[status] ?? status;
}

export function formatInventoryDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

export function formatInventoryQuantity(value: number | null | undefined, unit?: string | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const formatted = value.toLocaleString("pt-BR", { maximumFractionDigits: 4 });
  return unit ? `${formatted} ${unit}` : formatted;
}

export function InventoryPermissionDenied() {
  return (
    <div
      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center"
      data-testid="inventory-permission-denied"
    >
      <p className="text-base font-semibold text-amber-900">Sem permissão</p>
      <p className="mt-2 text-sm text-amber-800">
        Você não tem permissão para acessar o módulo Estoque / Almoxarifado. Solicite a permissão{" "}
        <strong>inventory.view</strong> ao administrador.
      </p>
    </div>
  );
}

export function InventoryLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500"
      data-testid="inventory-loading"
    >
      <Loader2 className="h-7 w-7 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function InventoryEmptyState({ message }: { message: string }) {
  return (
    <p className="py-8 text-center text-sm text-slate-500" data-testid="inventory-empty-state">
      {message}
    </p>
  );
}

export function InventoryComingSoonTab({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-12 text-center"
      data-testid="inventory-coming-soon"
    >
      <p className="text-base font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">{description}</p>
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-slate-400">Em breve</p>
    </div>
  );
}

export function InventoryErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
      data-testid="inventory-error-banner"
      role="alert"
    >
      <p>{message}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs font-medium text-red-700 underline"
        >
          Fechar
        </button>
      ) : null}
    </div>
  );
}

export function inventoryTableClassName(): string {
  return cn(
    "w-full text-left text-sm",
    "[&_th]:border-b [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500",
    "[&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:text-slate-700",
    "[&_tbody_tr:hover]:bg-slate-50/80"
  );
}

export function formatInventoryApiError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
