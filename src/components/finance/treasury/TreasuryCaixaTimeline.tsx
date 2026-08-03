/**
 * Caixa — Passos 4 e 5: "E os próximos dias?" e "Me dá a visão do mês".
 *
 * Passo 4: um dia por linha. Dia passado mostra o que foi REALMENTE pago/recebido;
 * dia futuro mostra PREVISÃO. O "hoje" fica marcado, separando os dois mundos.
 *
 * Passo 5: os mesmos dias agrupados por mês; clicar no mês abre os dias dele.
 * O padrão é mensal quando o período cobre mais de um mês — filtrar um mês só e
 * ver uma linha de mês seria inútil.
 *
 * Toda a classificação e agregação vem do domínio
 * (`buildTreasuryCaixaTimeline` / `buildTreasuryCaixaMonthlyTimeline`), que por
 * sua vez consome a agenda canônica — sem cálculo próprio aqui.
 */

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type {
  TreasuryCaixaTimeline,
  TreasuryCaixaTimelineMonth,
  TreasuryCaixaTimelineRow,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import {
  buildTreasuryCaixaMonthlyTimeline,
  detectTreasuryCaixaOutliers,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { cn } from "@/src/lib/utils";

export type TreasuryCaixaTimelineProps = {
  timeline: TreasuryCaixaTimeline | null;
  loading?: boolean;
  /** Mensagem de configuração pendente (ex.: empresa não definida nas contas). */
  unavailableReason?: string | null;
  /** Presente quando falta gerar a projeção materializada do período. */
  onGenerateProjection?: () => void;
  generatingProjection?: boolean;
};

type ViewMode = "month" | "day";

function money(value: number | null): string {
  if (value == null) return "—";
  return formatPredictiveCashFlowMoney(value);
}

/** "2026-08" → "Agosto/2026". */
function formatMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  const label = date.toLocaleDateString("pt-BR", { month: "long" });
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}/${y}`;
}

function MonthKindBadge({ kind }: { kind: TreasuryCaixaTimelineMonth["kind"] }) {
  if (kind === "CURRENT") {
    return (
      <span className="rounded bg-[#1E3A8A] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
        mês atual
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

/**
 * Divergência: saldo informado no extrato menos o calculado pelos títulos.
 * Zero explícito ≠ ausência — "—" quer dizer que ninguém informou saldo no dia,
 * então não há o que comparar. Só o valor diferente de zero ganha cor.
 */
function DivergenceCell({
  value,
  informed,
}: {
  value: number | null;
  informed: number | null;
}) {
  if (value == null) {
    return (
      <td
        className="px-2 py-1.5 text-right tabular-nums text-muted-foreground"
        title="Nenhum saldo informado neste dia — nada a comparar."
      >
        —
      </td>
    );
  }
  if (value === 0) {
    return (
      <td
        className="px-2 py-1.5 text-right tabular-nums text-[#059669]"
        title="Saldo informado bate exatamente com o calculado pelos títulos."
      >
        ✓
      </td>
    );
  }
  return (
    <td
      className={cn(
        "px-2 py-1.5 text-right tabular-nums font-semibold",
        value > 0 ? "text-[#0369A1]" : "text-[#B45309]"
      )}
      title={
        value > 0
          ? `Entrou ${formatPredictiveCashFlowMoney(value)} a mais do que os títulos explicam (saldo informado: ${money(informed)}).`
          : `Saiu ${formatPredictiveCashFlowMoney(Math.abs(value))} a mais do que os títulos explicam (saldo informado: ${money(informed)}).`
      }
    >
      {value > 0 ? "+" : ""}
      {money(value)}
    </td>
  );
}

/** Marca o valor que se destacou do padrão do período. */
function OutlierMark({ direction }: { direction: "HIGH" | "LOW" }) {
  return (
    <span
      className="ml-1 inline-block align-middle text-[10px] font-bold text-[#B45309]"
      title={
        direction === "HIGH"
          ? "Muito acima do típico do período — vale conferir."
          : "Muito abaixo do típico do período — vale conferir."
      }
      data-testid="caixa-timeline-outlier"
    >
      {direction === "HIGH" ? "▲" : "▼"}
    </span>
  );
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
  onGenerateProjection,
  generatingProjection = false,
}: TreasuryCaixaTimelineProps) {
  const months = useMemo(
    () => (timeline ? buildTreasuryCaixaMonthlyTimeline(timeline.rows) : []),
    [timeline]
  );
  const spansMultipleMonths = months.length > 1;
  /** Anomalias indexadas por dia+campo, para marcar a célula direto na tabela. */
  const outliers = useMemo(() => {
    const map = new Map<string, "HIGH" | "LOW">();
    if (!timeline) return map;
    for (const o of detectTreasuryCaixaOutliers(timeline.rows)) {
      map.set(`${o.civilDate}|${o.field}`, o.direction);
    }
    return map;
  }, [timeline]);
  const outlierCount = outliers.size;
  const [mode, setMode] = useState<ViewMode>("day");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());

  // Período de vários meses → começa agrupado; um mês só → dia a dia direto.
  useEffect(() => {
    setMode(spansMultipleMonths ? "month" : "day");
    setExpanded(new Set());
  }, [spansMultipleMonths, timeline]);

  function toggleMonth(monthKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  return (
    <section
      className="rounded-lg border border-border bg-card p-3 shadow-sm"
      data-testid="caixa-timeline"
      data-mode={mode}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          Linha do tempo — {mode === "month" ? "por mês" : "dia a dia"}
        </h2>
        <div className="flex items-center gap-2">
          {timeline ? (
            <p className="text-xs text-muted-foreground">
              {timeline.realizedCount}{" "}
              {timeline.realizedCount === 1 ? "dia" : "dias"} realizado
              {timeline.realizedCount === 1 ? "" : "s"} ·{" "}
              {timeline.forecastCount} previsto
              {timeline.forecastCount === 1 ? "" : "s"}
            </p>
          ) : null}
          {/* A projeção é um retrato congelado — quando títulos/saldos mudam,
              o futuro só acompanha depois de regenerar. Sem este botão fixo a
              atualização era impossível quando já existia um run antigo. */}
          {onGenerateProjection && !unavailableReason ? (
            <button
              type="button"
              onClick={onGenerateProjection}
              disabled={generatingProjection || loading}
              className="inline-flex items-center rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
              data-testid="caixa-timeline-refresh-projection"
            >
              {generatingProjection ? "Atualizando…" : "Atualizar projeção"}
            </button>
          ) : null}
          {spansMultipleMonths ? (
            <div
              className="inline-flex rounded-md border border-border bg-background p-0.5"
              role="group"
              aria-label="Agrupamento da linha do tempo"
            >
              {(["month", "day"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-semibold transition",
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`caixa-timeline-mode-${m}`}
                >
                  {m === "month" ? "Por mês" : "Por dia"}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Aviso sobre o FUTURO — não substitui a tabela: passado e hoje são fato. */}
      {unavailableReason ? (
        <div
          className="mb-2 rounded-md border border-[#FDE68A] bg-[#FFFBEB] px-2.5 py-2 text-[11px] text-[#92400E]"
          data-testid="caixa-timeline-unavailable"
        >
          <p>{unavailableReason}</p>
          {onGenerateProjection ? (
            <button
              type="button"
              onClick={onGenerateProjection}
              disabled={generatingProjection}
              className="mt-2 inline-flex items-center rounded-md border border-[#92400E]/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-[#92400E] hover:bg-[#FFFBEB] disabled:opacity-60"
              data-testid="caixa-timeline-generate-projection"
            >
              {generatingProjection ? "Gerando projeção…" : "Gerar projeção"}
            </button>
          ) : null}
        </div>
      ) : null}

      {loading ? (
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
                  <th className="px-2 py-1.5">
                    {mode === "month" ? "Mês" : "Dia"}
                  </th>
                  <th className="px-2 py-1.5">Situação</th>
                  <th className="px-2 py-1.5 text-right">Começou</th>
                  <th className="px-2 py-1.5 text-right">Entrou</th>
                  <th className="px-2 py-1.5 text-right">Saiu</th>
                  <th className="px-2 py-1.5 text-right">Terminou</th>
                  <th
                    className="px-2 py-1.5 text-right"
                    title="Saldo informado no extrato menos o calculado pelos títulos."
                  >
                    Divergência
                  </th>
                </tr>
              </thead>
              <tbody>
                {mode === "month"
                  ? months.map((m) => {
                      const isOpen = expanded.has(m.monthKey);
                      return (
                        <React.Fragment key={m.monthKey}>
                          <tr
                            className={cn(
                              "border-b border-border/50 cursor-pointer hover:bg-muted/40",
                              m.kind === "CURRENT" && "bg-[#EFF6FF]",
                              m.kind === "FORECAST" && "text-[#475569]"
                            )}
                            onClick={() => toggleMonth(m.monthKey)}
                            data-testid={`caixa-timeline-month-${m.monthKey}`}
                            data-kind={m.kind}
                            data-expanded={isOpen}
                          >
                            <td className="whitespace-nowrap px-2 py-1.5 font-semibold">
                              <span className="inline-flex items-center gap-1">
                                {isOpen ? (
                                  <ChevronDown
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                  />
                                ) : (
                                  <ChevronRight
                                    className="h-3.5 w-3.5"
                                    aria-hidden
                                  />
                                )}
                                {formatMonthKey(m.monthKey)}
                                <span className="font-normal text-muted-foreground">
                                  ({m.days.length}{" "}
                                  {m.days.length === 1 ? "dia" : "dias"})
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <MonthKindBadge kind={m.kind} />
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {money(m.opening)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[#059669]">
                              {m.inflows === 0 ? "—" : money(m.inflows)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[#DC2626]">
                              {m.outflows === 0 ? "—" : money(m.outflows)}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-1.5 text-right tabular-nums font-semibold",
                                m.negative && "text-[#DC2626]"
                              )}
                            >
                              {money(m.closing)}
                            </td>
                            <DivergenceCell
                              value={m.divergence}
                              informed={null}
                            />
                          </tr>
                          {isOpen
                            ? m.days.map((r) => (
                                <tr
                                  key={r.civilDate}
                                  className={cn(
                                    "border-b border-border/30 bg-muted/20",
                                    r.kind === "FORECAST" && "text-[#475569]"
                                  )}
                                  data-testid={`caixa-timeline-row-${r.civilDate}`}
                                  data-kind={r.kind}
                                >
                                  <td className="whitespace-nowrap py-1.5 pl-7 pr-2 tabular-nums">
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
                                    {outliers.has(`${r.civilDate}|inflows`) ? (
                                      <OutlierMark
                                        direction={
                                          outliers.get(`${r.civilDate}|inflows`)!
                                        }
                                      />
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1.5 text-right tabular-nums text-[#DC2626]">
                                    {r.outflows === 0 ? "—" : money(r.outflows)}
                                    {outliers.has(`${r.civilDate}|outflows`) ? (
                                      <OutlierMark
                                        direction={
                                          outliers.get(`${r.civilDate}|outflows`)!
                                        }
                                      />
                                    ) : null}
                                  </td>
                                  <td
                                    className={cn(
                                      "px-2 py-1.5 text-right tabular-nums font-semibold",
                                      r.negative && "text-[#DC2626]"
                                    )}
                                  >
                                    {money(r.closing)}
                                  </td>
                                  <DivergenceCell
                                    value={r.divergence}
                                    informed={r.closingInformed}
                                  />
                                </tr>
                              ))
                            : null}
                        </React.Fragment>
                      );
                    })
                  : timeline.rows.map((r) => (
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
                      {outliers.has(`${r.civilDate}|inflows`) ? (
                        <OutlierMark
                          direction={outliers.get(`${r.civilDate}|inflows`)!}
                        />
                      ) : null}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[#DC2626]">
                      {r.outflows === 0 ? "—" : money(r.outflows)}
                      {outliers.has(`${r.civilDate}|outflows`) ? (
                        <OutlierMark
                          direction={outliers.get(`${r.civilDate}|outflows`)!}
                        />
                      ) : null}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right tabular-nums font-semibold",
                        r.negative && "text-[#DC2626]"
                      )}
                    >
                      {money(r.closing)}
                    </td>
                    <DivergenceCell
                      value={r.divergence}
                      informed={r.closingInformed}
                    />
                  </tr>
                    ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Dias passados mostram o que foi <strong>realmente</strong> pago e
            recebido. Dias futuros mostram <strong>previsão</strong> pelos títulos
            em aberto — esses ainda podem mudar.
            {mode === "month" ? " Clique num mês para ver os dias." : ""}
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            <strong>&quot;Começou&quot; e &quot;Terminou&quot;</strong> nos dias
            passados são <strong>calculados</strong>: partem de R$ 0,00 em
            01/01/2026 e acumulam entrada/saída dia a dia. Quando existe
            fechamento do dia, o <strong>saldo informado no extrato vale</strong>{" "}
            — o dia fecha nele e o dia seguinte começa nele.
          </p>
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            <strong>Divergência</strong> é o saldo informado menos o calculado
            pelos títulos: é o dinheiro que andou sem título por trás.{" "}
            <span className="text-[#0369A1]">Azul</span> = entrou a mais que o
            esperado; <span className="text-[#B45309]">âmbar</span> = saiu a
            mais. <span className="text-[#059669]">✓</span> = bate exatamente.{" "}
            <strong>&quot;—&quot;</strong> = ninguém informou saldo naquele dia,
            então não há o que comparar.
          </p>
          {outlierCount > 0 ? (
            <p
              className="mt-1 text-[11px] leading-snug text-muted-foreground"
              data-testid="caixa-timeline-outlier-legend"
            >
              <span className="font-bold text-[#B45309]">▲▼</span> marcam{" "}
              <strong>
                {outlierCount} valor{outlierCount === 1 ? "" : "es"} fora do
                padrão
              </strong>{" "}
              do período — muito acima ou muito abaixo do dia típico. Não é erro:
              é um convite a conferir (pode ser um pagamento grande legítimo ou
              um lançamento errado).
            </p>
          ) : null}
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            O dinheiro conta no dia em que <strong>andou</strong>: contas a
            receber entram no dia da <strong>baixa</strong>; contas a pagar, no
            dia do <strong>pagamento</strong> quando o Nomus informa — sem essa
            informação, valem pelo vencimento. Títulos previstos para hoje só
            entram quando forem de fato baixados; o saldo informado das contas é
            sempre a referência, e o futuro parte dele.
          </p>
        </>
      )}
    </section>
  );
}
