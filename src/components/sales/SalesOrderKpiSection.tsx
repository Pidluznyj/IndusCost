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
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  testId?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (collapsible) {
    return (
      <section
        className={cn("rounded-xl border border-border/80 bg-card/30", className)}
        data-testid={testId}
      >
        <button
          type="button"
          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 rounded-xl"
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
        {open ? <div className="px-4 pb-4">{children}</div> : null}
      </section>
    );
  }

  return (
    <section className={className} data-testid={testId}>
      <div className="mb-2">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {children}
    </section>
  );
}
