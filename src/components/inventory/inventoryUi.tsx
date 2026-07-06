/**

 * Labels e helpers de UI do módulo Estoque — sem dependências server-only.

 */

import React, { useState } from "react";

import { ChevronDown, ChevronUp, HelpCircle, Loader2 } from "lucide-react";

import { cn } from "@/src/lib/utils";

import { safeTrim } from "@/src/lib/safeTrim.js";

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



const OPERATIONAL_STATUS_STYLES: Record<string, string> = {

  OK: "bg-emerald-50 text-emerald-800 ring-emerald-200",

  ATTENTION: "bg-amber-50 text-amber-800 ring-amber-200",

  CRITICAL: "bg-orange-50 text-orange-800 ring-orange-200",

  OUT_OF_STOCK: "bg-red-50 text-red-800 ring-red-200",

  NEGATIVE: "bg-red-100 text-red-900 ring-red-300 font-semibold",

  BLOCKED: "bg-slate-100 text-slate-700 ring-slate-300",

  QUARANTINE: "bg-violet-50 text-violet-800 ring-violet-200",

  INACTIVE: "bg-slate-50 text-slate-500 ring-slate-200",

};



export function inventoryOperationalStatusClassName(status: string): string {

  return OPERATIONAL_STATUS_STYLES[status] ?? "bg-slate-50 text-slate-700 ring-slate-200";

}



export function InventoryOperationalStatusBadge({ status }: { status: string }) {

  return (

    <span

      className={cn(

        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",

        inventoryOperationalStatusClassName(status)

      )}

      data-testid={`inventory-status-${status}`}

    >

      {formatInventoryOperationalStatus(status)}

    </span>

  );

}



export function InventoryPermissionDenied({

  permissionHint = "inventory.view",

  message,

}: {

  permissionHint?: string;

  message?: string;

}) {

  return (

    <div

      className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center"

      data-testid="inventory-permission-denied"

    >

      <p className="text-base font-semibold text-amber-900">Sem permissão</p>

      <p className="mt-2 text-sm text-amber-800">

        {message ?? (

          <>

            Você não tem permissão para esta ação. Solicite a permissão{" "}

            <strong>{permissionHint}</strong> ao administrador.

          </>

        )}

      </p>

    </div>

  );

}



export function inventoryActionDeniedTitle(action: string): string {

  return `Sem permissão para ${action}. Solicite acesso ao gestor de estoque.`;

}



export function InventoryLoading({ label = "Carregando…" }: { label?: string }) {

  return (

    <div

      className="flex flex-col items-center justify-center gap-2 py-12 text-slate-500"

      data-testid="inventory-loading"

      role="status"

      aria-live="polite"

    >

      <Loader2 className="h-7 w-7 animate-spin" aria-hidden />

      <span className="text-sm">{label}</span>

    </div>

  );

}



export type InventoryEmptyStateProps = {

  message?: string;

  title?: string;

  description?: string;

  actionLabel?: string;

  onAction?: () => void;

  testId?: string;

};



export function InventoryEmptyState({

  message,

  title = "Nenhum resultado",

  description,

  actionLabel,

  onAction,

  testId = "inventory-empty-state",

}: InventoryEmptyStateProps) {

  const body = description ?? message ?? "Não há dados para exibir no momento.";

  return (

    <div

      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-10 text-center"

      data-testid={testId}

    >

      <p className="text-base font-semibold text-slate-800">{title}</p>

      <p className="mt-2 max-w-md text-sm text-slate-600">{body}</p>

      {actionLabel && onAction ? (

        <button

          type="button"

          onClick={onAction}

          className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"

        >

          {actionLabel}

        </button>

      ) : null}

    </div>

  );

}



export function InventorySectionIntro({

  title,

  description,

  testId,

}: {

  title: string;

  description: string;

  testId?: string;

}) {

  return (

    <div

      className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-700"

      data-testid={testId}

    >

      <p className="font-medium text-slate-900">{title}</p>

      <p className="mt-1">{description}</p>

    </div>

  );

}



export function InventoryCollapsibleFilters({

  title = "Filtros",

  defaultOpen = true,

  activeCount = 0,

  children,

  onClear,

}: {

  title?: string;

  defaultOpen?: boolean;

  activeCount?: number;

  children: React.ReactNode;

  onClear?: () => void;

}) {

  const [open, setOpen] = useState(defaultOpen);

  return (

    <section

      className="rounded-xl border border-slate-200 bg-white shadow-sm"

      data-testid="inventory-collapsible-filters"

    >

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">

        <button

          type="button"

          onClick={() => setOpen((v) => !v)}

          aria-expanded={open}

          className="inline-flex items-center gap-2 text-sm font-medium text-slate-800"

        >

          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}

          {title}

          {activeCount > 0 ? (

            <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">

              {activeCount}

            </span>

          ) : null}

        </button>

        {onClear ? (

          <button

            type="button"

            onClick={onClear}

            className="text-xs font-medium text-slate-600 underline hover:text-slate-900"

          >

            Limpar filtros

          </button>

        ) : null}

      </div>

      {open ? <div className="flex flex-wrap items-end gap-2 p-3">{children}</div> : null}

    </section>

  );

}



export const INVENTORY_BALANCE_GLOSSARY: ReadonlyArray<{ term: string; description: string }> = [

  { term: "Saldo físico", description: "Quantidade teórica existente no estoque." },

  { term: "Saldo reservado", description: "Quantidade comprometida para uso futuro." },

  { term: "Saldo bloqueado", description: "Quantidade existente, mas indisponível para uso." },

  { term: "Quarentena", description: "Quantidade aguardando inspeção ou liberação." },

  { term: "Saldo disponível", description: "Quantidade realmente utilizável." },

];



export const INVENTORY_BALANCE_COLUMN_TOOLTIPS: Readonly<Record<string, string>> = {
  Físico: INVENTORY_BALANCE_GLOSSARY[0]!.description,
  Reservado: INVENTORY_BALANCE_GLOSSARY[1]!.description,
  Bloqueado: INVENTORY_BALANCE_GLOSSARY[2]!.description,
  Quarentena: INVENTORY_BALANCE_GLOSSARY[3]!.description,
  Disponível: INVENTORY_BALANCE_GLOSSARY[4]!.description,
};

export function InventoryBalanceColumnHeader({ label }: { label: string }) {
  const tip = INVENTORY_BALANCE_COLUMN_TOOLTIPS[label];
  return (
    <th scope="col" title={tip}>
      <span className="inline-flex items-center gap-1">
        {label}
        {tip ? <HelpCircle className="h-3 w-3 text-slate-400" aria-hidden /> : null}
      </span>
    </th>
  );
}

export function InventoryBalanceGlossary({ compact = false }: { compact?: boolean }) {

  return (

    <div

      className={cn(

        "rounded-xl border border-slate-200 bg-white shadow-sm",

        compact ? "p-3" : "p-4"

      )}

      data-testid="inventory-balance-glossary"

    >

      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">

        Entenda os saldos

      </p>

      <ul className={cn("gap-2", compact ? "space-y-1.5" : "grid sm:grid-cols-2 lg:grid-cols-3")}>

        {INVENTORY_BALANCE_GLOSSARY.map((item) => (

          <li key={item.term} className="flex items-start gap-1.5 text-sm text-slate-700">

            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />

            <span>

              <strong className="font-medium text-slate-900">{item.term}:</strong>{" "}

              <span title={item.description}>{item.description}</span>

            </span>

          </li>

        ))}

      </ul>

    </div>

  );

}



export function InventoryTableScroll({ children }: { children: React.ReactNode }) {

  return (

    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">

      {children}

    </div>

  );

}



export function InventoryFilterField({

  label,

  children,

  className,

}: {

  label: string;

  children: React.ReactNode;

  className?: string;

}) {

  return (

    <label className={cn("flex flex-col gap-1 text-sm", className)}>

      <span className="text-xs font-medium text-slate-600">{label}</span>

      {children}

    </label>

  );

}



export const inventoryFilterInputClass =

  "rounded-lg border border-slate-200 px-2 py-2 text-sm min-h-[38px]";



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

      <p className="mt-4 inline-flex rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700">

        Em breve

      </p>

    </div>

  );

}



export function InventoryErrorBanner({

  message,

  onDismiss,

  testId = "inventory-error-banner",

}: {

  message: string;

  onDismiss?: () => void;

  testId?: string;

}) {

  return (

    <div

      className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"

      data-testid={testId}

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

    "w-full min-w-[640px] text-left text-sm",

    "[&_th]:border-b [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-2 [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-slate-500",

    "[&_td]:max-w-[280px] [&_td]:truncate [&_td]:border-b [&_td]:border-slate-100 [&_td]:px-3 [&_td]:py-2 [&_td]:text-slate-700",

    "[&_tbody_tr:hover]:bg-slate-50/80"

  );

}



export function formatInventoryApiError(error: unknown, fallback: string): string {

  if (error instanceof Error) {

    const msg = safeTrim(error.message);

    if (msg) return msg;

  }

  return fallback;

}


