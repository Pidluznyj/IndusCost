import React from "react";
import { CalendarClock, CalendarDays, Package, TrendingUp } from "lucide-react";
import type { FinanceCashFlowRawMaterialSpotlight } from "@/src/lib/financeCashFlowRawMaterialSpotlight";
import { FinanceCashFlowExecutiveMetricCard } from "@/src/components/finance/cash-flow/FinanceCashFlowExecutiveMetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

type Props = {
  spotlight: FinanceCashFlowRawMaterialSpotlight;
};

export function FinanceCashFlowRawMaterialSpotlightPanel({ spotlight }: Props) {
  const [next1, next2] = spotlight.nextMonths;

  return (
    <section
      data-testid="cash-flow-raw-material-spotlight"
      className={cn(financeBiSectionClass, "overflow-hidden")}
    >
      <div className="px-4 py-3 border-b border-[#E5E7EB] space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[#111827]">
            Centro de custo — {spotlight.label}
          </h2>
          <span className="rounded-full bg-[#ECFDF5] border border-[#A7F3D0] px-2 py-0.5 text-[10px] font-medium text-[#047857]">
            YTD {spotlight.ytdYear}
          </span>
        </div>
        <p className="text-[11px] text-[#6B7280]">{spotlight.sourceNote}</p>
      </div>

      <div className="p-4">
        <SummaryKpiGrid
          minColumnWidth={168}
          testId="cash-flow-raw-material-spotlight-grid"
          className="finance-cash-flow-metric-grid"
        >
          <FinanceCashFlowExecutiveMetricCard
            testId="raw-material-kpi-ytd"
            label={`${spotlight.label} YTD`}
            subtitle={
              spotlight.ytdThroughMonth > 0
                ? `Jan–${spotlight.ytdThroughMonthLabel}/${spotlight.ytdYear}`
                : `Ano ${spotlight.ytdYear}`
            }
            amount={spotlight.ytdAmount}
            icon={Package}
            tone="warning"
            featured
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="raw-material-kpi-current"
            label={spotlight.currentMonth.monthLabel}
            subtitle={`Mês corrente · ${spotlight.currentMonth.year}`}
            amount={spotlight.currentMonth.amount}
            icon={CalendarDays}
            tone="neutral"
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="raw-material-kpi-next-1"
            label={next1.monthLabel}
            subtitle={`Previsto · ${next1.year}`}
            amount={next1.amount}
            icon={CalendarClock}
            tone="neutral"
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="raw-material-kpi-next-2"
            label={next2.monthLabel}
            subtitle={`Previsto · ${next2.year}`}
            amount={next2.amount}
            icon={TrendingUp}
            tone="neutral"
          />
        </SummaryKpiGrid>
      </div>
    </section>
  );
}
