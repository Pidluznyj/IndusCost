import React from "react";

export function ContextualDashboardKpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tracking-tight mt-1 tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{hint}</p> : null}
    </div>
  );
}
