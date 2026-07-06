import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/src/lib/utils";

import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

import { EXECUTIVE_REPORT_EMPTY_MESSAGE } from "@/src/lib/financeExecutiveReportPresentation";

import { EXECUTIVE_REPORT_AUTO_TARGET_SHORT } from "@/src/lib/financeExecutiveReportUxCopy";

import { ExecutiveChartScenario } from "@/src/components/finance/executive-report/charts/ExecutiveChartScenario";

import { useExecutiveReportPdfMode } from "@/src/components/finance/executive-report/ExecutiveReportPrintContext";

import {
  EXECUTIVE_CHART_HEIGHT,
  EXECUTIVE_CHART_PRINT_HEIGHT_PX,
} from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

import { ExecutiveChartFrameContext } from "@/src/components/finance/executive-report/charts/executiveChartFrameContext";

import { BarChart3 } from "lucide-react";



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

  const pdfMode = useExecutiveReportPdfMode();
  const frameHeight = pdfMode ? EXECUTIVE_CHART_PRINT_HEIGHT_PX : height;

  const frameRef = useRef<HTMLDivElement>(null);
  const [frameWidth, setFrameWidth] = useState(960);

  useLayoutEffect(() => {
    if (empty) return;
    const node = frameRef.current;
    if (!node) return;

    const updateWidth = () => {
      const next = Math.max(Math.floor(node.clientWidth), 480);
      setFrameWidth(next);
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, [empty, frameHeight, title]);

  useEffect(() => {

    if (empty) return;

    const node = frameRef.current;

    if (!node) return;

    node.removeAttribute("data-chart-ready");

    let cancelled = false;

    const markReady = () => {

      if (!cancelled) node.setAttribute("data-chart-ready", "true");

    };

    const timer = window.setTimeout(() => {

      window.dispatchEvent(new Event("resize"));

      window.setTimeout(markReady, 300);

    }, 0);

    return () => {

      cancelled = true;

      window.clearTimeout(timer);

      node.removeAttribute("data-chart-ready");

    };

  }, [empty, frameHeight, title]);



  if (empty) {

    return (

      <div

        className={cn(

          financeBiCardClass,

          "executive-chart-shell executive-chart executive-chart-shell--empty p-5 flex flex-col justify-center min-h-[14rem]"

        )}

        data-testid={testId}

        data-report-chart

        data-chart-empty="true"

      >

        <ExecutiveChartHeader title={title} subtitle={subtitle} />

        <div className="flex flex-col items-center justify-center py-8 text-center">

          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]">

            <BarChart3 className="h-5 w-5" />

          </div>

          <p className="executive-chart-empty-message text-sm text-[#6B7280]">

            {EXECUTIVE_REPORT_EMPTY_MESSAGE}

          </p>

        </div>

      </div>

    );

  }



  return (

    <div

      className={cn(

        financeBiCardClass,

        "executive-chart-shell executive-chart p-5 space-y-3 flex flex-col",

        empty && "executive-chart-shell--empty"

      )}

      data-testid={testId}

    >

      <ExecutiveChartHeader title={title} subtitle={subtitle} />

      {scenarioText ? <ExecutiveChartScenario text={scenarioText} /> : null}

      <ExecutiveChartFrameContext.Provider value={{ width: frameWidth, height: frameHeight }}>

        <div

          ref={frameRef}

          className="executive-chart-body executive-report-chart-frame"

          data-report-chart

          style={{ height: frameHeight, minHeight: frameHeight }}

        >

          {children}

        </div>

      </ExecutiveChartFrameContext.Provider>

    </div>

  );

}



function ExecutiveChartHeader({ title, subtitle }: { title: string; subtitle?: string }) {

  return (

    <div className="executive-chart-header">

      <h3 className="executive-chart-title text-sm font-bold text-[#111827]">{title}</h3>

      {subtitle ? (

        <p className="executive-chart-subtitle text-[11px] text-[#6B7280] mt-0.5 leading-snug">{subtitle}</p>

      ) : null}

    </div>

  );

}



export function ExecutiveTargetHint({ missing }: { missing: boolean }) {

  if (!missing) return null;

  return (

    <p className="executive-target-hint text-[11px] text-[#D97706] italic">{EXECUTIVE_REPORT_AUTO_TARGET_SHORT}</p>

  );

}


