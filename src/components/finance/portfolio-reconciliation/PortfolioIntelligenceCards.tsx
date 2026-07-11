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
import {
  INTELLIGENCE_CARD_SUBTITLE,
  intelligenceCardTitle,
} from "@/src/lib/finance/portfolioIntelligenceUiCopy";
import { cn } from "@/src/lib/utils";
import { MetricHelpTooltip } from "./PortfolioIntelligenceHelpPopover";

/** Ordem visual dos cards (API pode trazer extras; só exibimos estes). */
const FINANCIAL_CARD_KEYS = [
  "RECEBIDO",
  "CR_ABERTO",
  "FATURADO_SEM_CR",
] as const;

const OPERATIONAL_CARD_KEYS = [
  "CARTEIRA_TOTAL_ANALISADA",
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
] as const;

const ALERT_CARD_KEYS = [
  "DIVERGENCIA_TECNICA",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "SEM_EVIDENCIA",
  "RISCO_SUPERESTIMACAO",
] as const;

const SECONDARY_CARD_KEYS = [
  "CONVERSAO_PEDIDOS_CR_QTD",
  "CONVERSAO_DOC_SAIDA_QTD",
  "TAXA_RECEBIMENTO_CR",
  "CONFIANCA_MEDIA_CARTEIRA",
] as const;

const CARD_ORDER = [
  ...FINANCIAL_CARD_KEYS,
  ...OPERATIONAL_CARD_KEYS,
  ...ALERT_CARD_KEYS,
  ...SECONDARY_CARD_KEYS,
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
  NF_CABECALHO_MAIOR_PEDIDO: "orange",
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
  NF_CABECALHO_MAIOR_PEDIDO: AlertTriangle,
  SEM_EVIDENCIA: CircleHelp,
  RISCO_SUPERESTIMACAO: PackageX,
  CONVERSAO_PEDIDOS_CR_QTD: Receipt,
  CONVERSAO_DOC_SAIDA_QTD: FileOutput,
  TAXA_RECEBIMENTO_CR: Wallet,
  CONFIANCA_MEDIA_CARTEIRA: Gauge,
};

const TONE_CLASS: Record<SoftTone, string> = {
  neutral: "border-slate-200/80 bg-gradient-to-br from-slate-50/90 to-white",
  green: "border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 to-white",
  blue: "border-sky-200/80 bg-gradient-to-br from-sky-50/80 to-white",
  amber: "border-amber-200/70 bg-gradient-to-br from-amber-50/70 to-white",
  red: "border-rose-200/70 bg-gradient-to-br from-rose-50/60 to-white",
  orange: "border-orange-200/70 bg-gradient-to-br from-orange-50/60 to-white",
  gray: "border-zinc-200/80 bg-gradient-to-br from-zinc-50/80 to-white",
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
  onCardClick?: (cardKey: string) => void;
  activeCardKey?: string | null;
};

function CardArticle({
  card,
  hero,
  onCardClick,
  activeCardKey,
}: {
  card: PortfolioIntelligenceCardDto;
  hero: boolean;
  onCardClick?: (cardKey: string) => void;
  activeCardKey?: string | null;
}) {
  const tone = TONE_BY_KEY[card.key] ?? "neutral";
  const Icon = ICON_BY_KEY[card.key] ?? Wallet;
  const complete = hasCompleteExplanation(card);
  const clickable = Boolean(onCardClick);
  const isActive = activeCardKey === card.key;
  const title = intelligenceCardTitle(card.key, card.title);
  const subtitle = INTELLIGENCE_CARD_SUBTITLE[card.key];

  return (
    <article
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
        "relative flex flex-col rounded-2xl border px-3 py-3 shadow-sm outline-none",
        hero ? "min-h-[7.25rem]" : "min-h-[5.75rem]",
        TONE_CLASS[tone],
        clickable &&
          "cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-300/70",
        isActive && "ring-2 ring-sky-400/45"
      )}
      data-testid={`portfolio-intelligence-card-${card.key}`}
    >
      <MetricHelpTooltip
        corner
        title={title}
        explanation={card.explanation}
        missingExplanation={!complete}
      />
      <div className={cn("mb-1.5 flex items-start gap-2 pr-7", hero && "mb-2")}>
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/70 bg-white/70",
            tone === "red" && "text-rose-700",
            tone === "green" && "text-emerald-700",
            tone === "blue" && "text-sky-700",
            tone === "amber" && "text-amber-700",
            tone === "orange" && "text-orange-700",
            (tone === "neutral" || tone === "gray") && "text-slate-600"
          )}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h3
            className={cn(
              "font-semibold leading-snug text-foreground",
              hero ? "text-xs sm:text-[13px]" : "text-[11px] sm:text-xs"
            )}
          >
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <p
        className={cn(
          "font-semibold tabular-nums leading-tight tracking-tight text-foreground",
          hero ? "text-xl sm:text-2xl" : "text-base sm:text-lg"
        )}
      >
        {formatPrimaryValue(card)}
      </p>
      <p className="mt-auto pt-2 text-[10px] tabular-nums text-muted-foreground">
        {formatFinanceInteger(card.count)} pedido(s)
        {card.percentage != null && !PERCENT_KEYS.has(card.key)
          ? ` · ${formatFinancePercent(card.percentage)} da carteira`
          : ""}
        {card.isAlertCard ? " · alerta" : ""}
      </p>
    </article>
  );
}

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
  const pick = (keys: readonly string[]) =>
    keys.map((key) => byKey.get(key)).filter((c): c is PortfolioIntelligenceCardDto => c != null);

  const financialCards = pick(FINANCIAL_CARD_KEYS);
  const operationalCards = pick(OPERATIONAL_CARD_KEYS);
  const alertCards = pick(ALERT_CARD_KEYS);
  const secondaryCards = pick(SECONDARY_CARD_KEYS);
  const ordered = [...financialCards, ...operationalCards, ...alertCards, ...secondaryCards];

  if (loading) {
    return (
      <div className="space-y-3" data-testid="portfolio-intelligence-cards-loading">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-[7.25rem] animate-pulse rounded-2xl border border-border/50 bg-muted/30"
            />
          ))}
        </div>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed border-border/80 bg-muted/15 px-4 py-10 text-center"
        data-testid="portfolio-intelligence-cards-empty"
      >
        <p className="text-sm font-medium text-foreground">Nenhum indicador neste filtro</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ajuste cliente, período ou status — ou limpe os filtros para ver a carteira completa.
        </p>
      </div>
    );
  }

  const renderGrid = (
    title: string,
    blockCards: PortfolioIntelligenceCardDto[],
    opts?: { alert?: boolean; testId?: string }
  ) => {
    if (blockCards.length === 0) return null;
    return (
      <div data-testid={opts?.testId}>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </p>
        {opts?.alert ? (
          <p
            className="mb-2 rounded-lg border border-orange-200/70 bg-orange-50/50 px-2.5 py-1.5 text-[11px] text-orange-950"
            data-testid="portfolio-intelligence-alerts-notice"
          >
            Alertas técnicos podem coexistir com um status financeiro. Eles não somam carteira.
          </p>
        ) : null}
        <div
          className={cn(
            "grid grid-cols-2 gap-3 sm:grid-cols-3",
            opts?.alert ? "lg:grid-cols-4" : "lg:grid-cols-4 xl:grid-cols-4"
          )}
        >
          {blockCards.map((card) => (
            <CardArticle
              key={card.key}
              card={card}
              hero={!opts?.alert}
              onCardClick={onCardClick}
              activeCardKey={activeCardKey}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5" data-testid="portfolio-intelligence-cards">
      {renderGrid("1. Financeiro confirmado", financialCards, {
        testId: "portfolio-intelligence-cards-financial",
      })}
      {renderGrid("2. Carteira operacional", operationalCards, {
        testId: "portfolio-intelligence-cards-operational",
      })}
      {renderGrid("3. Alertas técnicos", alertCards, {
        alert: true,
        testId: "portfolio-intelligence-cards-alerts",
      })}
      {renderGrid("Conversão e confiança", secondaryCards, {
        testId: "portfolio-intelligence-cards-secondary",
      })}
    </div>
  );
}
