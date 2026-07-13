import React from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
  HelpCircle,
  Layers,
  PackageX,
  Wallet,
} from "lucide-react";
import {
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type {
  PortfolioOrderStatusPrimaryCard,
  PortfolioOrderStatusPrimaryCardId,
} from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

type Props = {
  cards: PortfolioOrderStatusPrimaryCard[];
  selectedCard: string;
  onSelect: (cardId: string) => void;
  loading?: boolean;
};

const CARD_ICON: Record<
  PortfolioOrderStatusPrimaryCardId,
  React.ComponentType<{ className?: string }>
> = {
  total: Layers,
  completos: CheckCircle2,
  parciais: CircleDashed,
  sem_atendimento: PackageX,
  com_divergencia: AlertTriangle,
  cr_aberto: Wallet,
  recebidos: CheckCircle2,
  bloqueados: Ban,
};

/** Fundo/borda/texto suaves por card (padrão executivo). */
const CARD_TONE: Record<
  PortfolioOrderStatusPrimaryCardId,
  { shell: string; value: string; icon: string }
> = {
  total: {
    shell: "border-slate-200 bg-slate-50/80",
    value: "text-slate-800",
    icon: "text-sky-600/80",
  },
  completos: {
    shell: "border-emerald-200 bg-emerald-50/70",
    value: "text-emerald-800",
    icon: "text-emerald-600/80",
  },
  parciais: {
    shell: "border-amber-200 bg-amber-50/70",
    value: "text-amber-900",
    icon: "text-amber-600/80",
  },
  sem_atendimento: {
    shell: "border-slate-200 bg-slate-50",
    value: "text-slate-700",
    icon: "text-slate-500",
  },
  com_divergencia: {
    shell: "border-orange-200 bg-orange-50/70",
    value: "text-orange-900",
    icon: "text-orange-600/80",
  },
  cr_aberto: {
    shell: "border-sky-200 bg-sky-50/70",
    value: "text-sky-800",
    icon: "text-sky-600/80",
  },
  recebidos: {
    shell: "border-emerald-200 bg-emerald-50/80",
    value: "text-emerald-800",
    icon: "text-emerald-600/80",
  },
  bloqueados: {
    shell: "border-rose-200 bg-rose-50/70",
    value: "text-rose-800",
    icon: "text-rose-600/80",
  },
};

function CardTooltip({ hint }: { hint: string }) {
  return (
    <button
      type="button"
      title={hint}
      aria-label={hint}
      className="inline-flex shrink-0 cursor-help border-0 bg-transparent p-0 text-[#9CA3AF] hover:text-[#667085] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/35 rounded-sm"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <HelpCircle className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

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
            className="h-[118px] animate-pulse rounded-[14px] border border-[#E5E7EB] bg-[#F3F4F6]"
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
        const tone = CARD_TONE[card.id];
        const Icon = CARD_ICON[card.id];
        return (
          <button
            key={card.id}
            type="button"
            aria-pressed={selected}
            title={card.hint}
            onClick={() => onSelect(selected ? "" : card.id)}
            className={cn(
              "rounded-[14px] border px-3 py-3 text-left shadow-sm transition-all",
              tone.shell,
              selected
                ? "ring-2 ring-[#2563EB]/45 shadow-md"
                : "hover:brightness-[0.99]"
            )}
            data-testid={`order-status-card-${card.id}`}
          >
            <div className="flex items-start justify-between gap-1">
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon className={cn("h-3.5 w-3.5 shrink-0", tone.icon)} />
                <p className="truncate text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
                  {card.label}
                </p>
              </div>
              <CardTooltip hint={card.hint} />
            </div>

            <p
              className={cn(
                "mt-2 text-2xl font-extrabold tabular-nums leading-none",
                tone.value
              )}
              data-testid={`order-status-card-${card.id}-count`}
            >
              {formatFinanceInteger(card.count)}
            </p>

            <p
              className="mt-1.5 text-xs font-semibold tabular-nums text-[#344054]"
              data-testid={`order-status-card-${card.id}-value`}
            >
              {formatFinanceCurrencyCompact(card.totalOrderValue)}
            </p>

            <p
              className="mt-0.5 text-[11px] tabular-nums text-[#6B7280]"
              data-testid={`order-status-card-${card.id}-percent`}
            >
              {formatFinancePercent(card.percentOfTotal)} do total
            </p>
          </button>
        );
      })}
    </div>
  );
}
