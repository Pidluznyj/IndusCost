import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

export function ContextualDashboardLayout({
  moduleLabel,
  backPath,
  backLabel = "Voltar à operação",
  children,
}: {
  moduleLabel: string;
  backPath: string;
  backLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-border bg-card/50 px-4 py-3">
        <Link
          to={backPath}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline w-fit"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{moduleLabel}</p>
      </div>
      {children}
    </div>
  );
}
