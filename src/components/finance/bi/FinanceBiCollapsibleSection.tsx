import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function FinanceBiCollapsibleSection({
  title,
  subtitle,
  defaultExpanded = false,
  trailing,
  alert,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  trailing?: React.ReactNode;
  alert?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className={cn(financeBiSectionClass, className)}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-[#F9FAFB] transition-colors text-left"
      >
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-[#111827]">{title}</p>
          {subtitle ? (
            <p className="text-[11px] text-[#6B7280] leading-snug">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {trailing}
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-[#6B7280]" />
          ) : (
            <ChevronDown className="h-4 w-4 text-[#6B7280]" />
          )}
        </div>
      </button>

      {alert && !expanded ? (
        <div className="border-t border-[#E5E7EB] px-4 py-2">{alert}</div>
      ) : null}

      {expanded ? (
        <div className="border-t border-[#E5E7EB] px-4 py-4 bg-[#F9FAFB]/40">{children}</div>
      ) : null}
    </section>
  );
}
