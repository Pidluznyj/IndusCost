import React from "react";
import { Link } from "react-router-dom";
import {
  AlertOctagon,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  MessageSquarePlus,
  MinusCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";
import {
  CRM_CADENCE_CONFIDENCE_HINTS,
  CRM_CADENCE_CONFIDENCE_LABELS,
  formatCrmRepurchaseSituation,
} from "@/src/lib/commercial/crmReportsLabels";
import { formatCrmReportsCustomerSublabel, formatCrmReportsInteger } from "@/src/lib/commercial/crmReportsFormat";
import type { CrmReportsCustomerChip } from "@/src/lib/commercial/crmReportsUiState";
import type { CrmReportsExportFormatChoice } from "@/src/lib/commercial/crmReportsClient";
import type {
  CrmCadenceConfidence,
  CrmReportsCustomerIdentity,
  CrmReportsLastOrderSellerFields,
  CrmReportsPage,
  CrmRepurchaseStatus,
} from "@/src/lib/commercial/crmReportsTypes";

// ---------------------------------------------------------------------------
// Situação e confiança — texto explícito, cor só reforça
// ---------------------------------------------------------------------------

const STATUS_STYLE: Record<CrmRepurchaseStatus, { className: string; icon: LucideIcon }> = {
  ON_TIME: { className: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2 },
  DUE_SOON: { className: "border-sky-200 bg-sky-50 text-sky-900", icon: CalendarClock },
  OVERDUE: { className: "border-amber-200 bg-amber-50 text-amber-900", icon: AlertTriangle },
  SEVERELY_OVERDUE: { className: "border-red-200 bg-red-50 text-red-800", icon: AlertOctagon },
  INSUFFICIENT_HISTORY: { className: "border-slate-200 bg-slate-50 text-slate-700", icon: MinusCircle },
  NO_HISTORY: { className: "border-slate-200 bg-slate-50 text-slate-700", icon: MinusCircle },
};

/** "Atrasado · 17 dias", "Recompra em 8 dias", "Sem cadência suficiente" — do motor, só traduzido. */
export function CrmRepurchaseStatusBadge({
  status,
  deltaDays,
}: {
  status: CrmRepurchaseStatus;
  deltaDays: number | null;
}) {
  const style = STATUS_STYLE[status];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex min-w-[8.25rem] max-w-[11rem] items-start gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-semibold leading-snug",
        style.className
      )}
      data-status={status}
    >
      <Icon className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
      {formatCrmRepurchaseSituation(status, deltaDays)}
    </span>
  );
}

const CONFIDENCE_STYLE: Record<CrmCadenceConfidence, string> = {
  NONE: "text-slate-600",
  LOW: "text-amber-800",
  MEDIUM: "text-sky-800",
  HIGH: "text-emerald-800",
};

export function CrmCadenceConfidenceBadge({ confidence }: { confidence: CrmCadenceConfidence }) {
  return (
    <span
      className={cn("whitespace-nowrap text-xs font-semibold", CONFIDENCE_STYLE[confidence])}
      title={CRM_CADENCE_CONFIDENCE_HINTS[confidence]}
    >
      {CRM_CADENCE_CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Células de identidade (Cliente, Responsável Comercial, Vendedor do pedido)
// ---------------------------------------------------------------------------

export function CrmReportsCustomerCell({
  row,
  canOpenCustomer360,
}: {
  row: CrmReportsCustomerIdentity;
  canOpenCustomer360: boolean;
}) {
  const trade = row.tradeName?.trim();
  const showTrade = Boolean(trade) && trade!.toLowerCase() !== row.displayName.trim().toLowerCase();
  return (
    <div className="min-w-[165px] max-w-[260px]">
      {canOpenCustomer360 ? (
        <Link
          to={buildCustomerIntelligencePath(row.customerId)}
          className="font-semibold text-foreground hover:text-primary hover:underline"
          title="Abrir Cliente 360"
        >
          {row.displayName}
        </Link>
      ) : (
        <span className="font-semibold text-foreground">{row.displayName}</span>
      )}
      {showTrade ? <p className="text-xs text-muted-foreground truncate">{trade}</p> : null}
      <p className="text-[11px] text-muted-foreground tabular-nums">{formatCrmReportsCustomerSublabel(row)}</p>
    </div>
  );
}

/** Responsável Comercial = dono da carteira (CrmCustomerCommercialOwner). */
export function CrmReportsOwnerCell({ name }: { name: string | null }) {
  return name ? (
    <span className="whitespace-nowrap text-foreground">{name}</span>
  ) : (
    <span className="whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
      Sem responsável comercial
    </span>
  );
}

/** Vendedor Nomus do último pedido — auditoria, nunca carteira. */
export function CrmReportsLastOrderSellerCell({ row }: { row: CrmReportsLastOrderSellerFields }) {
  return (
    <div className="min-w-[115px]">
      <span className="text-foreground">{row.lastOrderSellerLabel}</span>
      {row.lastOrderCode ? (
        <p className="text-[11px] text-muted-foreground tabular-nums">Pedido {row.lastOrderCode}</p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ações por linha — Cliente 360 canônico, pedido canônico, contato canônico
// ---------------------------------------------------------------------------

export type CrmReportsRowActionHandlers = {
  canOpenCustomer360: boolean;
  canOpenOrderDetail: boolean;
  canRegisterContact: boolean;
  onOpenOrder: (orderId: string, orderCode: string | null) => void;
  onRegisterContact: (customer: { customerId: string; displayName: string; taxId: string }) => void;
};

const ACTION_CLASS =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-lg border px-1.5 py-1 text-[11px] font-semibold transition-colors";

export function CrmReportsRowActions({
  row,
  actions,
}: {
  row: CrmReportsCustomerIdentity & Partial<Pick<CrmReportsLastOrderSellerFields, "lastOrderId" | "lastOrderCode">>;
  actions: CrmReportsRowActionHandlers;
}) {
  const lastOrderId = row.lastOrderId ?? null;
  const orderTitle = row.lastOrderCode ? `Abrir último pedido ${row.lastOrderCode}` : "Abrir último pedido";
  // Rótulo visível curto (a coluna fica fixa à direita); nome acessível completo.
  return (
    <div className="flex items-center gap-1">
      {actions.canOpenCustomer360 ? (
        <Link
          to={buildCustomerIntelligencePath(row.customerId)}
          className={cn(ACTION_CLASS, "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15")}
          title="Cliente 360 (Inteligência do Cliente)"
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
          Cliente 360
        </Link>
      ) : null}
      {actions.canOpenOrderDetail && lastOrderId ? (
        <button
          type="button"
          onClick={() => actions.onOpenOrder(lastOrderId, row.lastOrderCode ?? null)}
          className={cn(ACTION_CLASS, "border-border bg-background text-foreground hover:bg-accent")}
          title={orderTitle}
          aria-label={orderTitle}
        >
          <FileText className="h-3 w-3" aria-hidden />
          Pedido
        </button>
      ) : null}
      {actions.canRegisterContact ? (
        <button
          type="button"
          onClick={() =>
            actions.onRegisterContact({ customerId: row.customerId, displayName: row.displayName, taxId: row.taxId })
          }
          className={cn(ACTION_CLASS, "border-border bg-background text-foreground hover:bg-accent")}
          title="Registrar contato comercial"
          aria-label={`Registrar contato com ${row.displayName}`}
        >
          <MessageSquarePlus className="h-3 w-3" aria-hidden />
          Contato
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marcação por linha
// ---------------------------------------------------------------------------

export function CrmReportsRowCheckbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-border accent-primary"
      checked={checked}
      onChange={onChange}
      aria-label={label}
    />
  );
}

/** Marca/desmarca todas as linhas DA PÁGINA atual. */
export function CrmReportsPageCheckbox<Row>({
  page,
  chipOf,
  checked,
  onToggleMany,
}: {
  page: CrmReportsPage<Row>;
  chipOf: (row: Row) => CrmReportsCustomerChip;
  checked: ReadonlyMap<string, CrmReportsCustomerChip>;
  onToggleMany: (chips: CrmReportsCustomerChip[], on: boolean) => void;
}) {
  const chips = page.rows.map(chipOf);
  const all = page.returned > 0 && chips.every((chip) => checked.has(chip.id));
  return (
    <input
      type="checkbox"
      className="h-4 w-4 rounded border-border accent-primary"
      checked={all}
      disabled={page.returned === 0}
      onChange={() => onToggleMany(chips, !all)}
      aria-label="Marcar todos os clientes desta página"
    />
  );
}

// ---------------------------------------------------------------------------
// Paginação real (backend) e exportação
// ---------------------------------------------------------------------------

export function CrmReportsPagination<Row>({
  page,
  disabled,
  onChange,
}: {
  page: CrmReportsPage<Row>;
  disabled?: boolean;
  onChange: (offset: number) => void;
}) {
  if (page.total === 0) return null;
  const from = page.offset + 1;
  const to = page.offset + page.returned;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
      <span className="tabular-nums">
        Mostrando {formatCrmReportsInteger(from)}–{formatCrmReportsInteger(to)} de{" "}
        <strong className="text-foreground">{formatCrmReportsInteger(page.total)}</strong>
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={disabled || page.offset === 0}
          onClick={() => onChange(Math.max(0, page.offset - page.limit))}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-semibold text-foreground hover:bg-accent disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Anterior
        </button>
        <button
          type="button"
          disabled={disabled || !page.hasMore}
          onClick={() => onChange(page.offset + page.limit)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1 font-semibold text-foreground hover:bg-accent disabled:opacity-40"
        >
          Próxima
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function CrmReportsExportButtons({
  busy,
  disabled,
  onExport,
}: {
  busy: CrmReportsExportFormatChoice | null;
  disabled?: boolean;
  onExport: (format: CrmReportsExportFormatChoice) => void;
}) {
  return (
    <div className="flex items-center gap-1.5" aria-label="Exportar">
      {(["csv", "xlsx"] as const).map((format) => (
        <button
          key={format}
          type="button"
          disabled={disabled || busy != null}
          onClick={() => onExport(format)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:bg-accent disabled:opacity-50"
          title={`Exportar a lista inteira em ${format.toUpperCase()} (mesmos filtros da tela)`}
        >
          {busy === format ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Download className="h-3.5 w-3.5" aria-hidden />
          )}
          {format.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moldura de lista + estados
// ---------------------------------------------------------------------------

export function CrmReportsListShell({
  id,
  title,
  description,
  total,
  refreshing,
  controls,
  toolbar,
  children,
}: {
  id: string;
  title: string;
  description: string;
  /** Total da lista no universo (backend) — nunca o tamanho da página. */
  total: number;
  refreshing: boolean;
  controls?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-4 rounded-2xl border border-border bg-card shadow-sm overflow-hidden"
      aria-label={title}
      aria-busy={refreshing}
      data-testid={id}
    >
      <div className="flex flex-col gap-3 border-b border-border/60 px-4 pb-3 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold text-foreground">{title}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
              {formatCrmReportsInteger(total)} {total === 1 ? "cliente" : "clientes"}
            </span>
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin text-primary" aria-label="Atualizando" /> : null}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
        {toolbar ? <div className="flex shrink-0 flex-wrap items-center gap-2">{toolbar}</div> : null}
      </div>
      {controls ? <div className="border-b border-border/60 bg-muted/20 px-4 py-2.5">{controls}</div> : null}
      <div className={cn("transition-opacity", refreshing && "opacity-60")}>{children}</div>
    </section>
  );
}

export function CrmReportsEmptyRows({ colSpan, filtered }: { colSpan: number; filtered: boolean }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
        {filtered
          ? "Nenhum cliente nesta lista com os filtros atuais."
          : "Nenhum cliente nesta lista no seu universo."}
      </td>
    </tr>
  );
}

// Cabeçalho quebra em 2 linhas (não é ele que define a largura da coluna).
export const CRM_REPORTS_TH =
  "px-2.5 py-2.5 text-left align-bottom text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground";
export const CRM_REPORTS_TH_RIGHT = `${CRM_REPORTS_TH} text-right`;
export const CRM_REPORTS_TD = "px-2.5 py-2.5 align-top";
export const CRM_REPORTS_TD_NUM = "px-2.5 py-2.5 align-top whitespace-nowrap text-right tabular-nums";
/** Linha de cabeçalho / corpo com fundo opaco (a coluna Ações fixa herda o fundo). */
export const CRM_REPORTS_HEAD_ROW = "border-b border-border/60 bg-slate-50";
export function crmReportsBodyRowClass(checked: boolean): string {
  return cn("border-b border-border/40 last:border-0", checked ? "bg-sky-50" : "bg-card");
}
/** Coluna Ações fixa à direita a partir de telas médias — visível mesmo com rolagem horizontal. */
export const CRM_REPORTS_STICKY_ACTIONS =
  "bg-inherit md:sticky md:right-0 md:z-10 md:shadow-[inset_1px_0_0_0_var(--color-border)]";
