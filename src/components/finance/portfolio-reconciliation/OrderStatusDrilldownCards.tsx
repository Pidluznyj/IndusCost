import React from "react";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioOrderStatusDrilldownCard } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

type Props = {
  cards: PortfolioOrderStatusDrilldownCard[];
  selectedDrilldown: string;
  onSelect: (drilldownId: string) => void;
};

export function OrderStatusDrilldownCards({
  cards,
  selectedDrilldown,
  onSelect,
}: Props) {
  if (!cards.length) return null;

  return (
    <div className="mb-4 space-y-2" data-testid="order-status-drilldown-cards">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
        Detalhamento
      </p>
      <div className="flex flex-wrap gap-2">
        {cards.map((card) => {
          const selected = selectedDrilldown === card.id;
          return (
            <button
              key={card.id}
              type="button"
              title={card.hint}
              onClick={() => onSelect(selected ? "" : card.id)}
              className={cn(
                "inline-flex items-center gap-2 rounded-[12px] border border-[#E5E7EB] bg-white px-3 py-2 text-left shadow-sm",
                selected ? "ring-2 ring-[#2563EB]/35" : "hover:bg-[#F9FAFB]"
              )}
              data-testid={`order-status-drilldown-${card.id}`}
            >
              <span className="text-xs font-semibold text-[#344054]">{card.label}</span>
              <span className="text-sm font-bold tabular-nums text-[#111827]">
                {formatFinanceInteger(card.count)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
