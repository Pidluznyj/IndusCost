import React from "react";
import { cn } from "@/src/lib/utils";
import { EXECUTIVE_REPORT_EMPTY_MESSAGE } from "@/src/lib/financeExecutiveReportPresentation";
import { EXECUTIVE_REPORT_AUTO_TARGET_SHORT } from "@/src/lib/financeExecutiveReportUxCopy";
import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";
import { EXECUTIVE_CHART_HEIGHT } from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export { EXECUTIVE_CHART_HEIGHT };

export function ExecutiveChartShell({
  title,
  subtitle,
  empty,
  children,
  height = EXECUTIVE_CHART_HEIGHT,
  testId,
  scenarioText,
}: {
  title: string;
  subtitle?: string;
  empty?: boolean;
  children: React.ReactNode;
  height?: number;
  testId?: string;
  scenarioText?: string;
}) {
  if (empty) {
    return (
      <div className="executive-chart-shell executive-chart executive-chart-shell--empty" data-testid={testId}>
        <ExecutiveChartHeader title={title} subtitle={subtitle} />
        <p className="executive-chart-empty-message">{EXECUTIVE_REPORT_EMPTY_MESSAGE}</p>
      </div>
    );
  }

  return (
    <div className={cn("executive-chart-shell executive-chart", empty && "executive-chart-shell--empty")} data-testid={testId}>
      <ExecutiveChartHeader title={title} subtitle={subtitle} />
      {scenarioText ? <ExecutiveChartScenario text={scenarioText} /> : null}
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
    <p className="executive-target-hint">{EXECUTIVE_REPORT_AUTO_TARGET_SHORT}</p>
  );
}
