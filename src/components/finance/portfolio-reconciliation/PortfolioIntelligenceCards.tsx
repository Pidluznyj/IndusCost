import React from "react";
import {
  AlertTriangle,
  CircleHelp,
  FileOutput,
  Gauge,
  PackageX,
  Receipt,
  Scale,
  ShieldAlert,
  TrendingUp,
  Wallet,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceCardDto } from "@/src/lib/financePortfolioReconciliationClient";
import { cn } from "@/src/lib/utils";
import { MetricHelpTooltip } from "./PortfolioIntelligenceHelpPopover";

/** Ordem visual dos cards (API pode trazer extras; só exibimos estes). */
const CARD_ORDER = [
  "CARTEIRA_TOTAL_ANALISADA",
  "RECEBIDO",
  "CR_ABERTO",
  "FATURADO_SEM_CR",
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
  "DIVERGENCIA_TECNICA",
  "SEM_EVIDENCIA",
  "RISCO_SUPERESTIMACAO",
  "CONVERSAO_PEDIDOS_CR_QTD",
  "CONVERSAO_DOC_SAIDA_QTD",
  "TAXA_RECEBIMENTO_CR",
  "CONFIANCA_MEDIA_CARTEIRA",
] as const;

type SoftTone =
  | "neutral"
  | "green"
  | "blue"
  | "amber"
  | "red"
  | "orange"
  | "gray";

const TONE_BY_KEY: Record<string, SoftTone> = {
  CARTEIRA_TOTAL_ANALISADA: "neutral",
  RECEBIDO: "green",
  CR_ABERTO: "green",
  FATURADO_SEM_CR: "amber",
  CARTEIRA_FUTURA_PROVAVEL: "blue",
  CARTEIRA_PRESENTE_ATENCAO: "amber",
  CARTEIRA_VENCIDA_BLOQUEADA: "red",
  DIVERGENCIA_TECNICA: "orange",
  SEM_EVIDENCIA: "gray",
  RISCO_SUPERESTIMACAO: "red",
  CONVERSAO_PEDIDOS_CR_QTD: "green",
  CONVERSAO_DOC_SAIDA_QTD: "blue",
  TAXA_RECEBIMENTO_CR: "green",
  CONFIANCA_MEDIA_CARTEIRA: "blue",
};

const ICON_BY_KEY: Record<string, LucideIcon> = {
  CARTEIRA_TOTAL_ANALISADA: WalletCards,
  RECEBIDO: Wallet,
  CR_ABERTO: Receipt,
  FATURADO_SEM_CR: FileOutput,
  CARTEIRA_FUTURA_PROVAVEL: TrendingUp,
  CARTEIRA_PRESENTE_ATENCAO: Scale,
  CARTEIRA_VENCIDA_BLOQUEADA: ShieldAlert,
  DIVERGENCIA_TECNICA: AlertTriangle,
  SEM_EVIDENCIA: CircleHelp,
  RISCO_SUPERESTIMACAO: PackageX,
  CONVERSAO_PEDIDOS_CR_QTD: Receipt,
  CONVERSAO_DOC_SAIDA_QTD: FileOutput,
  TAXA_RECEBIMENTO_CR: Wallet,
  CONFIANCA_MEDIA_CARTEIRA: Gauge,
};

const TONE_CLASS: Record<SoftTone, string> = {
  neutral: "border-slate-200/90 bg-slate-50/80",
  green: "border-emerald-200/90 bg-emerald-50/70",
  blue: "border-sky-200/90 bg-sky-50/70",
  amber: "border-amber-200/90 bg-amber-50/70",
  red: "border-rose-200/90 bg-rose-50/70",
  orange: "border-orange-200/90 bg-orange-50/70",
  gray: "border-zinc-200/90 bg-zinc-50/80",
};

const PERCENT_KEYS = new Set([
  "CONVERSAO_PEDIDOS_CR_QTD",
  "CONVERSAO_PEDIDOS_CR_VALOR",
  "CONVERSAO_DOC_SAIDA_QTD",
  "CONVERSAO_DOC_SAIDA_VALOR",
  "TAXA_RECEBIMENTO_CR",
  "CONFIANCA_MEDIA_CARTEIRA",
]);

function hasCompleteExplanation(card: PortfolioIntelligenceCardDto): boolean {
  const e = card.explanation;
  if (!e) return false;
  return Boolean(
    e.whatItMeans?.trim() &&
      e.howWeCalculate?.trim() &&
      e.whatIsIncluded?.trim() &&
      e.whatIsExcluded?.trim() &&
      e.howToInterpret?.trim()
  );
}

function formatPrimaryValue(card: PortfolioIntelligenceCardDto): string {
  if (PERCENT_KEYS.has(card.key)) {
    return formatFinancePercent(card.percentage ?? card.value);
  }
  return formatFinanceCurrencyCompact(card.value);
}

type Props = {
  cards: PortfolioIntelligenceCardDto[];
  loading?: boolean;
  /** Clique no card (exceto no ?) — filtra/abre sanfona correspondente. */
  onCardClick?: (cardKey: string) => void;
  /** Card cuja sanfona está aberta (destaque suave). */
  activeCardKey?: string | null;
};

/**
 * Grade horizontal de cards da Inteligência da Carteira.
 * Só formata — números e explanations vêm da API.
 */
export function PortfolioIntelligenceCards({
  cards,
  loading = false,
  onCardClick,
  activeCardKey = null,
}: Props) {
  const byKey = new Map(cards.map((c) => [c.key, c]));
  const ordered = CARD_ORDER.map((key) => byKey.get(key)).filter(
    (c): c is PortfolioIntelligenceCardDto => c != null
  );

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
        data-testid="portfolio-intelligence-cards-loading"
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="h-[5.5rem] animate-pulse rounded-xl border border-border/60 bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div
        className="rounded-xl border border-dashed border-border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground"
        data-testid="portfolio-intelligence-cards-empty"
      >
        Nenhum indicador disponível para o filtro atual.
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7"
      data-testid="portfolio-intelligence-cards"
    >
      {ordered.map((card) => {
        const tone = TONE_BY_KEY[card.key] ?? "neutral";
        const Icon = ICON_BY_KEY[card.key] ?? Wallet;
        const complete = hasCompleteExplanation(card);
        const clickable = Boolean(onCardClick);
        const isActive = activeCardKey === card.key;
        return (
          <article
            key={card.key}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={
              clickable
                ? () => {
                    onCardClick?.(card.key);
                  }
                : undefined
            }
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCardClick?.(card.key);
                    }
                  }
                : undefined
            }
            className={cn(
              "relative flex min-h-[5.5rem] flex-col rounded-xl border px-2.5 py-2 shadow-sm outline-none",
              TONE_CLASS[tone],
              clickable && "cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-300/80",
              isActive && "ring-2 ring-sky-400/50"
            )}
            data-testid={`portfolio-intelligence-card-${card.key}`}
          >
            <MetricHelpTooltip
              corner
              title={card.title}
              explanation={card.explanation}
              missingExplanation={!complete}
            />
            <div className="mb-1 flex items-start gap-1.5 pr-6">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <h3 className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                {card.title}
              </h3>
            </div>
            <p className="text-base font-semibold tabular-nums leading-tight text-foreground sm:text-lg">
              {formatPrimaryValue(card)}
            </p>
            <p className="mt-auto pt-1 text-[10px] tabular-nums text-muted-foreground">
              {formatFinanceInteger(card.count)} ped.
              {card.percentage != null && !PERCENT_KEYS.has(card.key)
                ? ` · ${formatFinancePercent(card.percentage)}`
                : ""}
              {card.isAlertCard ? " · alerta" : ""}
            </p>
          </article>
        );
      })}
    </div>
  );
}
