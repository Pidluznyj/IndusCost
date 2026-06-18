import React from "react";
import { cn } from "@/src/lib/utils";

export function ExecutiveKpiCard({
  label,
  value,
  sub,
  hint,
  tooltip,
  className,
  accent,
  highlight,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  /** Texto explicativo visível abaixo do valor */
  hint?: string;
  /** Tooltip ao passar o mouse — “O que é isso?” */
  tooltip?: string;
  className?: string;
  accent?: boolean;
  highlight?: boolean;
  tone?: "default" | "positive" | "negative" | "neutral";
}) {
  const title = tooltip ?? hint;
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
      <span className="finance-executive-kpi-label" title={title}>
        {label}
      </span>
      <span className="finance-executive-kpi-value" title={value}>
        {value}
      </span>
      {sub ? <span className="finance-executive-kpi-sub">{sub}</span> : null}
      {hint ? (
        <span className="finance-executive-kpi-hint" title={tooltip}>
          {hint}
        </span>
      ) : tooltip ? (
        <span className="finance-executive-kpi-hint finance-executive-kpi-hint--tooltip-only" title={tooltip}>
          {tooltip}
        </span>
      ) : null}
    </div>
  );
}
