import React from "react";
import { cn } from "@/src/lib/utils";

export function ExecutiveKpiCard({
  label,
  value,
  sub,
  hint,
  className,
  accent,
  highlight,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  className?: string;
  accent?: boolean;
  highlight?: boolean;
  tone?: "default" | "positive" | "negative" | "neutral";
}) {
  return (
    <div
      className={cn(
        "finance-executive-kpi-card",
        accent && "finance-executive-kpi-card--accent",
        highlight && "finance-executive-kpi-card--highlight",
        tone === "positive" && "finance-executive-kpi-card--positive",
        tone === "negative" && "finance-executive-kpi-card--negative",
        className
      )}
    >
      <span className="finance-executive-kpi-label">{label}</span>
      <span className="finance-executive-kpi-value">{value}</span>
      {sub ? <span className="finance-executive-kpi-sub">{sub}</span> : null}
      {hint ? <span className="finance-executive-kpi-hint">{hint}</span> : null}
    </div>
  );
}
