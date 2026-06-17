import React from "react";
import { EXECUTIVE_REPORT_EMPTY_MESSAGE } from "@/src/lib/financeExecutiveReportPresentation";

export const EXECUTIVE_CHART_HEIGHT = 380;

export function ExecutiveChartShell({
  title,
  subtitle,
  empty,
  children,
  height = EXECUTIVE_CHART_HEIGHT,
  testId,
}: {
  title: string;
  subtitle?: string;
  empty?: boolean;
  children: React.ReactNode;
  height?: number;
  testId?: string;
}) {
  if (empty) {
    return (
      <div className="executive-chart-shell executive-chart-shell--empty" data-testid={testId}>
        <ExecutiveChartHeader title={title} subtitle={subtitle} />
        <p className="executive-chart-empty-message">{EXECUTIVE_REPORT_EMPTY_MESSAGE}</p>
      </div>
    );
  }

  return (
    <div className="executive-chart-shell" data-testid={testId}>
      <ExecutiveChartHeader title={title} subtitle={subtitle} />
      <div className="executive-chart-body" style={{ height }}>
        {children}
      </div>
    </div>
  );
}

function ExecutiveChartHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="executive-chart-header">
      <h3 className="executive-chart-title">{title}</h3>
      {subtitle ? <p className="executive-chart-subtitle">{subtitle}</p> : null}
    </div>
  );
}

export function ExecutiveTargetHint({ missing }: { missing: boolean }) {
  if (!missing) return null;
  return (
    <p className="executive-target-hint">
      Meta não cadastrada para este período.
    </p>
  );
}
