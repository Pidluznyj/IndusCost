import React from "react";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioOrderStatusDrilldownCard } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";
import { OrderStatusHintTooltip } from "./orderStatusUi";

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
    <div className="space-y-2.5" data-testid="order-status-drilldown-cards">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
          {title}
        </p>
        {contextLabel ? (
          <p
            className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-900"
            data-testid="order-status-filter-context"
          >
            Contexto: {contextLabel}
          </p>
        ) : (
          <p className="text-[11px] text-[#98A2B3]">
            Clique para aprofundar a tabela
          </p>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto pb-1">
        <div className="flex min-w-min gap-2 px-1">
          {cards.map((card) => {
            const selected = selectedDrilldown === card.id;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={selected}
                aria-label={
                  selected
                    ? `${card.label}: detalhe ativo, clique para limpar`
                    : `Detalhar ${card.label}`
                }
                onClick={() => onSelect(selected ? "" : card.id)}
                className={cn(
                  "inline-flex min-w-[152px] shrink-0 flex-col gap-1.5 rounded-[12px] border px-3 py-2.5 text-left shadow-sm outline-none transition-all",
                  selected
                    ? "border-sky-300 bg-sky-50 ring-2 ring-sky-400/40"
                    : "border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] focus-visible:ring-2 focus-visible:ring-sky-300/70"
                )}
                data-testid={`order-status-drilldown-${card.id}`}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className="text-[10px] font-semibold uppercase leading-snug tracking-wide text-[#667085]">
                    {card.label}
                  </span>
                  <OrderStatusHintTooltip title={card.label} hint={card.hint} />
                </div>
                <span className="text-[20px] font-bold tabular-nums leading-none text-[#101828]">
                  {formatFinanceInteger(card.count)}
                </span>
                {selected ? (
                  <span className="text-[10px] font-semibold text-sky-800">
                    Ativo na tabela
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
