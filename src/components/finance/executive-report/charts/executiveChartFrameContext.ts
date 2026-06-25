import { createContext, useContext } from "react";
import { EXECUTIVE_CHART_HEIGHT } from "@/src/components/finance/executive-report/charts/executiveReportChartTheme";

export const ExecutiveChartFrameContext = createContext(EXECUTIVE_CHART_HEIGHT);

export function useExecutiveChartFrameHeight(): number {
  return useContext(ExecutiveChartFrameContext);
}
