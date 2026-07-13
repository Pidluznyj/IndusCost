import React from "react";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioOrderStatusDrilldownCard } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

type Props = {
  cards: PortfolioOrderStatusDrilldownCard[];
  selectedCard: string;
  selectedDrilldown: string;
  contextLabel: string | null;
  onSelect: (drilldownId: string) => void;
};

/**
 * Segunda linha de indicadores — drilldowns da API.
 * Cards menores, scroll horizontal, zero permitido.
 */
export function OrderStatusDrilldownCards({
  cards,
  selectedCard,
  selectedDrilldown,
  contextLabel,
  onSelect,
}: Props) {
  if (!cards.length) return null;

  const title = selectedCard
    ? "Detalhamento do card"
    : "Indicadores gerais";

  return (
    <div className="mb-4 space-y-2" data-testid="order-status-drilldown-cards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
          {title}
        </p>
        {contextLabel ? (
          <p
            className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-900"
            data-testid="order-status-filter-context"
          >
            Filtro ativo: {contextLabel}
          </p>
        ) : null}
      </div>

      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="flex min-w-min gap-2 px-1">
          {cards.map((card) => {
            const selected = selectedDrilldown === card.id;
            return (
              <button
                key={card.id}
                type="button"
                title={card.hint}
                aria-pressed={selected}
                onClick={() => onSelect(selected ? "" : card.id)}
                className={cn(
                  "inline-flex min-w-[148px] shrink-0 flex-col gap-1 rounded-[12px] border bg-white px-3 py-2 text-left shadow-sm transition-all",
                  selected
                    ? "border-sky-300 ring-2 ring-[#2563EB]/35"
                    : "border-[#E5E7EB] hover:bg-[#F9FAFB]"
                )}
                data-testid={`order-status-drilldown-${card.id}`}
              >
                <span className="text-[11px] font-semibold leading-snug text-[#344054]">
                  {card.label}
                </span>
                <span className="text-lg font-bold tabular-nums leading-none text-[#111827]">
                  {formatFinanceInteger(card.count)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
