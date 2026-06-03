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
export {
  formatFleetDate,
  formatFleetDateTime,
  formatFleetKm,
  formatFleetMoney,
  fleetSafeCell,
  normalizeFleetList,
} from "@/src/lib/fleetFormat";
