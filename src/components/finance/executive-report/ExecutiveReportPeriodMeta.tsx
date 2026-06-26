import React from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function ExecutiveReportPeriodMeta({
  children,
  className,
  testId = "executive-report-period-meta",
}: {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      className={cn(
        "executive-report-period-meta flex items-start gap-1.5 text-xs text-[#6B7280] leading-snug",
        className
      )}
      data-testid={testId}
    >
      <Calendar className="h-3.5 w-3.5 shrink-0 mt-0.5 opacity-80" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
