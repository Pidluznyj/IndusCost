import React from "react";
import { cn } from "@/src/lib/utils";

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
