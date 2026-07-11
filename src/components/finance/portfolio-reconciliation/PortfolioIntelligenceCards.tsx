import React from "react";
import {
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioIntelligenceCardDto } from "@/src/lib/financePortfolioReconciliationClient";
import {
  INTELLIGENCE_ALERTS_NOTICE,
  INTELLIGENCE_ALERTS_SHORT,
  INTELLIGENCE_BLOCK_ALERTS_DESC,
  INTELLIGENCE_BLOCK_ALERTS_TITLE,
  INTELLIGENCE_BLOCK_FINANCIAL_DESC,
  INTELLIGENCE_BLOCK_FINANCIAL_TITLE,
  INTELLIGENCE_BLOCK_OPERATIONAL_DESC,
  INTELLIGENCE_BLOCK_OPERATIONAL_TITLE,
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

/** Bloco 3: atendimento + alertas (curadoria visual; valores vêm da API). */
const ATTENTION_CARD_KEYS = [
  "OP_PCT_TOTALMENTE_ATENDIDO",
  "OP_PCT_PARCIALMENTE_ATENDIDO",
  "OP_PCT_NAO_ATENDIDO",
  "QUANTIDADE_EXCEDENTE_DOCUMENTO",
  "PRODUTO_FORA_DO_PEDIDO",
  "NF_CABECALHO_MAIOR_PEDIDO",
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
  ...ATTENTION_CARD_KEYS,
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
  FATURADO_SEM_CR: "amber",
  CARTEIRA_FUTURA_PROVAVEL: "blue",
  CARTEIRA_PRESENTE_ATENCAO: "amber",
  CARTEIRA_VENCIDA_BLOQUEADA: "red",
  SEM_EVIDENCIA: "gray",
  OP_PCT_TOTALMENTE_ATENDIDO: "green",
  OP_PCT_PARCIALMENTE_ATENDIDO: "amber",
  OP_PCT_NAO_ATENDIDO: "red",
  OP_VALOR_TOTALMENTE_ATENDIDO: "green",
  OP_VALOR_PARCIALMENTE_ATENDIDO: "amber",
  OP_VALOR_NAO_ATENDIDO: "red",
  DIVERGENCIA_TECNICA: "orange",
  NF_CABECALHO_MAIOR_PEDIDO: "orange",
  VALOR_CABECALHO_NAO_ATRIBUIDO: "orange",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "orange",
  PEDIDOS_COM_QTD_EXCEDENTE: "orange",
  QTD_EXCEDENTE_TOTAL: "orange",
  VALOR_ESTIMADO_EXCEDENTE: "orange",
  PRODUTO_FORA_DO_PEDIDO: "orange",
  PEDIDOS_COM_PRODUTO_FORA: "orange",
  VALOR_DOCUMENTO_FORA_PEDIDO: "orange",
  RISCO_SUPERESTIMACAO: "red",
  CONVERSAO_PEDIDOS_CR_QTD: "green",
  CONVERSAO_DOC_SAIDA_QTD: "blue",
  TAXA_RECEBIMENTO_CR: "green",
  CONFIANCA_MEDIA_CARTEIRA: "blue",
};

/** Ícones simples: ✓ confirmado · ⏳ previsto · ! alerta. Sem tendência inventada. */
const MARK_BY_KEY: Record<string, string> = {
  RECEBIDO: "✓",
  CR_ABERTO: "✓",
  FATURADO_SEM_CR: "✓",
  CARTEIRA_FUTURA_PROVAVEL: "⏳",
  CARTEIRA_PRESENTE_ATENCAO: "⏳",
  CARTEIRA_VENCIDA_BLOQUEADA: "!",
  SEM_EVIDENCIA: "⏳",
  OP_PCT_TOTALMENTE_ATENDIDO: "✓",
  OP_PCT_PARCIALMENTE_ATENDIDO: "⏳",
  OP_PCT_NAO_ATENDIDO: "!",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "!",
  PRODUTO_FORA_DO_PEDIDO: "!",
  NF_CABECALHO_MAIOR_PEDIDO: "!",
  RISCO_SUPERESTIMACAO: "!",
  DIVERGENCIA_TECNICA: "!",
};

const TONE_CLASS: Record<SoftTone, string> = {
  neutral: "border-[#D0D5DD] bg-[#F9FAFB]",
  green: "border-[#ABEFC6] bg-[#ECFDF3]",
  blue: "border-[#B2DDFF] bg-[#EFF8FF]",
  amber: "border-[#FEDF89] bg-[#FFFAEB]",
  red: "border-[#FECDCA] bg-[#FEF3F2]",
  orange: "border-[#FDBA74] bg-[#FFF6ED]",
  gray: "border-[#D0D5DD] bg-[#F2F4F7]",
};

const MARK_TONE: Record<SoftTone, string> = {
  neutral: "text-[#475467]",
  green: "text-[#067647]",
  blue: "text-[#175CD3]",
  amber: "text-[#B54708]",
  red: "text-[#B42318]",
  orange: "text-[#C2410C]",
  gray: "text-[#667085]",
};

const PERCENT_KEYS = new Set([
  "CONVERSAO_PEDIDOS_CR_QTD",
  "CONVERSAO_PEDIDOS_CR_VALOR",
  "CONVERSAO_DOC_SAIDA_QTD",
  "CONVERSAO_DOC_SAIDA_VALOR",
  "TAXA_RECEBIMENTO_CR",
  "CONFIANCA_MEDIA_CARTEIRA",
  "OP_PCT_TOTALMENTE_ATENDIDO",
  "OP_PCT_PARCIALMENTE_ATENDIDO",
  "OP_PCT_NAO_ATENDIDO",
]);

const QUANTITY_KEYS = new Set(["QTD_EXCEDENTE_TOTAL"]);

const ALERT_KEYS = new Set<string>([
  "DIVERGENCIA_TECNICA",
  "NF_CABECALHO_MAIOR_PEDIDO",
  "VALOR_CABECALHO_NAO_ATRIBUIDO",
  "QUANTIDADE_EXCEDENTE_DOCUMENTO",
  "PEDIDOS_COM_QTD_EXCEDENTE",
  "QTD_EXCEDENTE_TOTAL",
  "VALOR_ESTIMADO_EXCEDENTE",
  "PRODUTO_FORA_DO_PEDIDO",
  "PEDIDOS_COM_PRODUTO_FORA",
  "VALOR_DOCUMENTO_FORA_PEDIDO",
  "RISCO_SUPERESTIMACAO",
  "OP_PCT_TOTALMENTE_ATENDIDO",
  "OP_PCT_PARCIALMENTE_ATENDIDO",
  "OP_PCT_NAO_ATENDIDO",
  "OP_VALOR_TOTALMENTE_ATENDIDO",
  "OP_VALOR_PARCIALMENTE_ATENDIDO",
  "OP_VALOR_NAO_ATENDIDO",
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
  if (QUANTITY_KEYS.has(card.key)) {
    return formatFinanceInteger(card.value);
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
  alertStyle,
  onCardClick,
  activeCardKey,
}: {
  card: PortfolioIntelligenceCardDto;
  alertStyle: boolean;
  onCardClick?: (cardKey: string) => void;
  activeCardKey?: string | null;
}) {
  const tone = TONE_BY_KEY[card.key] ?? "neutral";
  const mark = MARK_BY_KEY[card.key] ?? (alertStyle ? "!" : "✓");
  const complete = hasCompleteExplanation(card);
  const clickable = Boolean(onCardClick);
  const isActive = activeCardKey === card.key;
  const title = intelligenceCardTitle(card.key, card.title);
  const subtitle = INTELLIGENCE_CARD_SUBTITLE[card.key];
  const isAlert = alertStyle || Boolean(card.isAlertCard) || ALERT_KEYS.has(card.key);

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
        "relative flex min-h-[112px] flex-col rounded-[14px] border border-solid p-4 outline-none",
        TONE_CLASS[tone],
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
      <div className="mb-2 flex items-start gap-2 pr-7">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/80 text-[14px] font-semibold leading-none",
            MARK_TONE[tone]
          )}
          aria-hidden
        >
          {mark}
        </span>
        <div className="min-w-0">
          <h3 className="text-[12px] font-semibold uppercase leading-snug tracking-wide text-[#344054]">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] leading-snug text-[#667085]">{subtitle}</p>
          ) : null}
        </div>
      </div>
      <p className="text-[24px] font-bold tabular-nums leading-tight tracking-tight text-[#101828] sm:text-[28px]">
        {formatPrimaryValue(card)}
      </p>
      <p className="mt-auto pt-2 text-[12px] tabular-nums text-[#667085] sm:text-[13px]">
        {formatFinanceInteger(card.count)} pedido(s)
        {card.percentage != null && !PERCENT_KEYS.has(card.key)
          ? ` · ${formatFinancePercent(card.percentage)} da carteira`
          : ""}
        {isAlert ? ` · ${INTELLIGENCE_ALERTS_SHORT.replace(/\.$/, "")}` : ""}
      </p>
    </article>
  );
}

/**
 * Grade de cards da Central de Auditoria — só formata; números e explanations vêm da API.
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
  const attentionCards = pick(ATTENTION_CARD_KEYS);
  const secondaryCards = pick(SECONDARY_CARD_KEYS);
  const ordered = [
    ...(totalCard ? [totalCard] : []),
    ...financialCards,
    ...operationalCards,
    ...attentionCards,
    ...secondaryCards,
  ];

  // Referência para testes de ordem visual (mantém CARD_ORDER no bundle).
  void CARD_ORDER;

  if (loading) {
    return (
      <div className="space-y-6" data-testid="portfolio-intelligence-cards-loading">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-[112px] animate-pulse rounded-[14px] border border-[#EAECF0] bg-[#F9FAFB]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (ordered.length === 0) {
    return (
      <div
        className="rounded-[14px] border border-dashed border-[#D0D5DD] bg-[#F9FAFB] px-4 py-10 text-center"
        data-testid="portfolio-intelligence-cards-empty"
      >
        <p className="text-sm font-medium text-[#101828]">Nenhum indicador neste filtro</p>
        <p className="mt-1 text-xs text-[#667085]">
          Ajuste cliente, período ou status — ou limpe os filtros para ver a carteira completa.
        </p>
      </div>
    );
  }

  const renderBlock = (
    title: string,
    description: string,
    blockCards: PortfolioIntelligenceCardDto[],
    opts: {
      alert?: boolean;
      testId: string;
      notice?: string;
    }
  ) => {
    if (blockCards.length === 0) return null;
    return (
      <section
        className="rounded-[14px] border border-[#EAECF0] bg-white p-4 sm:p-5"
        data-testid={opts.testId}
      >
        <div className="mb-3">
          <h3 className="text-[16px] font-bold text-[#101828]">{title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-[#667085]">{description}</p>
        </div>
        {opts.notice ? (
          <p
            className="mb-3 rounded-[12px] border border-[#FDBA74] bg-[#FFF6ED] px-3 py-2.5 text-[12px] leading-relaxed text-[#C2410C]"
            data-testid="portfolio-intelligence-alerts-notice"
          >
            {opts.notice}
          </p>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))] sm:gap-4">
          {blockCards.map((card) => (
            <CardArticle
              key={card.key}
              card={card}
              alertStyle={Boolean(opts.alert)}
              onCardClick={onCardClick}
              activeCardKey={activeCardKey}
            />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-6" data-testid="portfolio-intelligence-cards">
      {totalCard ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-[#D0D5DD] bg-[#F9FAFB] px-4 py-3"
          data-testid="portfolio-intelligence-card-CARTEIRA_TOTAL_ANALISADA"
        >
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[#667085]">
              {intelligenceCardTitle(totalCard.key, totalCard.title)}
            </p>
            <p className="text-[11px] text-[#667085]">
              {INTELLIGENCE_CARD_SUBTITLE[totalCard.key] ?? "Base 100% do filtro"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-[24px] font-bold tabular-nums text-[#101828]">
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

      {renderBlock(
        INTELLIGENCE_BLOCK_FINANCIAL_TITLE,
        INTELLIGENCE_BLOCK_FINANCIAL_DESC,
        financialCards,
        { testId: "portfolio-intelligence-cards-financial" }
      )}
      {renderBlock(
        INTELLIGENCE_BLOCK_OPERATIONAL_TITLE,
        INTELLIGENCE_BLOCK_OPERATIONAL_DESC,
        operationalCards,
        { testId: "portfolio-intelligence-cards-operational" }
      )}
      {renderBlock(
        INTELLIGENCE_BLOCK_ALERTS_TITLE,
        INTELLIGENCE_BLOCK_ALERTS_DESC,
        attentionCards,
        {
          alert: true,
          testId: "portfolio-intelligence-cards-alerts",
          notice: `${INTELLIGENCE_ALERTS_NOTICE} ${INTELLIGENCE_ALERTS_SHORT}`,
        }
      )}

      {secondaryCards.length > 0 ? (
        <section
          className="rounded-[14px] border border-dashed border-[#EAECF0] bg-[#FCFCFD] p-4 sm:p-5"
          data-testid="portfolio-intelligence-cards-secondary"
        >
          <div className="mb-3">
            <h3 className="text-[14px] font-bold text-[#344054]">Conversão e confiança</h3>
            <p className="mt-1 text-[12px] leading-relaxed text-[#667085]">
              Indicadores auxiliares — não somam com os blocos acima.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
            {secondaryCards.map((card) => (
              <CardArticle
                key={card.key}
                card={card}
                alertStyle={false}
                onCardClick={onCardClick}
                activeCardKey={activeCardKey}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
