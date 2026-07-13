import React from "react";
import { HelpCircle } from "lucide-react";
import { formatFinanceInteger } from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioOrderStatusPrimaryCard } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

type Props = {
  cards: PortfolioOrderStatusPrimaryCard[];
  selectedCard: string;
  onSelect: (cardId: string) => void;
  loading?: boolean;
};

const TONE_CLASS: Record<PortfolioOrderStatusPrimaryCard["tone"], string> = {
  neutral: "text-[#111827]",
  green: "text-emerald-700",
  blue: "text-sky-700",
  amber: "text-amber-700",
  gray: "text-slate-600",
  orange: "text-orange-700",
  red: "text-rose-700",
};

const TONE_BORDER: Record<PortfolioOrderStatusPrimaryCard["tone"], string> = {
  neutral: "border-[#E5E7EB]",
  green: "border-emerald-200",
  blue: "border-sky-200",
  amber: "border-amber-200",
  gray: "border-slate-200",
  orange: "border-orange-200",
  red: "border-rose-200",
};

export function OrderStatusPrimaryCards({
  cards,
  selectedCard,
  onSelect,
  loading,
}: Props) {
  if (loading) {
    return (
      <div
        className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8"
        data-testid="order-status-primary-cards-loading"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[84px] animate-pulse rounded-[14px] border border-[#E5E7EB] bg-[#F3F4F6]"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8"
      data-testid="order-status-primary-cards"
    >
      {cards.map((card) => {
        const selected = selectedCard === card.id;
        return (
          <button
            key={card.id}
            type="button"
            title={card.hint}
            onClick={() => onSelect(selected ? "" : card.id)}
            className={cn(
              "rounded-[14px] border bg-white px-3 py-3 text-left shadow-sm transition-colors",
              TONE_BORDER[card.tone],
              selected ? "ring-2 ring-[#2563EB]/40" : "hover:bg-[#F9FAFB]"
            )}
            data-testid={`order-status-card-${card.id}`}
          >
            <div className="flex items-start justify-between gap-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
                {card.label}
              </p>
              <span className="text-[#9CA3AF]" title={card.hint}>
                <HelpCircle className="h-3.5 w-3.5" />
              </span>
            </div>
            <p
              className={cn(
                "mt-2 text-2xl font-extrabold tabular-nums leading-none",
                TONE_CLASS[card.tone]
              )}
            >
              {formatFinanceInteger(card.count)}
            </p>
          </button>
        );
      })}
    </div>
  );
}
