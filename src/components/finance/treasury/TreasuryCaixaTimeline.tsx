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
import { ChevronDown, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
import type {
  TreasuryCaixaMonthlyDueEstimate,
  TreasuryCaixaTimeline,
  TreasuryCaixaTimelineMonth,
  TreasuryCaixaTimelineRow,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import {
  appendTreasuryCaixaMonthlyDueEstimates,
  buildTreasuryCaixaMonthlyTimeline,
  detectTreasuryCaixaOutliers,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { formatPredictiveCashFlowMoney } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { cn } from "@/src/lib/utils";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";

export type TreasuryCaixaTimelineProps = {
  timeline: TreasuryCaixaTimeline | null;
  loading?: boolean;
  /** Mensagem de configuração pendente (ex.: empresa não definida nas contas). */
  unavailableReason?: string | null;
  /** Presente quando falta gerar a projeção materializada do período. */
  onGenerateProjection?: () => void;
  generatingProjection?: boolean;
  /**
   * Estimativa mensal por vencimento (mesma regra do "Linha do tempo mensal"
   * do Fluxo de Caixa) — complementa meses futuros que a agenda/projeção
   * materializada ainda não cobre, em vez de deixá-los ausentes da tabela.
   */
  monthlyDueEstimates?: readonly TreasuryCaixaMonthlyDueEstimate[];
  /**
   * Carteira aberta do período (mesmos dados dos cards "Contas a
   * Receber"/"Contas a Pagar" abaixo) — clicar num dia mostra os títulos
   * daquele dia sem recarregar nada, filtrando estas listas em memória.
   */
  receivables?: readonly FinanceAccountsReceivableGridRow[];
  payables?: readonly FinanceAccountsPayableGridRow[];
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

function MonthKindBadge({
  kind,
  estimateOnly,
}: {
  kind: TreasuryCaixaTimelineMonth["kind"];
  estimateOnly?: boolean;
}) {
  if (estimateOnly) {
    return (
      <span
        className="rounded border border-dashed border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#92400E]"
        title="Sem projeção dia a dia gerada para este mês — estimativa por vencimento dos títulos em aberto; saldo acumulado a partir do fechamento do mês anterior."
      >
        estimativa
      </span>
    );
  }
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
  scope,
}: {
  value: number | null;
  /** Saldo informado do dia; irrelevante (e ausente) na linha de mês. */
  informed?: number | null;
  scope: "day" | "month";
}) {
  if (value == null) {
    return (
      <td
        className="px-2 py-1.5 text-right tabular-nums text-muted-foreground"
        title={
          scope === "day"
            ? "Nenhum saldo informado neste dia — nada a comparar."
            : "Nenhum dia deste mês teve saldo informado — nada a comparar."
        }
      >
        —
      </td>
    );
  }
  if (value === 0) {
    return (
      <td
        className="px-2 py-1.5 text-right tabular-nums text-[#059669]"
        title={
          scope === "day"
            ? "Saldo informado bate exatamente com o calculado pelos títulos."
            : "No total do mês, o informado bate com o calculado."
        }
      >
        ✓
      </td>
    );
  }
  const amount = formatPredictiveCashFlowMoney(Math.abs(value));
  const direction = value > 0 ? "Entrou" : "Saiu";
  const suffix =
    scope === "day" && informed != null
      ? ` (saldo informado: ${money(informed)})`
      : scope === "month"
        ? " no total do mês"
        : "";
  return (
    <td
      className={cn(
        "px-2 py-1.5 text-right tabular-nums font-semibold",
        value > 0 ? "text-[#0369A1]" : "text-[#B45309]"
      )}
      title={`${direction} ${amount} a mais do que os títulos explicam${suffix}.`}
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
function KindBadge({
  kind,
  estimated,
}: {
  kind: TreasuryCaixaTimelineRow["kind"];
  estimated?: boolean;
}) {
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
  if (estimated) {
    return (
      <span
        className="rounded border border-dashed border-[#FDE68A] bg-[#FFFBEB] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#92400E]"
        title="Estimado pelos títulos em aberto vencendo neste dia; saldo encadeado do dia anterior."
      >
        estimativa
      </span>
    );
  }
  return (
    <span className="rounded border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#475569]">
      previsto
    </span>
  );
}

/** Dia realizado/hoje é fato liquidado; futuro (previsto/estimado) é vencimento em aberto. */
function isRealizedDayKind(kind: TreasuryCaixaTimelineRow["kind"]): boolean {
  return kind === "REALIZED" || kind === "TODAY";
}

/**
 * Títulos que compõem o dia — mesma data usada para montar o Entrou/Saiu:
 * dia realizado agrupa CR pela BAIXA (`settlementDate`) e CP pelo
 * vencimento (`effectivePaymentDate` = `dueDate` quando liquidado — regra
 * canônica); dia futuro agrupa pelo vencimento em aberto (CP pelo
 * operacional, com fallback de agendamento).
 */
function filterCaixaDayReceivables(
  rows: readonly FinanceAccountsReceivableGridRow[],
  civilDate: string,
  realized: boolean
): FinanceAccountsReceivableGridRow[] {
  return rows.filter((r) =>
    realized ? r.settlementDate === civilDate : r.dueDate === civilDate
  );
}

function filterCaixaDayPayables(
  rows: readonly FinanceAccountsPayableGridRow[],
  civilDate: string,
  realized: boolean
): FinanceAccountsPayableGridRow[] {
  return rows.filter((p) =>
    realized
      ? p.dueDate === civilDate
      : (p.operationalDueDate ?? p.dueDate) === civilDate
  );
}

function DayDrilldownTable({
  title,
  amountLabel,
  rows,
  amount,
  tone,
}: {
  title: string;
  amountLabel: string;
  rows: Array<{ id: string | number; name: string | null; status: string; amount: number }>;
  amount: (row: { id: string | number; name: string | null; status: string; amount: number }) => number;
  tone: "in" | "out";
}) {
  const toneClass = tone === "in" ? "text-[#065F46]" : "text-[#991B1B]";
  return (
    <div className="min-w-0 flex-1">
      <p className={cn("mb-1 text-[10px] font-bold uppercase tracking-wide", toneClass)}>
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">Nenhum título neste dia.</p>
      ) : (
        <table className="w-full text-[11px]">
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/30 last:border-0">
                <td className="py-1 pr-2 truncate max-w-[1px]">{row.name ?? "—"}</td>
                <td className="py-1 pr-2 whitespace-nowrap text-muted-foreground">
                  {row.status}
                </td>
                <td
                  className={cn(
                    "py-1 text-right tabular-nums font-medium whitespace-nowrap",
                    toneClass
                  )}
                >
                  {money(amount(row))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="sr-only">{amountLabel}</p>
    </div>
  );
}

/** Drill-down inline de um dia: títulos a receber/pagar por trás do Entrou/Saiu. */
function DayDrilldown({
  civilDate,
  colSpan,
  receivables,
  payables,
  realized,
}: {
  civilDate: string;
  colSpan: number;
  receivables: readonly FinanceAccountsReceivableGridRow[];
  payables: readonly FinanceAccountsPayableGridRow[];
  realized: boolean;
}) {
  const dayReceivables = useMemo(
    () => filterCaixaDayReceivables(receivables, civilDate, realized),
    [receivables, civilDate, realized]
  );
  const dayPayables = useMemo(
    () => filterCaixaDayPayables(payables, civilDate, realized),
    [payables, civilDate, realized]
  );

  return (
    <tr
      className="border-b border-border/30 bg-background"
      data-testid={`caixa-timeline-day-drilldown-${civilDate}`}
    >
      <td colSpan={colSpan} className="px-2 py-2 pl-7">
        {dayReceivables.length === 0 && dayPayables.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum título de CR/CP explica o movimento deste dia — pode ser
            lançamento manual, transferência ou saldo informado diretamente.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-6">
            <DayDrilldownTable
              title="Contas a Receber"
              amountLabel="Saldo a receber"
              tone="in"
              rows={dayReceivables.map((r) => ({
                id: r.externalId,
                name: r.personName,
                status: r.calculatedStatus,
                amount: realized ? r.amountReceived : r.balanceReceivable,
              }))}
              amount={(row) => row.amount}
            />
            <DayDrilldownTable
              title="Contas a Pagar"
              amountLabel="Saldo a pagar"
              tone="out"
              rows={dayPayables.map((p) => ({
                id: p.externalId,
                name: p.personName,
                status: p.calculatedStatus,
                amount: realized ? p.amountPaid : p.balancePayable,
              }))}
              amount={(row) => row.amount}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

export function TreasuryCaixaTimeline({
  timeline,
  loading = false,
  unavailableReason = null,
  onGenerateProjection,
  generatingProjection = false,
  monthlyDueEstimates = [],
  receivables = [],
  payables = [],
}: TreasuryCaixaTimelineProps) {
  const months = useMemo(() => {
    if (!timeline) return [];
    const fromDays = buildTreasuryCaixaMonthlyTimeline(timeline.rows);
    return appendTreasuryCaixaMonthlyDueEstimates(fromDays, monthlyDueEstimates);
  }, [timeline, monthlyDueEstimates]);
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
  const [expandedDays, setExpandedDays] = useState<ReadonlySet<string>>(
    new Set()
  );

  // Período de vários meses → começa agrupado; um mês só → dia a dia direto.
  useEffect(() => {
    setMode(spansMultipleMonths ? "month" : "day");
    setExpanded(new Set());
    setExpandedDays(new Set());
  }, [spansMultipleMonths, timeline]);

  function toggleMonth(monthKey: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  function toggleDay(civilDate: string) {
    setExpandedDays((prev) => {
      const next = new Set(prev);
      if (next.has(civilDate)) next.delete(civilDate);
      else next.add(civilDate);
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
          className="mb-3 flex items-start gap-3 rounded-xl border border-[#FDE68A] bg-gradient-to-br from-[#FFFBEB] to-[#FEF3C7]/70 p-3.5 shadow-sm"
          data-testid="caixa-timeline-unavailable"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F59E0B]/15">
            <Sparkles className="h-4 w-4 text-[#B45309]" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] leading-snug text-[#92400E]">
              {unavailableReason}
            </p>
            {onGenerateProjection ? (
              <button
                type="button"
                onClick={onGenerateProjection}
                disabled={generatingProjection}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-[#B45309] px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-[#92400E] disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="caixa-timeline-generate-projection"
              >
                {generatingProjection ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Gerando projeção…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden />
                    Gerar projeção
                  </>
                )}
              </button>
            ) : null}
          </div>
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
                      const expandable = m.days.length > 0;
                      const isOpen = expanded.has(m.monthKey) && expandable;
                      return (
                        <React.Fragment key={m.monthKey}>
                          <tr
                            className={cn(
                              "border-b border-border/50 hover:bg-muted/40",
                              expandable ? "cursor-pointer" : "cursor-default",
                              m.kind === "CURRENT" && "bg-[#EFF6FF]",
                              m.kind === "FORECAST" && "text-[#475569]"
                            )}
                            onClick={
                              expandable
                                ? () => toggleMonth(m.monthKey)
                                : undefined
                            }
                            data-testid={`caixa-timeline-month-${m.monthKey}`}
                            data-kind={m.kind}
                            data-estimate-only={m.estimateOnly ? "true" : "false"}
                            data-expanded={isOpen}
                          >
                            <td className="whitespace-nowrap px-2 py-1.5 font-semibold">
                              <span className="inline-flex items-center gap-1">
                                {!expandable ? (
                                  <span className="inline-block h-3.5 w-3.5" aria-hidden />
                                ) : isOpen ? (
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
                                  {!expandable
                                    ? "(estimativa por vencimento)"
                                    : m.estimateOnly
                                      ? `(${m.days.length} ${m.days.length === 1 ? "dia" : "dias"} · estimativa)`
                                      : `(${m.days.length} ${m.days.length === 1 ? "dia" : "dias"})`}
                                </span>
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <MonthKindBadge kind={m.kind} estimateOnly={m.estimateOnly} />
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
                              scope="month"
                            />
                          </tr>
                          {isOpen
                            ? m.days.map((r) => {
                                const dayOpen = expandedDays.has(r.civilDate);
                                return (
                                  <React.Fragment key={r.civilDate}>
                                    <tr
                                      className={cn(
                                        "border-b border-border/30 bg-muted/20 cursor-pointer hover:bg-muted/40",
                                        r.kind === "FORECAST" && "text-[#475569]"
                                      )}
                                      onClick={() => toggleDay(r.civilDate)}
                                      data-testid={`caixa-timeline-row-${r.civilDate}`}
                                      data-kind={r.kind}
                                      data-day-expanded={dayOpen}
                                    >
                                      <td className="whitespace-nowrap py-1.5 pl-7 pr-2 tabular-nums">
                                        <span className="inline-flex items-center gap-1">
                                          {dayOpen ? (
                                            <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                                          ) : (
                                            <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                                          )}
                                          {formatCivilDate(r.civilDate)}
                                        </span>
                                      </td>
                                      <td className="px-2 py-1.5">
                                        <KindBadge kind={r.kind} estimated={r.estimated} />
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
                                        scope="day"
                                      />
                                    </tr>
                                    {dayOpen ? (
                                      <DayDrilldown
                                        civilDate={r.civilDate}
                                        colSpan={7}
                                        receivables={receivables}
                                        payables={payables}
                                        realized={isRealizedDayKind(r.kind)}
                                      />
                                    ) : null}
                                  </React.Fragment>
                                );
                              })
                            : null}
                        </React.Fragment>
                      );
                    })
                  : timeline.rows.map((r) => {
                      const dayOpen = expandedDays.has(r.civilDate);
                      return (
                        <React.Fragment key={r.civilDate}>
                          <tr
                            className={cn(
                              "border-b border-border/50 cursor-pointer hover:bg-muted/40",
                              r.kind === "TODAY" && "bg-[#EFF6FF]",
                              r.kind === "FORECAST" && "text-[#475569]"
                            )}
                            onClick={() => toggleDay(r.civilDate)}
                            data-testid={`caixa-timeline-row-${r.civilDate}`}
                            data-kind={r.kind}
                            data-day-expanded={dayOpen}
                          >
                            <td className="whitespace-nowrap px-2 py-1.5 tabular-nums font-medium">
                              <span className="inline-flex items-center gap-1">
                                {dayOpen ? (
                                  <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
                                ) : (
                                  <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
                                )}
                                {formatCivilDate(r.civilDate)}
                              </span>
                            </td>
                            <td className="px-2 py-1.5">
                              <KindBadge kind={r.kind} estimated={r.estimated} />
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
                              scope="day"
                            />
                          </tr>
                          {dayOpen ? (
                            <DayDrilldown
                              civilDate={r.civilDate}
                              colSpan={7}
                              receivables={receivables}
                              payables={payables}
                              realized={isRealizedDayKind(r.kind)}
                            />
                          ) : null}
                        </React.Fragment>
                      );
                    })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Dias passados mostram o que foi <strong>realmente</strong> pago e
            recebido. Dias futuros mostram <strong>previsão</strong> pelos títulos
            em aberto — esses ainda podem mudar.
            {mode === "month" ? " Clique num mês para ver os dias." : ""} Clique
            num dia para ver os títulos de Contas a Receber/Pagar por trás do
            Entrou/Saiu daquele dia.
          </p>
          {months.some((m) => m.estimateOnly) ||
          timeline.rows.some((r) => r.estimated) ? (
            <p
              className="mt-1 text-[11px] leading-snug text-muted-foreground"
              data-testid="caixa-timeline-estimate-legend"
            >
              <strong>Estimativa</strong> = futuro sem projeção materializada,
              estimado <strong>dia a dia</strong> pelos títulos em aberto que
              vencem em cada dia (mesma regra da &quot;Linha do tempo
              mensal&quot; do Fluxo de Caixa). Cada dia abre no fechamento do
              dia anterior — a âncora é o <strong>último caixa conhecido</strong>:
              informar o saldo de hoje recalcula toda a cadeia futura. Clique
              no mês para ver os dias e saber em que dia o caixa aperta. É
              estimativa — títulos ainda podem mudar de data e valor.
            </p>
          ) : null}
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
            Entrou/Saiu dos dias passados seguem <strong>as mesmas regras</strong>{" "}
            da &quot;Linha do tempo mensal&quot; do Fluxo de Caixa (os totais do
            mês batem 1:1 com aquela tela): contas a receber entram no dia da{" "}
            <strong>baixa</strong> — recebimento adiantado ou atrasado aparece
            no dia em que o dinheiro andou; contas a pagar valem pelo{" "}
            <strong>vencimento</strong> (regra canônica — o Nomus raramente
            informa a data real do pagamento). Títulos previstos para hoje só
            entram quando forem de fato baixados; o saldo informado das contas é
            sempre a referência, e o futuro parte dele.
          </p>
        </>
      )}
    </section>
  );
}
