import { createContext, useContext } from "react";
import { EXECUTIVE_CHART_HEIGHT } from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export type ExecutiveChartFrameDimensions = {
  width: number;
  height: number;
};

export const ExecutiveChartFrameContext = createContext<ExecutiveChartFrameDimensions>({
  width: 960,
  height: EXECUTIVE_CHART_HEIGHT,
});

export function useExecutiveChartFrameDimensions(): ExecutiveChartFrameDimensions {
  return useContext(ExecutiveChartFrameContext);
}

export function useExecutiveChartFrameHeight(): number {
  return useExecutiveChartFrameDimensions().height;
}

export function useExecutiveChartFrameWidth(): number {
  return useExecutiveChartFrameDimensions().width;
}
