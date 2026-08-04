/**
 * Caixa — "Movimento de hoje" (canônico).
 *
 * Três blocos distintos por dimensão do dia — sem misturar previsão com
 * realização, sem depender de três populações diferentes:
 *
 *   CONTAS A RECEBER: A receber hoje / Recebido hoje
 *   CONTAS A PAGAR:   A pagar hoje  / Pago hoje
 *   SALDO:            Começou / Entradas / Saídas / Terminou
 *
 * Todos os quatro números do CR/CP vêm do motor único-de-dia
 * (`buildTreasuryCaixaCanonicalDays`), mesma fonte que o drill-down. Os quatro
 * números do bloco SALDO vêm do fechamento diário canônico (`/today/closing`).
 * Saldo indisponível vira "—", nunca R$ 0,00 falso.
 */

import React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TreasuryCaixaDayFlow } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import type { TreasuryCaixaCanonicalDay } from "@/src/lib/treasury/domain/treasuryCaixaCanonicalDay.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";

export type TreasuryCaixaTodayFlowProps = {
  flow: TreasuryCaixaDayFlow | null;
  /**
   * Dia canônico de HOJE, quando disponível no board. Traz A receber/Recebido
   * hoje e A pagar/Pago hoje — todos vindos da mesma população que o
   * drill-down. Ausente = não caiu no período consultado; nesse caso o card
   * mostra "—" para os quatro números do bloco CR/CP.
   */
  canonicalToday?: TreasuryCaixaCanonicalDay | null;
  loading?: boolean;
};

/** "—" para ausência: saldo/dado não informado nunca vira R$ 0,00 na tela. */
function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(value);
}

/** Zero explícito quando a lista existe (mesmo vazia): "R$ 0,00" é fato. */
function moneyOrZero(value: number | null | undefined, hasData: boolean): string {
  if (!hasData) return "—";
  return formatPredictiveCashFlowMoney(value ?? 0);
}

function SubCell({
  label,
  value,
  tone = "neutral",
  count,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "in" | "out";
  count?: number;
}) {
  const valueClass =
    tone === "in"
      ? "text-[#065F46]"
      : tone === "out"
        ? "text-[#991B1B]"
        : "text-[#111827]";
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[#6B7280]">
        {tone === "in" ? (
          <ArrowDownLeft className="h-3 w-3 text-[#059669]" aria-hidden />
        ) : tone === "out" ? (
          <ArrowUpRight className="h-3 w-3 text-[#DC2626]" aria-hidden />
        ) : null}
        {label}
      </p>
      <p
        className={`mt-0.5 truncate text-base font-extrabold tabular-nums tracking-tight ${valueClass}`}
      >
        {value}
      </p>
      {count != null ? (
        <p className="text-[10px] text-[#6B7280]">
          {count} {count === 1 ? "título" : "títulos"}
        </p>
      ) : null}
    </div>
  );
}

function Block({
  title,
  tone,
  children,
  testId,
}: {
  title: string;
  tone: "in" | "out" | "neutral";
  children: React.ReactNode;
  testId: string;
}) {
  const border =
    tone === "in"
      ? "border-emerald-200 bg-emerald-50/50"
      : tone === "out"
        ? "border-red-200 bg-red-50/50"
        : "border-slate-200 bg-slate-50/40";
  const titleClass =
    tone === "in"
      ? "text-emerald-800"
      : tone === "out"
        ? "text-red-800"
        : "text-slate-700";
  return (
    <div
      className={`rounded-lg border ${border} px-3 py-2.5`}
      data-testid={testId}
    >
      <h3
        className={`mb-1.5 text-[10px] font-bold uppercase tracking-wide ${titleClass}`}
      >
        {title}
      </h3>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

export function TreasuryCaixaTodayFlow({
  flow,
  canonicalToday = null,
  loading = false,
}: TreasuryCaixaTodayFlowProps) {
  const hasCanonical = canonicalToday != null;
  return (
    <section
      className="rounded-lg border border-border bg-card px-4 py-3 shadow-sm"
      data-testid="caixa-today-flow"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Movimento de hoje
        </h2>
        <p className="text-xs text-muted-foreground">
          {flow ? formatCivilDate(flow.civilDate) : "—"}
          {flow && flow.accountCount > 0
            ? ` · ${flow.accountCount} ${flow.accountCount === 1 ? "conta" : "contas"}`
            : ""}
        </p>
      </div>

      {loading ? (
        <p className="py-3 text-xs text-muted-foreground">Carregando…</p>
      ) : !flow ? (
        <p className="py-3 text-xs text-muted-foreground">
          Não foi possível carregar o movimento de hoje.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            <Block title="Contas a Receber" tone="in" testId="caixa-today-cr-block">
              <SubCell
                label="A receber hoje"
                value={moneyOrZero(canonicalToday?.receivableDue, hasCanonical)}
                tone="in"
                count={
                  hasCanonical ? canonicalToday!.receivableDueTitles.length : undefined
                }
              />
              <SubCell
                label="Recebido hoje"
                value={moneyOrZero(canonicalToday?.receivableReceived, hasCanonical)}
                tone="in"
                count={
                  hasCanonical
                    ? canonicalToday!.receivableReceivedTitles.length
                    : undefined
                }
              />
            </Block>

            <Block title="Contas a Pagar" tone="out" testId="caixa-today-cp-block">
              <SubCell
                label="A pagar hoje"
                value={moneyOrZero(canonicalToday?.payableDue, hasCanonical)}
                tone="out"
                count={
                  hasCanonical ? canonicalToday!.payableDueTitles.length : undefined
                }
              />
              <SubCell
                label="Pago hoje"
                value={moneyOrZero(canonicalToday?.payablePaid, hasCanonical)}
                tone="out"
                count={
                  hasCanonical ? canonicalToday!.payablePaidTitles.length : undefined
                }
              />
            </Block>

            <Block title="Saldo" tone="neutral" testId="caixa-today-saldo-block">
              <SubCell label="Começou com" value={money(flow.opening)} />
              <SubCell
                label="Terminou com"
                value={money(flow.closingInformed ?? flow.closingCalculated)}
              />
              <SubCell
                label="Entradas realizadas"
                value={money(flow.inflows)}
                tone="in"
              />
              <SubCell
                label="Saídas realizadas"
                value={money(flow.outflows)}
                tone="out"
              />
            </Block>
          </div>

          {!hasCanonical ? (
            <p
              className="mt-2 text-[11px] leading-snug text-muted-foreground"
              data-testid="caixa-today-flow-no-canonical"
            >
              A receber/pago hoje aparecem como <strong>—</strong> porque hoje
              não caiu no período consultado.
            </p>
          ) : null}

          {flow.pendingClosingCount > 0 ? (
            <p
              className="mt-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-1.5 text-[11px] text-[#92400E]"
              data-testid="caixa-today-flow-pending"
            >
              {flow.pendingClosingCount === 1
                ? "1 conta ainda sem saldo final informado hoje."
                : `${flow.pendingClosingCount} contas ainda sem saldo final informado hoje.`}{" "}
              Enquanto não informar, o &quot;terminou com&quot; é o valor calculado
              pelos títulos, não o do extrato.
            </p>
          ) : null}

          {flow.closingInformed == null && flow.closingCalculated != null ? (
            <p
              className="mt-1 text-[11px] leading-snug text-muted-foreground"
              data-testid="caixa-today-flow-calc-note"
            >
              Terminou com: calculado — extrato não informado.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
