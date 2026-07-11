import React from "react";
import { ArrowRight, Ban } from "lucide-react";
import {
  formatFinanceCurrencyCompact,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import type { PortfolioO2cBusinessKpisDto } from "@/src/lib/financePortfolioReconciliationClient";
import type { PortfolioO2cUiFilterHint } from "@/src/lib/finance/portfolioIntelligenceFilters";
import { cn } from "@/src/lib/utils";
import { MetricHelpTooltip } from "./PortfolioIntelligenceHelpPopover";

type Tone = "neutral" | "green" | "blue" | "amber" | "red" | "gray";

const TONE_CLASS: Record<Tone, { border: string; bg: string; text: string; accent: string }> = {
  neutral: {
    border: "border-[#D0D5DD]",
    bg: "bg-[#F9FAFB]",
    text: "text-[#344054]",
    accent: "border-l-[#98A2B3]",
  },
  green: {
    border: "border-[#ABEFC6]",
    bg: "bg-[#ECFDF3]",
    text: "text-[#067647]",
    accent: "border-l-[#12B76A]",
  },
  blue: {
    border: "border-[#B2DDFF]",
    bg: "bg-[#EFF8FF]",
    text: "text-[#175CD3]",
    accent: "border-l-[#2E90FA]",
  },
  amber: {
    border: "border-[#FEDF89]",
    bg: "bg-[#FFFAEB]",
    text: "text-[#B54708]",
    accent: "border-l-[#F79009]",
  },
  red: {
    border: "border-[#FECDCA]",
    bg: "bg-[#FEF3F2]",
    text: "text-[#B42318]",
    accent: "border-l-[#F04438]",
  },
  gray: {
    border: "border-[#D0D5DD]",
    bg: "bg-[#F2F4F7]",
    text: "text-[#667085]",
    accent: "border-l-[#98A2B3]",
  },
};

type Props = {
  kpis: PortfolioO2cBusinessKpisDto;
  loading?: boolean;
  activeHintKey?: string | null;
  onFilterHint: (hint: PortfolioO2cUiFilterHint, activeKey: string) => void;
};

function explanationParts(text: string) {
  return {
    whatItMeans: text,
    howWeCalculate: text,
    whatIsIncluded: "Pedidos do recorte filtrado na Inteligência da Carteira.",
    whatIsExcluded: "Cabeçalho de NF, excedente e alertas técnicos não somam carteira extra.",
    howToInterpret: "Clique no card para filtrar a grade. Alertas técnicos ficam nos indicadores secundários.",
  };
}

/**
 * Bloco principal O2C — 6 KPIs + funil de evidência + buckets de tempo.
 * Só renderiza analytics; clique aplica filtro via callback.
 */
export function PortfolioO2cBusinessBoard({
  kpis,
  loading = false,
  activeHintKey = null,
  onFilterHint,
}: Props) {
  if (loading) {
    return (
      <div className="space-y-4" data-testid="portfolio-o2c-board-loading">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-[120px] animate-pulse rounded-[14px] border border-[#EAECF0] bg-[#F9FAFB]"
            />
          ))}
        </div>
      </div>
    );
  }

  const funnelMain = kpis.evidenceFunnel.filter((s) => s.key !== "BLOQUEADO");
  const blocked = kpis.evidenceFunnel.find((s) => s.key === "BLOQUEADO");

  return (
    <div className="space-y-4" data-testid="portfolio-o2c-business-board">
      <section
        className="rounded-[14px] border border-[#EAECF0] bg-white p-4 sm:p-5"
        data-testid="portfolio-o2c-kpi-cards"
      >
        <div className="mb-3">
          <h3 className="text-[15px] font-bold text-[#101828]">Leitura de negócio (O2C)</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-[#667085]">
            Valor em pedido → entrega → evidência (doc/NF/CR). Clique no card para filtrar a grade.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.cards.map((card) => {
            const tone = TONE_CLASS[card.tone] ?? TONE_CLASS.neutral;
            const active = activeHintKey === card.key;
            const interactive = Boolean(card.filterHint) || card.key === "VALOR_EM_PEDIDOS";
            return (
              <article
                key={card.key}
                role={interactive ? "button" : undefined}
                tabIndex={interactive ? 0 : undefined}
                onClick={
                  interactive
                    ? () =>
                        onFilterHint(
                          card.filterHint ?? {},
                          card.key === "VALOR_EM_PEDIDOS" ? "VALOR_EM_PEDIDOS" : card.key
                        )
                    : undefined
                }
                onKeyDown={
                  interactive
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onFilterHint(
                            card.filterHint ?? {},
                            card.key === "VALOR_EM_PEDIDOS" ? "VALOR_EM_PEDIDOS" : card.key
                          );
                        }
                      }
                    : undefined
                }
                className={cn(
                  "relative flex min-h-[112px] flex-col rounded-[14px] border border-l-4 border-solid p-4 outline-none",
                  tone.border,
                  tone.bg,
                  tone.accent,
                  interactive &&
                    "cursor-pointer transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-sky-300/70",
                  active && "ring-2 ring-sky-400/45"
                )}
                data-testid={`portfolio-o2c-card-${card.key}`}
              >
                <MetricHelpTooltip
                  corner
                  title={card.title}
                  explanation={explanationParts(card.explanation)}
                />
                <h4 className="pr-7 text-[12px] font-semibold uppercase tracking-wide text-[#344054]">
                  {card.title}
                </h4>
                <p className={cn("mt-2 text-[24px] font-bold tabular-nums leading-none", tone.text)}>
                  {formatFinanceCurrencyCompact(card.value)}
                </p>
                <p className="mt-auto pt-2 text-[12px] tabular-nums text-[#667085]">
                  {formatFinanceInteger(card.count)} pedido(s)
                </p>
                {card.key === "SO_PEDIDO" ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      className="rounded-md border border-[#D0D5DD] bg-white px-2 py-0.5 text-[10px] font-medium text-[#344054] hover:bg-[#F9FAFB]"
                      data-testid="portfolio-o2c-chip-so-com-condicao"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFilterHint(
                          { onlyOrderWithPaymentTerms: true },
                          "SO_PEDIDO_COM_CONDICAO"
                        );
                      }}
                    >
                      Com condição · {formatFinanceCurrencyCompact(kpis.soPedidoComCondicao.value)}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-[#FEDF89] bg-[#FFFAEB] px-2 py-0.5 text-[10px] font-medium text-[#B54708] hover:bg-[#FEF0C7]"
                      data-testid="portfolio-o2c-chip-so-sem-condicao"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFilterHint(
                          { onlyOrderWithoutPaymentTerms: true },
                          "SO_PEDIDO_SEM_CONDICAO"
                        );
                      }}
                    >
                      Sem condição · {formatFinanceCurrencyCompact(kpis.soPedidoSemCondicao.value)}
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section
        className="space-y-3 rounded-[14px] border border-[#EAECF0] bg-white p-4 sm:p-5"
        data-testid="portfolio-o2c-evidence-funnel"
      >
        <div>
          <h3 className="text-[15px] font-bold text-[#101828]">Funil de evidência</h3>
          <p className="mt-1 text-[12px] text-[#667085]">
            Só pedido → Doc/NF → CR → Recebido. Bloqueado fica na raia de risco.
          </p>
        </div>
        <div className="flex flex-wrap items-stretch gap-2 overflow-x-auto pb-1">
          {funnelMain.map((stage, idx) => {
            const toneKey: Tone =
              stage.key === "RECEBIDO"
                ? "green"
                : stage.key === "CR_ABERTO"
                  ? "blue"
                  : stage.key === "DOC_OU_NF"
                    ? "blue"
                    : "amber";
            const tone = TONE_CLASS[toneKey];
            const active = activeHintKey === `FUNNEL_${stage.key}`;
            return (
              <React.Fragment key={stage.key}>
                <button
                  type="button"
                  onClick={() =>
                    onFilterHint({ evidenceStage: stage.key }, `FUNNEL_${stage.key}`)
                  }
                  className={cn(
                    "min-w-[140px] flex-1 rounded-xl border border-l-4 p-3 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70",
                    tone.border,
                    tone.bg,
                    tone.accent,
                    active && "ring-2 ring-sky-400/45"
                  )}
                  data-testid={`portfolio-o2c-funnel-${stage.key}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
                    {stage.label}
                  </p>
                  <p className={cn("mt-1.5 text-[18px] font-bold tabular-nums", tone.text)}>
                    {formatFinanceCurrencyCompact(stage.value)}
                  </p>
                  <p className="mt-1 text-[11px] text-[#667085]">
                    {formatFinanceInteger(stage.count)} pedido(s)
                  </p>
                </button>
                {idx < funnelMain.length - 1 ? (
                  <div className="flex items-center text-[#98A2B3]" aria-hidden>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                ) : null}
              </React.Fragment>
            );
          })}
        </div>
        {blocked ? (
          <button
            type="button"
            onClick={() =>
              onFilterHint({ evidenceStage: "BLOQUEADO" }, "FUNNEL_BLOQUEADO")
            }
            className={cn(
              "flex w-full flex-wrap items-center gap-3 rounded-xl border border-l-4 p-3 text-left",
              TONE_CLASS.red.border,
              TONE_CLASS.red.bg,
              TONE_CLASS.red.accent,
              activeHintKey === "FUNNEL_BLOQUEADO" && "ring-2 ring-sky-400/45"
            )}
            data-testid="portfolio-o2c-funnel-BLOQUEADO"
          >
            <Ban className={cn("h-5 w-5", TONE_CLASS.red.text)} />
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wide text-[#B42318]">
                Raia de risco — {blocked.label}
              </p>
              <p className="text-[13px] text-[#B42318]">
                {formatFinanceCurrencyCompact(blocked.value)} ·{" "}
                {formatFinanceInteger(blocked.count)} pedido(s)
              </p>
            </div>
          </button>
        ) : null}
      </section>

      <section
        className="rounded-[14px] border border-[#EAECF0] bg-white p-4 sm:p-5"
        data-testid="portfolio-o2c-aging-buckets"
      >
        <div className="mb-3">
          <h3 className="text-[15px] font-bold text-[#101828]">Quando entra no caixa (previsto)</h3>
          <p className="mt-1 text-[12px] text-[#667085]">
            Data efetiva: vencimento do CR, senão forecast, senão entrega. Clique para filtrar pelo
            eixo de previsão.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {kpis.agingBuckets.map((bucket) => {
            const toneKey: Tone =
              bucket.key === "OVERDUE"
                ? "red"
                : bucket.key === "SEM_DATA"
                  ? "gray"
                  : bucket.key === "D0_30"
                    ? "green"
                    : "amber";
            const tone = TONE_CLASS[toneKey];
            const active = activeHintKey === `AGING_${bucket.key}`;
            return (
              <button
                key={bucket.key}
                type="button"
                onClick={() =>
                  onFilterHint(
                    { agingBucket: bucket.key, asOfDate: kpis.asOfDate },
                    `AGING_${bucket.key}`
                  )
                }
                className={cn(
                  "rounded-xl border border-l-4 p-3 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70",
                  tone.border,
                  tone.bg,
                  tone.accent,
                  active && "ring-2 ring-sky-400/45"
                )}
                data-testid={`portfolio-o2c-aging-${bucket.key}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
                  {bucket.label}
                </p>
                <p className={cn("mt-1.5 text-[16px] font-bold tabular-nums", tone.text)}>
                  {formatFinanceCurrencyCompact(bucket.value)}
                </p>
                <p className="mt-1 text-[11px] text-[#667085]">
                  {formatFinanceInteger(bucket.count)}
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
