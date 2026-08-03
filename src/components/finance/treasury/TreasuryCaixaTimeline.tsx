/**
 * Caixa — Passo 4: "E os próximos dias?"
 *
 * Um dia por linha. Dia passado mostra o que foi REALMENTE pago/recebido;
 * dia futuro mostra PREVISÃO. O "hoje" fica marcado, separando os dois mundos.
 * A classificação e os números vêm do domínio (`buildTreasuryCaixaTimeline`),
 * que por sua vez consome a agenda canônica — sem cálculo próprio aqui.
 */

import React from "react";
import type {
  TreasuryCaixaTimeline,
  TreasuryCaixaTimelineRow,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { cn } from "@/src/lib/utils";

export type TreasuryCaixaTimelineProps = {
  timeline: TreasuryCaixaTimeline | null;
  loading?: boolean;
  /** Mensagem de configuração pendente (ex.: empresa não definida nas contas). */
  unavailableReason?: string | null;
};

function money(value: number | null): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(value);
}

/** Rótulo textual além da cor — acessibilidade e clareza para quem é leigo. */
function KindBadge({ kind }: { kind: TreasuryCaixaTimelineRow["kind"] }) {
  if (kind === "TODAY") {
    return (
      <span className="rounded bg-[#1E3A8A] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        hoje
      </span>
    );
  }
  if (kind === "REALIZED") {
    return (
      <span className="rounded border border-[#A7F3D0] bg-[#ECFDF5] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#065F46]">
        realizado
      </span>
    );
  }
  return (
    <span className="rounded border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#475569]">
      previsto
    </span>
  );
}

export function TreasuryCaixaTimeline({
  timeline,
  loading = false,
  unavailableReason = null,
}: TreasuryCaixaTimelineProps) {
  return (
    <section
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
      data-testid="caixa-timeline"
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Linha do tempo — dia a dia
        </h2>
        {timeline ? (
          <p className="text-xs text-muted-foreground">
            {timeline.realizedCount} {timeline.realizedCount === 1 ? "dia" : "dias"}{" "}
            realizado{timeline.realizedCount === 1 ? "" : "s"} ·{" "}
            {timeline.forecastCount} previsto
            {timeline.forecastCount === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>

      {unavailableReason ? (
        <p
          className="rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-2 text-[11px] text-[#92400E]"
          data-testid="caixa-timeline-unavailable"
        >
          {unavailableReason}
        </p>
      ) : loading ? (
        <p className="py-3 text-xs text-muted-foreground">Carregando…</p>
      ) : !timeline || timeline.rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">
          Sem dias no período selecionado.
        </p>
      ) : (
        <>
          {timeline.firstNegativeDate ? (
            <p
              className="mb-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-1.5 text-[11px] font-medium text-[#991B1B]"
              data-testid="caixa-timeline-negative-warning"
            >
              Saldo fica negativo em{" "}
              {formatCivilDate(timeline.firstNegativeDate)}.
            </p>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="caixa-timeline-table">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-2 py-1.5">Dia</th>
                  <th className="px-2 py-1.5">Situação</th>
                  <th className="px-2 py-1.5 text-right">Começou</th>
                  <th className="px-2 py-1.5 text-right">Entrou</th>
                  <th className="px-2 py-1.5 text-right">Saiu</th>
                  <th className="px-2 py-1.5 text-right">Terminou</th>
                </tr>
              </thead>
              <tbody>
                {timeline.rows.map((r) => (
                  <tr
                    key={r.civilDate}
                    className={cn(
                      "border-b border-border/50",
                      r.kind === "TODAY" && "bg-[#EFF6FF]",
                      r.kind === "FORECAST" && "text-[#475569]"
                    )}
                    data-testid={`caixa-timeline-row-${r.civilDate}`}
                    data-kind={r.kind}
                  >
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums font-medium">
                      {formatCivilDate(r.civilDate)}
                    </td>
                    <td className="px-2 py-1.5">
                      <KindBadge kind={r.kind} />
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {money(r.opening)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#059669]">
                      {r.inflows === 0 ? "—" : money(r.inflows)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#DC2626]">
                      {r.outflows === 0 ? "—" : money(r.outflows)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right tabular-nums font-semibold",
                        r.negative && "text-[#DC2626]"
                      )}
                    >
                      {money(r.closing)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Dias passados mostram o que foi <strong>realmente</strong> pago e
            recebido. Dias futuros mostram <strong>previsão</strong> pelos títulos
            em aberto — esses ainda podem mudar.
          </p>
        </>
      )}
    </section>
  );
}
