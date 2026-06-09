import React from "react";
import { cn } from "@/src/lib/utils";

export function FinanceBillingExecutiveCard({
  label,
  value,
  sub,
  hint,
  colorClass = "text-foreground",
  loading = false,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  colorClass?: string;
  loading?: boolean;
}) {
  return (
    <div
      className="rounded-2xl border border-border/70 bg-white dark:bg-card p-5 shadow-sm space-y-2"
      title={hint}
    >
      <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      {loading ? (
        <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
      ) : (
        <p className={cn("text-2xl font-extrabold tracking-tight leading-none", colorClass)}>
          {value}
        </p>
      )}
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}
