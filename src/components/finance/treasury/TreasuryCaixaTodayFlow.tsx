/**
 * Caixa — Passo 3: "Quanto entrou e quanto saiu hoje?"
 *
 * Uma linha, quatro números: começou / entrou / saiu / terminou.
 * Tudo vem pronto do workspace canônico de fechamento diário (/today/closing),
 * que já calcula entradas e saídas realizadas por conta. Aqui só somamos as
 * contas — nenhum motor de caixa é refeito.
 */

import React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { TreasuryCaixaDayFlow } from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";

export type TreasuryCaixaTodayFlowProps = {
  flow: TreasuryCaixaDayFlow | null;
  loading?: boolean;
};

/** "—" para ausência: saldo não informado nunca vira R$ 0,00 na tela. */
function money(value: number | null): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(value);
}

function Cell({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "in" | "out";
  hint?: string;
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
        className={`mt-0.5 truncate text-lg font-extrabold tabular-nums tracking-tight ${valueClass}`}
      >
        {value}
      </p>
      {hint ? <p className="text-[10px] text-[#6B7280]">{hint}</p> : null}
    </div>
  );
}

export function TreasuryCaixaTodayFlow({
  flow,
  loading = false,
}: TreasuryCaixaTodayFlowProps) {
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cell label="Começou com" value={money(flow.opening)} />
            <Cell
              label="Entrou"
              value={money(flow.inflows)}
              tone="in"
              hint={
                flow.predictedInflows != null
                  ? `previsto hoje: ${money(flow.predictedInflows)}`
                  : undefined
              }
            />
            <Cell
              label="Saiu"
              value={money(flow.outflows)}
              tone="out"
              hint={
                flow.predictedOutflows != null
                  ? `previsto hoje: ${money(flow.predictedOutflows)}`
                  : undefined
              }
            />
            <Cell
              label="Terminou com"
              value={money(flow.closingInformed ?? flow.closingCalculated)}
              hint={
                flow.closingInformed == null && flow.closingCalculated != null
                  ? "calculado — extrato não informado"
                  : undefined
              }
            />
          </div>

          {flow.predictedInflows != null || flow.predictedOutflows != null ? (
            <p
              className="mt-2 text-[11px] leading-snug text-muted-foreground"
              data-testid="caixa-today-flow-predicted"
            >
              <strong>Previsto para hoje</strong> (títulos em aberto vencendo
              hoje — mesma regra do Fluxo de Caixa): a entrar{" "}
              <span className="font-semibold text-[#065F46]">
                {money(flow.predictedInflows ?? null)}
              </span>{" "}
              · a pagar{" "}
              <span className="font-semibold text-[#991B1B]">
                {money(flow.predictedOutflows ?? null)}
              </span>
              . &quot;Entrou&quot;/&quot;Saiu&quot; acima mostram só o que já
              foi baixado de fato.
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
        </>
      )}
    </section>
  );
}
