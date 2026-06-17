import React from "react";
import { cn } from "@/src/lib/utils";

export function ExecutiveReportSection({
  id,
  title,
  subtitle,
  children,
  className,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn("finance-executive-report-section", className)}
      data-testid={id ? `executive-report-section-${id}` : undefined}
    >
      <h2 className="finance-executive-report-section-title">{title}</h2>
      {subtitle ? <p className="finance-executive-report-section-subtitle">{subtitle}</p> : null}
      {children}
    </section>
  );
}
