import React from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleDashed,
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
import { OrderStatusHintTooltip } from "./orderStatusUi";

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

/** Fundo/borda/texto suaves por card (padrão executivo Inteligência). */
const CARD_TONE: Record<
  PortfolioOrderStatusPrimaryCardId,
  { shell: string; value: string; iconWrap: string; icon: string }
> = {
  total: {
    shell: "border-[#D0D5DD] bg-[#F9FAFB]",
    value: "text-[#101828]",
    iconWrap: "bg-white/90",
    icon: "text-[#475467]",
  },
  completos: {
    shell: "border-[#ABEFC6] bg-[#ECFDF3]",
    value: "text-[#067647]",
    iconWrap: "bg-white/90",
    icon: "text-[#067647]",
  },
  parciais: {
    shell: "border-[#FEDF89] bg-[#FFFAEB]",
    value: "text-[#B54708]",
    iconWrap: "bg-white/90",
    icon: "text-[#B54708]",
  },
  sem_atendimento: {
    shell: "border-[#D0D5DD] bg-[#F2F4F7]",
    value: "text-[#344054]",
    iconWrap: "bg-white/90",
    icon: "text-[#667085]",
  },
  com_divergencia: {
    shell: "border-[#FDBA74] bg-[#FFF6ED]",
    value: "text-[#C2410C]",
    iconWrap: "bg-white/90",
    icon: "text-[#C2410C]",
  },
  cr_aberto: {
    shell: "border-[#B2DDFF] bg-[#EFF8FF]",
    value: "text-[#175CD3]",
    iconWrap: "bg-white/90",
    icon: "text-[#175CD3]",
  },
  recebidos: {
    shell: "border-[#ABEFC6] bg-[#ECFDF3]",
    value: "text-[#067647]",
    iconWrap: "bg-white/90",
    icon: "text-[#067647]",
  },
  bloqueados: {
    shell: "border-[#FECDCA] bg-[#FEF3F2]",
    value: "text-[#B42318]",
    iconWrap: "bg-white/90",
    icon: "text-[#B42318]",
  },
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
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]"
        data-testid="order-status-primary-cards-loading"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-[128px] animate-pulse rounded-[14px] border border-[#EAECF0] bg-[#F9FAFB]"
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8"
      data-testid="order-status-primary-cards"
    >
      {cards.map((card) => {
        const selected = selectedCard === card.id;
        const tone = CARD_TONE[card.id];
        const Icon = CARD_ICON[card.id];
        const pressedLabel = selected
          ? `${card.label}: filtro ativo, clique para limpar`
          : `Filtrar por ${card.label}`;
        return (
          <button
            key={card.id}
            type="button"
            aria-pressed={selected}
            aria-label={pressedLabel}
            onClick={() => onSelect(selected ? "" : card.id)}
            className={cn(
              "relative flex min-h-[124px] flex-col rounded-[14px] border px-3.5 py-3.5 text-left shadow-sm outline-none transition-all",
              tone.shell,
              selected
                ? "ring-2 ring-sky-400/50 shadow-md"
                : "hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-300/70"
            )}
            data-testid={`order-status-card-${card.id}`}
          >
            <div
              className={cn(
                "absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg",
                tone.iconWrap
              )}
              aria-hidden
            >
              <Icon className={cn("h-3.5 w-3.5", tone.icon)} />
            </div>

            <div className="flex items-start gap-1.5 pr-9">
              <p className="min-w-0 flex-1 text-[11px] font-semibold uppercase leading-snug tracking-wide text-[#475467]">
                {card.label}
              </p>
              <OrderStatusHintTooltip title={card.label} hint={card.hint} />
            </div>

            <p
              className={cn(
                "mt-2.5 text-[24px] font-bold tabular-nums leading-none tracking-tight sm:text-[28px]",
                tone.value
              )}
              data-testid={`order-status-card-${card.id}-count`}
            >
              {formatFinanceInteger(card.count)}
            </p>

            <p
              className="mt-2 text-[13px] font-semibold tabular-nums text-[#344054]"
              data-testid={`order-status-card-${card.id}-value`}
            >
              {formatFinanceCurrencyCompact(card.totalOrderValue)}
            </p>

            <p
              className="mt-0.5 text-[11px] tabular-nums text-[#667085]"
              data-testid={`order-status-card-${card.id}-percent`}
            >
              {formatFinancePercent(card.percentOfTotal)} do total
            </p>

            {selected ? (
              <span className="mt-2 inline-flex w-fit rounded-full border border-sky-200 bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
                Filtro ativo
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
