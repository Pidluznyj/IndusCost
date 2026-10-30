/**
 * Inteligência Fiscal 360° — peças visuais compartilhadas (padrão Financeiro › Tributos).
 */
import React, { useEffect } from "react";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";

export function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceCurrency(value);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export type Tone = "neutral" | "good" | "warn" | "danger" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-[#F3F4F6] text-[#4B5563]",
  good: "bg-[#ECFDF5] text-[#047857]",
  warn: "bg-[#FFFBEB] text-[#B45309]",
  danger: "bg-[#FEF2F2] text-[#B91C1C]",
  info: "bg-[#EFF6FF] text-[#1D4ED8]",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold", TONE[tone])}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  if (["PAID_PROVEN", "OK", "ACCEPTED", "AUTHORIZED", "SUCCEEDED", "TAX", "RESOLVED"].includes(status)) return "good";
  if (["OVERDUE", "DIVERGENT", "CANCELLED", "FAILED", "CRITICAL", "REVERSED"].includes(status)) return "danger";
  if (["PARTIAL", "PAID_DECLARED", "REVIEW", "PENDING", "MISSING", "WARNING", "PAID_ERP", "RUNNING", "INSUFFICIENT_DATA"].includes(status)) return "warn";
  if (["OPEN", "INFO"].includes(status)) return "info";
  return "neutral";
}

export function KpiCard({
  label,
  value,
  hint,
  source,
  tone,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  source?: string;
  tone?: Tone;
  testId?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5" data-testid={testId}>
      <p className="truncate text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]" title={label}>
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 truncate text-[16px] font-bold tabular-nums",
          tone === "danger" ? "text-[#B91C1C]" : tone === "good" ? "text-[#047857]" : tone === "warn" ? "text-[#B45309]" : "text-[#111827]"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-[10px] text-[#6B7280]">{hint}</p> : null}
      {source ? <p className="mt-0.5 truncate text-[10px] text-[#9CA3AF]" title={source}>Fonte: {source}</p> : null}
    </div>
  );
}

export function KpiGrid({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-4" data-testid={testId}>
      {children}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  actions,
  children,
  testId,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-[#E5E7EB] bg-white p-3 sm:p-4" data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-bold text-[#111827]">{title}</h3>
          {subtitle ? <p className="text-[11px] text-[#6B7280]">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Callout({ children, tone = "info" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-[11px]",
        tone === "warn" ? "border-[#FDE68A] bg-[#FFFBEB] text-[#92400E]" : tone === "danger" ? "border-[#FECACA] bg-[#FEF2F2] text-[#991B1B]" : "border-[#DBEAFE] bg-[#EFF6FF] text-[#1E3A8A]"
      )}
    >
      {children}
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-[#E5E7EB] px-3 py-8 text-center text-[12px] text-[#6B7280]">{children}</div>;
}

export function LoadingState({ label = "Carregando dados materializados…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-[#6B7280]">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]" role="alert">
      {message}
    </p>
  );
}

export type Column<T> = {
  key: string;
  header: React.ReactNode;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
  testId,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  testId?: string;
}) {
  if (rows.length === 0) return <EmptyState>{empty ?? "Sem registros para o filtro."}</EmptyState>;
  return (
    <div className="overflow-x-auto rounded-md border border-[#E5E7EB]">
      <table className="min-w-full text-left text-[12px]" data-testid={testId}>
        <thead className="bg-[#F9FAFB] text-[10px] uppercase tracking-wide text-[#6B7280]">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={cn("whitespace-nowrap px-3 py-2 font-bold", c.align === "right" && "text-right")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn("border-t border-[#F3F4F6]", onRowClick && "cursor-pointer hover:bg-[#F5F8FF]")}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => (e.key === "Enter" ? onRowClick(row) : undefined) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn("px-3 py-2 align-top", c.align === "right" && "text-right tabular-nums", c.className)}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6B7280]" data-testid="fiscal360-pagination">
      <span>
        {total === 0 ? "0 registros" : `${(page - 1) * pageSize + 1}–${Math.min(total, page * pageSize)} de ${total.toLocaleString("pt-BR")}`}
      </span>
      <div className="flex items-center gap-1">
        <button type="button" className="rounded border border-[#E5E7EB] p-1 disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <span className="px-1">
          {page}/{pages}
        </span>
        <button type="button" className="rounded border border-[#E5E7EB] p-1 disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página">
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

export function Drawer({ open, title, subtitle, onClose, children }: { open: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title} data-testid="fiscal360-drawer">
      <div className="absolute inset-0 bg-[#0B1220]/40" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-bold text-[#111827]">{title}</h2>
            {subtitle ? <p className="text-[11px] text-[#6B7280]">{subtitle}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-[#E5E7EB] p-1.5" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">{children}</div>
      </aside>
    </div>
  );
}

export function KeyValue({ items }: { items: Array<[string, React.ReactNode]> }) {
  return (
    <dl className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-md bg-[#F9FAFB] px-3 py-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">{k}</dt>
          <dd className="mt-0.5 break-words text-[12px] font-semibold text-[#111827]">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Meter({ value, tone = "info", label }: { value: number | null; tone?: Tone; label: string }) {
  const width = value == null ? 0 : Math.max(0, Math.min(100, value));
  const color = tone === "good" ? "bg-[#059669]" : tone === "warn" ? "bg-[#D97706]" : tone === "danger" ? "bg-[#DC2626]" : "bg-[#2563EB]";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="font-semibold text-[#374151]">{label}</span>
        <span className="font-bold tabular-nums text-[#111827]">{value == null ? "—" : pct(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#EEF2F7]" role="meter" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full", color)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function ButtonLike({
  children,
  onClick,
  variant = "secondary",
  disabled,
  testId,
  title,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "quiet" | "danger";
  disabled?: boolean;
  testId?: string;
  title?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-[#1e3a8a] text-white hover:bg-[#1e40af]",
        variant === "secondary" && "border border-[#E5E7EB] bg-white text-[#111827] hover:border-[#93C5FD]",
        variant === "quiet" && "bg-[#EFF6FF] text-[#1D4ED8] hover:bg-[#DBEAFE]",
        variant === "danger" && "border border-[#FECACA] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]"
      )}
    >
      {children}
    </button>
  );
}
