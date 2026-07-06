import React from "react";
import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function ModuleIndicatorsButton({
  to,
  className,
}: {
  to: string;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-foreground shadow-sm transition-colors hover:bg-accent",
        className
      )}
    >
      <BarChart3 className="h-4 w-4 text-primary" />
      Indicadores
    </Link>
  );
}
