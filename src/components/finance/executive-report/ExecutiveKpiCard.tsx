import React from "react";
import { cn } from "@/src/lib/utils";

export function ExecutiveKpiCard({
  label,
  value,
  sub,
  className,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  className?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "finance-executive-kpi-card",
        accent && "border-[#1e3a5f]/20 bg-[#eff6ff]",
        className
      )}
    >
      <span className="finance-executive-kpi-label">{label}</span>
      <span className="finance-executive-kpi-value">{value}</span>
      {sub ? <span className="finance-executive-kpi-sub">{sub}</span> : null}
    </div>
  );
}
