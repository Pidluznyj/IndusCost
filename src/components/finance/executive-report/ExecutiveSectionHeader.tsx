import React from "react";
import {
  financeBiEyebrowClass,
  financeBiSubtitleClass,
} from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function ExecutiveSectionHeader({
  title,
  subtitle,
  eyebrow,
}: {
  title: string;
  subtitle?: string;
  eyebrow?: string;
}) {
  return (
    <header className="finance-executive-section-header mb-5">
      {eyebrow ? (
        <p className={cn(financeBiEyebrowClass, "finance-executive-section-eyebrow text-[#2563EB] mb-1")}>
          {eyebrow}
        </p>
      ) : null}
      <h2 className="finance-executive-report-section-title text-xl font-extrabold tracking-tight text-[#111827] leading-tight">
        {title}
      </h2>
      {subtitle ? (
        <p className={cn(financeBiSubtitleClass, "finance-executive-report-section-subtitle mt-1")}>
          {subtitle}
        </p>
      ) : null}
    </header>
  );
}
