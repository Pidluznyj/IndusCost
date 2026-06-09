import React from "react";
import { Filter } from "lucide-react";
import { FINANCE_FILTER_APPLIED_SCOPE } from "@/src/lib/financeFilterScope";

export function FinanceFilterScopeBanner({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-2.5 flex items-center gap-2">
      <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
      <p className="text-[11px] font-medium text-foreground">{FINANCE_FILTER_APPLIED_SCOPE}</p>
    </div>
  );
}

export function FinanceFilterScopeNote({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[11px] text-muted-foreground ${className ?? ""}`.trim()}>{children}</p>
  );
}
