import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { fleetSafeCell } from "@/src/lib/fleetFormat";

const STATUS_STYLES: Record<string, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-800",
  RESERVED: "bg-blue-100 text-blue-800",
  IN_USE: "bg-indigo-100 text-indigo-800",
  MAINTENANCE: "bg-amber-100 text-amber-800",
  BLOCKED: "bg-red-100 text-red-800",
  CLAIMED: "bg-orange-100 text-orange-800",
  INACTIVE: "bg-slate-200 text-slate-700",
  RETURNED: "bg-slate-200 text-slate-600",
  SOLD: "bg-slate-300 text-slate-700",
  AUTHORIZED: "bg-emerald-100 text-emerald-800",
  PENDING: "bg-amber-100 text-amber-800",
  OPEN: "bg-sky-100 text-sky-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELED: "bg-slate-200 text-slate-600",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  EXPIRED: "bg-red-100 text-red-800",
  EXPIRING: "bg-amber-100 text-amber-800",
  VALID: "bg-emerald-50 text-emerald-700",
};

export function FleetStatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const text = label ?? fleetSafeCell(status);
  const style = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", style)}>
      {text}
    </span>
  );
}

export function FleetEmptyState({ message }: { message: string }) {
  return (
    <p className="py-10 text-center text-sm text-slate-500">{message}</p>
  );
}

export function FleetPermissionDenied({
  title = "Sem permissão",
  message,
}: {
  title?: string;
  message?: string;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
      <p className="text-base font-semibold text-amber-900">{title}</p>
      <p className="mt-2 text-sm text-amber-800">
        {message ??
          "Você não tem permissão para acessar o módulo Gestão de Frota. Solicite a permissão fleet.view ao administrador."}
      </p>
    </div>
  );
}

export function FleetLoading({ label = "Carregando…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500">
      <Loader2 className="h-7 w-7 animate-spin" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function FleetRequiredMark() {
  return <span className="text-red-600 ml-0.5">*</span>;
}

export { confirmFleetCriticalAction } from "@/src/lib/fleetUxShared";
export { useFleetPermissions, FLEET_UI_FORBIDDEN_MESSAGE } from "@/src/components/fleet/fleetPermissions";
export {
  formatFleetDate,
  formatFleetDateTime,
  formatFleetKm,
  formatFleetMoney,
  fleetSafeCell,
  normalizeFleetList,
  pickFleetListItems,
  pickFleetPagination,
  type FleetPaginatedMeta,
} from "@/src/lib/fleetFormat";

export function FleetListPagination({
  meta,
  loading,
  onPageChange,
}: {
  meta: import("@/src/lib/fleetFormat").FleetPaginatedMeta | null;
  loading?: boolean;
  onPageChange: (page: number) => void;
}) {
  if (!meta || meta.totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3 text-sm text-slate-600">
      <span>
        Página {meta.page} de {meta.totalPages} · {meta.total} registros
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-50"
          disabled={loading || meta.page <= 1}
          onClick={() => onPageChange(meta.page - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-200 px-3 py-1 disabled:opacity-50"
          disabled={loading || meta.page >= meta.totalPages}
          onClick={() => onPageChange(meta.page + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
