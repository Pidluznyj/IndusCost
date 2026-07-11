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
  "CARTEIRA_FUTURA_PROVAVEL",
  "CARTEIRA_PRESENTE_ATENCAO",
  "CARTEIRA_VENCIDA_BLOQUEADA",
  "SEM_EVIDENCIA",
] as const;

const ALERT_CARD_KEYS = [
  "DIVERGENCIA_TECNICA",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "QUANTIDADE_EXCEDENTE_DOCUMENTO",
  "PRODUTO_FORA_DO_PEDIDO",
  "RISCO_SUPERESTIMACAO",
] as const;

const SECONDARY_CARD_KEYS = [
  "CONVERSAO_PEDIDOS_CR_QTD",
  "CONVERSAO_DOC_SAIDA_QTD",
  "TAXA_RECEBIMENTO_CR",
  "CONFIANCA_MEDIA_CARTEIRA",
] as const;

const CARD_ORDER = [
  "CARTEIRA_TOTAL_ANALISADA",
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
  CR_ABERTO: "blue",
  FATURADO_SEM_CR: "blue",
  CARTEIRA_FUTURA_PROVAVEL: "blue",
  CARTEIRA_PRESENTE_ATENCAO: "amber",
  CARTEIRA_VENCIDA_BLOQUEADA: "red",
  SEM_EVIDENCIA: "gray",
  DIVERGENCIA_TECNICA: "orange",
  NF_CABECALHO_MAIOR_PEDIDO: "orange",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "orange",
  PRODUTO_FORA_DO_PEDIDO: "orange",
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
  SEM_EVIDENCIA: CircleHelp,
  DIVERGENCIA_TECNICA: AlertTriangle,
  NF_CABECALHO_MAIOR_PEDIDO: AlertTriangle,
  QUANTIDADE_EXCEDENTE_DOCUMENTO: AlertTriangle,
  PRODUTO_FORA_DO_PEDIDO: PackageX,
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
  orange: "border-orange-200/70 bg-gradient-to-br from-orange-50/50 to-white",
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
  alertStyle,
  onCardClick,
  activeCardKey,
}: {
  card: PortfolioIntelligenceCardDto;
  hero: boolean;
  alertStyle: boolean;
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
  const isAlert = alertStyle || Boolean(card.isAlertCard);

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
        hero && !isAlert ? "min-h-[7.25rem]" : "min-h-[5.75rem]",
        TONE_CLASS[tone],
        isAlert &&
          "border-dashed border-orange-300/80 bg-gradient-to-br from-orange-50/40 via-zinc-50/50 to-white shadow-none",
        clickable &&
          "cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-300/70",
        isActive && "ring-2 ring-sky-400/45"
      )}
      data-testid={`portfolio-intelligence-card-${card.key}`}
      data-alert-card={isAlert ? "true" : undefined}
    >
      <MetricHelpTooltip
        corner
        title={title}
        explanation={card.explanation}
        missingExplanation={!complete}
      />
      <div className={cn("mb-1.5 flex items-start gap-2 pr-7", hero && !isAlert && "mb-2")}>
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
              "flex flex-wrap items-center gap-1.5 font-semibold leading-snug text-foreground",
              hero && !isAlert ? "text-xs sm:text-[13px]" : "text-[11px] sm:text-xs"
            )}
          >
            <span>{title}</span>
            {isAlert ? (
              <span className="rounded border border-orange-300/80 bg-orange-100/80 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-orange-950">
                alerta
              </span>
            ) : null}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <p
        className={cn(
          "font-semibold tabular-nums leading-tight tracking-tight",
          isAlert ? "text-base text-orange-950/80 sm:text-lg" : "text-foreground",
          !isAlert && (hero ? "text-xl sm:text-2xl" : "text-base sm:text-lg")
        )}
      >
        {formatPrimaryValue(card)}
      </p>
      <p
        className={cn(
          "mt-auto pt-2 text-[10px] tabular-nums",
          isAlert ? "text-orange-900/70" : "text-muted-foreground"
        )}
      >
        {formatFinanceInteger(card.count)} pedido(s)
        {card.percentage != null && !PERCENT_KEYS.has(card.key)
          ? ` · ${formatFinancePercent(card.percentage)} da carteira`
          : ""}
        {isAlert ? " · não soma carteira" : ""}
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

  const totalCard = byKey.get("CARTEIRA_TOTAL_ANALISADA") ?? null;
  const financialCards = pick(FINANCIAL_CARD_KEYS);
  const operationalCards = pick(OPERATIONAL_CARD_KEYS);
  const alertCards = pick(ALERT_CARD_KEYS);
  const secondaryCards = pick(SECONDARY_CARD_KEYS);
  const ordered = [
    ...(totalCard ? [totalCard] : []),
    ...financialCards,
    ...operationalCards,
    ...alertCards,
    ...secondaryCards,
  ];

  // Referência para testes de ordem visual (mantém CARD_ORDER no bundle).
  void CARD_ORDER;

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
    description: string,
    blockCards: PortfolioIntelligenceCardDto[],
    opts?: { alert?: boolean; testId?: string }
  ) => {
    if (blockCards.length === 0) return null;
    return (
      <div data-testid={opts?.testId}>
        <div className="mb-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {opts?.alert ? (
          <p
            className="mb-2 rounded-lg border border-dashed border-orange-300/80 bg-orange-50/40 px-2.5 py-1.5 text-[11px] leading-relaxed text-orange-950"
            data-testid="portfolio-intelligence-alerts-notice"
          >
            Alerta — pode coexistir com outro status. Não soma carteira.
          </p>
        ) : null}
        <div
          className={cn(
            "grid grid-cols-2 gap-3 sm:grid-cols-3",
            opts?.alert ? "lg:grid-cols-3 xl:grid-cols-5" : "lg:grid-cols-4"
          )}
        >
          {blockCards.map((card) => (
            <CardArticle
              key={card.key}
              card={card}
              hero={!opts?.alert}
              alertStyle={Boolean(opts?.alert)}
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
      {totalCard ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2.5"
          data-testid="portfolio-intelligence-card-CARTEIRA_TOTAL_ANALISADA"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">
              {intelligenceCardTitle(totalCard.key, totalCard.title)}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {INTELLIGENCE_CARD_SUBTITLE[totalCard.key] ?? "Base 100% do filtro"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-lg font-semibold tabular-nums text-foreground sm:text-xl">
              {formatPrimaryValue(totalCard)}
            </p>
            <MetricHelpTooltip
              title={intelligenceCardTitle(totalCard.key, totalCard.title)}
              explanation={totalCard.explanation}
              missingExplanation={!hasCompleteExplanation(totalCard)}
            />
          </div>
        </div>
      ) : null}

      {renderGrid(
        "1. Financeiro confirmado",
        "O que já virou CR ou baixa — dinheiro confirmado na conciliação.",
        financialCards,
        { testId: "portfolio-intelligence-cards-financial" }
      )}
      {renderGrid(
        "2. Carteira operacional",
        "Ainda é pedido de venda — futuro, atenção, vencido ou sem evidência.",
        operationalCards,
        { testId: "portfolio-intelligence-cards-operational" }
      )}
      {renderGrid(
        "3. Alertas técnicos",
        "Risco ou divergência em pedidos já classificados — não é carteira extra.",
        alertCards,
        { alert: true, testId: "portfolio-intelligence-cards-alerts" }
      )}
      {renderGrid(
        "Conversão e confiança",
        "Indicadores de conversão operacional — não somam com os blocos acima.",
        secondaryCards,
        { testId: "portfolio-intelligence-cards-secondary" }
      )}
    </div>
  );
}
