import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
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
export { formatFleetApiError, isFleetRetryableMessage } from "@/src/lib/fleetApiError";
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

export function FleetStatusMultiFilter<T extends string>({
  options,
  selected,
  onChange,
  placeholder = "Status",
  className,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? placeholder)
        : `${selected.length} status`;

  const toggle = (value: T) => {
    onChange(
      selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]
    );
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        className={cn(
          "inline-flex min-w-[120px] items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm",
          selected.length > 0 && "border-slate-300"
        )}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={cn(selected.length === 0 && "text-slate-500")}>{label}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-400", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 min-w-[220px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50"
            >
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
              />
              <span>{o.label}</span>
            </label>
          ))}
          {selected.length > 0 && (
            <button
              type="button"
              className="mt-1 w-full border-t border-slate-100 px-3 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50"
              onClick={() => onChange([])}
            >
              Limpar seleção
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
