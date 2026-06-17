import React from "react";
import { ExecutiveSectionHeader } from "@/src/components/finance/executive-report/ExecutiveSectionHeader";
import { cn } from "@/src/lib/utils";

export function ExecutiveReportSection({
  id,
  title,
  subtitle,
  eyebrow,
  intro,
  children,
  className,
  pageBreakBefore,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  intro?: string;
  children: React.ReactNode;
  className?: string;
  pageBreakBefore?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        "finance-executive-report-section executive-section",
        pageBreakBefore && "finance-executive-report-section--page-break",
        className
      )}
      data-testid={id ? `executive-report-section-${id}` : undefined}
    >
      <ExecutiveSectionHeader title={title} subtitle={subtitle} eyebrow={eyebrow} />
      {intro ? <p className="executive-section-intro">{intro}</p> : null}
      {children}
    </section>
  );
}
