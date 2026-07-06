import React from "react";
import { cn } from "@/src/lib/utils";

export function ContextualDashboardKpiCard({
  label,
  value,
  hint,
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  /** Para valores longos (ex.: texto descritivo), use tipografia menor e multilinha. */
  valueClassName?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-2xl border border-border bg-card p-4 sm:p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 min-w-0 break-words text-xl font-bold leading-snug tracking-tight tabular-nums sm:text-2xl",
          valueClassName
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
