import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function SalesOrderKpiSection({
  title,
  subtitle,
  children,
  testId,
  collapsible = false,
  defaultOpen = true,
  panel = true,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  testId?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Superfície sólida com borda — evita cards “soltos” no fundo da página. */
  panel?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const panelClass = panel
    ? "rounded-xl border border-border bg-card shadow-sm"
    : undefined;

  if (collapsible) {
    return (
      <section
        className={cn(panelClass, className)}
        data-testid={testId}
        data-panel={panel ? "true" : "false"}
      >
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 rounded-xl transition-colors"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <div>
            <h2 className="text-sm font-bold text-foreground">{title}</h2>
            {subtitle ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
            ) : null}
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform mt-0.5",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </button>
        {open ? <div className="px-4 pb-4 pt-1">{children}</div> : null}
      </section>
    );
  }

  return (
    <section
      className={cn(panelClass, panel && "p-4 min-w-0 overflow-hidden", className)}
      data-testid={testId}
      data-panel={panel ? "true" : "false"}
    >
      <div className={cn(panel ? "mb-3" : "mb-2")}>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
