import React from "react";
import { Lock } from "lucide-react";
import { cn } from "@/src/lib/utils";

/** Cartão padrão da ficha redesenhada (fundo branco, borda, cantos 12px). */
export function ProfileCard({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-background p-5 shadow-sm flex flex-col gap-4",
        className
      )}
    >
      {title ? (
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-bold text-foreground">{title}</h3>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Campo rótulo/valor empilhado, para grades de 2 colunas dentro de cartões. */
export function ProfileGridField({
  label,
  value,
  sub,
  restricted,
}: {
  label: string;
  value?: string | number | null;
  sub?: string | null;
  restricted?: boolean;
}) {
  const display =
    restricted === true
      ? null
      : value == null || String(value).trim() === ""
        ? "Não informado"
        : String(value);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      {restricted ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Informação restrita
        </span>
      ) : (
        <span className="text-sm text-foreground">{display}</span>
      )}
      {sub && !restricted ? <span className="text-[11px] text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

const STATUS_PILL_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-50 border-emerald-200 text-emerald-700",
  VACATION: "bg-sky-50 border-sky-200 text-sky-700",
  ON_LEAVE: "bg-amber-50 border-amber-200 text-amber-700",
};

const STATUS_DOT_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-600",
  VACATION: "bg-sky-500",
  ON_LEAVE: "bg-amber-500",
};

/** Pill de status com ponto colorido (verde = ativo). */
export function ProfileStatusPill({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
        STATUS_PILL_STYLES[status] ?? "bg-muted border-border text-muted-foreground"
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          STATUS_DOT_STYLES[status] ?? "bg-muted-foreground"
        )}
      />
      {label}
    </span>
  );
}

export function ProfileField({
  label,
  value,
  restricted,
}: {
  label: string;
  value?: string | number | null;
  restricted?: boolean;
}) {
  const display =
    restricted === true
      ? null
      : value == null || String(value).trim() === ""
        ? "Não informado"
        : String(value);
  return (
    <div className="grid grid-cols-[minmax(9rem,14rem)_1fr] gap-x-4 gap-y-1 py-1.5 border-b border-border/70 last:border-b-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground pt-0.5">{label}</dt>
      <dd className="text-sm text-foreground">
        {restricted ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span aria-hidden>🔒</span> Informação restrita
          </span>
        ) : (
          display
        )}
      </dd>
    </div>
  );
}

export function ProfileSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-2">
        {title}
      </h4>
      <div className="h-px bg-border mb-3" />
      <dl>{children}</dl>
    </section>
  );
}

export function ProfileState({
  kind,
  message,
}: {
  kind: "loading" | "empty" | "error" | "forbidden";
  message: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border px-4 py-6 text-sm",
        kind === "error" || kind === "forbidden"
          ? "border-border bg-muted/40 text-muted-foreground"
          : "border-border bg-background text-muted-foreground"
      )}
    >
      {message}
    </div>
  );
}

export function formatProfileDate(value: string | null | undefined): string {
  if (!value) return "Não informado";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Não informado";
  return parsed.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

export function formatProfileDateTime(value: string | null | undefined): string {
  if (!value) return "Não informado";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Não informado";
  return parsed.toLocaleString("pt-BR");
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "Não informado";
  const n = Number(value);
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

export const PROFILE_INPUT_CLASS =
  "w-full p-2 rounded-md border border-border bg-background text-sm outline-none focus:ring-1 focus:ring-foreground/30";

export const PROFILE_LABEL_CLASS = "text-[11px] uppercase tracking-wide text-muted-foreground";

export function ProfileManageSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 pt-4 border-t border-border">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mb-3">
        {title}
      </h4>
      {children}
    </section>
  );
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
