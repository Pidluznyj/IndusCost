import React from "react";
import { ExecutiveSectionHeader } from "@/src/components/finance/executive-report/ExecutiveSectionHeader";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
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
  withChart = false,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  eyebrow?: string;
  intro?: string;
  children: React.ReactNode;
  className?: string;
  pageBreakBefore?: boolean;
  /** Página com gráfico principal — layout mais compacto na impressão. */
  withChart?: boolean;
}) {
  return (
    <section
      id={id}
      className={cn(
        financeBiCardClass,
        "finance-executive-report-section executive-section p-6 space-y-4",
        withChart && "executive-section--with-chart",
        pageBreakBefore && "finance-executive-report-section--page-break",
        className
      )}
      data-testid={id ? `executive-report-section-${id}` : undefined}
    >
      <ExecutiveSectionHeader title={title} subtitle={subtitle} eyebrow={eyebrow} />
      {intro ? <p className="executive-section-intro text-sm text-[#6B7280] leading-relaxed -mt-2">{intro}</p> : null}
      {children}
    </section>
  );
}
