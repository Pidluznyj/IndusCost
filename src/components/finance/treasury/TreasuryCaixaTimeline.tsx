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

import React, { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ChevronDown,
  ChevronRight,
  Info,
  PencilLine,
  TriangleAlert,
} from "lucide-react";
import type {
  TreasuryCaixaMonthlyDueEstimate,
  TreasuryCaixaTimeline,
  TreasuryCaixaTimelineMonth,
  TreasuryCaixaTimelineRow,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import type { TreasuryDailyBalanceDivergenceBaseline } from "@/src/lib/treasury/domain/treasuryDailyBalanceAuthority.js";
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
import type { TreasuryCaixaCanonicalDay } from "@/src/lib/treasury/domain/treasuryCaixaCanonicalDay.js";

export type TreasuryCaixaTimelineProps = {
  timeline: TreasuryCaixaTimeline | null;
  loading?: boolean;
  /**
   * Estimativa mensal por vencimento (mesma regra do "Linha do tempo mensal"
   * do Fluxo de Caixa) — complementa meses futuros que a agenda/projeção
   * materializada ainda não cobre, em vez de deixá-los ausentes da tabela.
   */
  monthlyDueEstimates?: readonly TreasuryCaixaMonthlyDueEstimate[];
  /**
   * @deprecated — mantido só para compatibilidade retroativa do drill-down
   * quando o backend ainda não trouxer `canonicalDays`. A fonte canônica
   * (com A receber / Recebido / A pagar / Pago já separados por dimensão)
   * agora é {@link canonicalDays}. Ver Fase C.
   */
  receivables?: readonly FinanceAccountsReceivableGridRow[];
  payables?: readonly FinanceAccountsPayableGridRow[];
  /**
   * Motor único-de-dia canônico — quando presente, o drill-down de dia
   * mostra as QUATRO dimensões (A receber / Recebido / A pagar / Pago) já
   * separadas pelo backend, com as listas de títulos que fecham cada total
   * no centavo. Elimina o filtro por `dueDate` no frontend.
   */
  canonicalDays?: readonly TreasuryCaixaCanonicalDay[];
  /**
   * Overlay histórico mensal de AR (lotes fevereiro/2026). Não altera a
   * visão dia a dia nem o drill-down canônico.
   */
  historicalArMonthlyInflowDeltaByMonth?: Readonly<Record<string, number>>;
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
 *
 * `divergenceBaseline` (linha de HOJE) declara contra qual saldo a divergência
 * foi medida: "REALIZED" compara contra o fechamento só do que já foi
 * baixado (sem a previsão do próprio dia) — o tooltip precisa deixar isso
 * explícito, senão parece divergência contra o previsto.
 */
function DivergenceCell({
  value,
  informed,
  scope,
  divergenceBaseline,
}: {
  value: number | null;
  /** Saldo informado do dia; irrelevante (e ausente) na linha de mês. */
  informed?: number | null;
  scope: "day" | "month";
  divergenceBaseline?: TreasuryDailyBalanceDivergenceBaseline;
}) {
  const baselineSuffix =
    divergenceBaseline === "REALIZED"
      ? " — comparado ao saldo realizado agora, sem a previsão do dia"
      : "";
  if (value == null) {
    return (
      <td
        className="px-2 py-1.5 text-right tabular-nums text-muted-foreground"
        title={
          scope === "day"
            ? `Nenhum saldo informado neste dia — nada a comparar${baselineSuffix}.`
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
            ? `Saldo informado bate exatamente com o calculado pelos títulos${baselineSuffix}.`
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
      title={`${direction} ${amount} a mais do que os títulos explicam${suffix}${baselineSuffix}.`}
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

/**
 * Marca a parte de "Entrou/Saiu" de HOJE que ainda é previsão — títulos em
 * aberto vencendo hoje. Existe porque a confirmação da baixa só acontece em
 * D+1: durante o próprio dia o caixa considera o previsto, e amanhã a linha
 * passa a mostrar só o que realmente andou.
 */
function ForecastPortionMark({
  amount,
  direction,
}: {
  amount: number;
  direction: "IN" | "OUT";
}) {
  return (
    <span
      className="ml-1 inline-block align-middle rounded border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-1 text-[9px] font-bold uppercase tracking-wide text-[#475569]"
      title={`Inclui ${money(amount)} ainda em PREVISÃO — títulos ${
        direction === "IN" ? "a receber" : "a pagar"
      } que vencem hoje e ainda não foram baixados. A confirmação acontece no dia seguinte; a partir de amanhã esta linha mostra só o que foi realmente ${
        direction === "IN" ? "recebido" : "pago"
      }.`}
      data-testid="caixa-timeline-forecast-portion"
    >
      prev.
    </span>
  );
}

type TimelineNoteTone = "info" | "warning" | "adjustment";

function stopRowToggle(e: React.MouseEvent | React.KeyboardEvent) {
  e.stopPropagation();
}

/**
 * Ícone discreto ao lado do valor. O detalhe de auditoria vive no painel
 * (hover/foco/click) — sempre no DOM, sem JS de abrir/fechar, para SSR,
 * leitor de tela e os testes de markup.
 */
function TimelineNote({
  testId,
  tone,
  label,
  heading,
  children,
}: {
  testId: string;
  tone: TimelineNoteTone;
  label: string;
  heading: string;
  children: React.ReactNode;
}) {
  const panelId = useId();
  const Icon =
    tone === "warning" ? TriangleAlert : tone === "adjustment" ? PencilLine : Info;
  return (
    <span
      className="caixa-timeline-note"
      data-testid={testId}
      onClick={stopRowToggle}
      onKeyDown={stopRowToggle}
    >
      <button
        type="button"
        className={cn(
          "caixa-timeline-note-trigger",
          tone === "warning" && "text-[#B91C1C]",
          tone === "adjustment" && "text-[#B45309]",
          tone === "info" && "text-[#2563EB]"
        )}
        aria-label={label}
        title={label}
        aria-describedby={panelId}
      >
        <Icon className="h-3 w-3" aria-hidden />
      </button>
      <span
        id={panelId}
        role="tooltip"
        className="caixa-timeline-note-panel"
        data-testid={`${testId}-panel`}
      >
        <span className="caixa-timeline-note-title">{heading}</span>
        {children}
      </span>
    </span>
  );
}

function coverageLabel(
  coverage: NonNullable<TreasuryCaixaTimelineRow["closingCoverage"]>
): string {
  return `${coverage.accountsCovered} de ${coverage.accountsExpected}`;
}

/**
 * Cobertura de FECHAMENTO parcial (algumas contas do consolidado informaram
 * o saldo do dia, outras não) — avisa que o subtotal parcial NUNCA vira
 * saldo consolidado (missão 03/09/2026, `treasuryDailyBalanceAuthority.ts`).
 * Só renderiza quando há contas esperadas e a cobertura está incompleta.
 */
function ClosingCoveragePartialMark({
  coverage,
}: {
  coverage: NonNullable<TreasuryCaixaTimelineRow["closingCoverage"]>;
}) {
  const pendingNames = coverage.pendingAccounts
    .map((a) => a.accountName)
    .join(", ");
  const label = `Fechamento incompleto: ${coverage.accountsCovered}/${coverage.accountsExpected} contas`;
  return (
    <TimelineNote
      testId="caixa-timeline-coverage-partial"
      tone="warning"
      label={label}
      heading="Fechamento incompleto"
    >
      <span className="block">
        Fechamento incompleto: {coverageLabel(coverage)} contas informaram
        saldo.
      </span>
      <span className="block">
        O subtotal não foi usado para ancorar o caixa consolidado.
      </span>
      {pendingNames ? (
        <span className="block">Pendente: {pendingNames}.</span>
      ) : null}
      {coverage.partialSum != null ? (
        <span className="block">
          Subtotal informado (não usado): {money(coverage.partialSum)}.
        </span>
      ) : null}
    </TimelineNote>
  );
}

/**
 * Fechamento MANUAL com cobertura COMPLETA (todas as contas esperadas
 * informaram o saldo manualmente) — distingue de fechamento formal/calculado.
 */
function ClosingManualMark({
  coverage,
}: {
  coverage: NonNullable<TreasuryCaixaTimelineRow["closingCoverage"]>;
}) {
  return (
    <TimelineNote
      testId="caixa-timeline-closing-manual"
      tone="info"
      label={`Saldo informado manualmente. Cobertura: ${coverage.accountsCovered}/${coverage.accountsExpected}`}
      heading="Manual"
    >
      <span className="block">Saldo informado manualmente.</span>
      <span className="block">
        Cobertura: {coverageLabel(coverage)} contas.
      </span>
    </TimelineNote>
  );
}

/** Abertura MANUAL (proveniência declarada — distingue de "segue o fechamento anterior"). */
function OpeningManualMark({
  coverage,
}: {
  coverage?: TreasuryCaixaTimelineRow["openingCoverage"];
}) {
  return (
    <TimelineNote
      testId="caixa-timeline-opening-manual"
      tone="info"
      label={
        coverage && coverage.accountsExpected > 0
          ? `Saldo informado manualmente. Cobertura: ${coverage.accountsCovered}/${coverage.accountsExpected}`
          : "Saldo informado manualmente"
      }
      heading="Manual"
    >
      <span className="block">Saldo informado manualmente.</span>
      {coverage && coverage.accountsExpected > 0 ? (
        <span className="block">
          Cobertura: {coverageLabel(coverage)} contas.
        </span>
      ) : null}
    </TimelineNote>
  );
}

/**
 * Ajuste de abertura: diferença entre a abertura manual completa do dia e o
 * fechamento efetivo do dia anterior — nunca escondida (missão 03/09/2026).
 */
function OpeningAdjustmentMark({ amount }: { amount: number }) {
  return (
    <TimelineNote
      testId="caixa-timeline-opening-adjustment"
      tone="adjustment"
      label={`Ajuste de abertura: ${money(amount)}`}
      heading="Ajuste de abertura"
    >
      <span className="block">
        Abertura manual ajustou a continuidade em {money(amount)}.
      </span>
    </TimelineNote>
  );
}

/**
 * Linha de HOJE cujo fechamento realizado (sem a previsão do próprio dia)
 * difere do calculado (com previsão) — o detalhe fica no ícone, porque a
 * célula "Terminou" mostra o fechamento previsto da linha.
 */
function TodayRealizedMark({
  closingRealized,
  closingCalculated,
}: {
  closingRealized: number;
  closingCalculated: number | null;
}) {
  return (
    <TimelineNote
      testId="caixa-timeline-today-realized"
      tone="info"
      label={`Saldo realizado agora: ${money(closingRealized)}`}
      heading="Realizado agora"
    >
      <span className="block">
        Saldo realizado agora: {money(closingRealized)}.
      </span>
      {closingCalculated != null ? (
        <span className="block">
          Fechamento previsto: {money(closingCalculated)}.
        </span>
      ) : null}
    </TimelineNote>
  );
}

/**
 * Célula de saldo com cor por sinal (positivo → verde; negativo → vermelho;
 * zero/null → neutro). Usada em "Começou" e "Terminou" — dá leitura visual
 * imediata do sinal do saldo, mantendo tabular-nums e alinhamento à direita.
 *
 * O parâmetro `boldWhenNegative` reproduz o comportamento anterior das
 * células "Terminou" (que já eram bold + vermelho ao ficar negativas via
 * flag `row.negative` do domínio); passe `false` para "Começou" (peso normal).
 */
function BalanceCell({
  value,
  boldWhenNegative = true,
  emphasized = false,
  marks,
}: {
  value: number | null;
  boldWhenNegative?: boolean;
  /** "Terminou" — peso semibold mesmo quando positivo. */
  emphasized?: boolean;
  /** Ícones de auditoria (proveniência/cobertura) — só linhas de dia. */
  marks?: React.ReactNode;
}) {
  const isPositive = value != null && value > 0;
  const isNegative = value != null && value < 0;
  return (
    <td
      className={cn(
        "px-2 py-1.5 text-right tabular-nums whitespace-nowrap",
        isPositive && "text-[#059669]",
        isNegative && "text-[#DC2626]",
        (emphasized || (isNegative && boldWhenNegative)) && "font-semibold",
        !isNegative && !isPositive && "text-foreground"
      )}
    >
      <span className="inline-flex items-center justify-end gap-1">
        {money(value)}
        {marks}
      </span>
    </td>
  );
}

/**
 * Marcadores de proveniência da ABERTURA de uma linha de dia — abertura
 * manual e/ou ajuste em relação ao fechamento efetivo anterior. `null` quando
 * a linha não tem nada a sinalizar (comportamento padrão, sem regressão).
 */
function RowOpeningMarks({ row }: { row: TreasuryCaixaTimelineRow }) {
  const showManual = row.openingSource === "MANUAL_OPENING";
  const showAdjustment = row.openingAdjustment != null && row.openingAdjustment !== 0;
  if (!showManual && !showAdjustment) return null;
  return (
    <>
      {showManual ? <OpeningManualMark coverage={row.openingCoverage} /> : null}
      {showAdjustment ? <OpeningAdjustmentMark amount={row.openingAdjustment as number} /> : null}
    </>
  );
}

/**
 * Marcadores de proveniência/cobertura do FECHAMENTO de uma linha de dia —
 * cobertura parcial (subtotal não usado), fechamento manual completo e/ou
 * HOJE com realizado diferente do calculado. `null` quando não há nada a
 * sinalizar.
 */
function RowClosingMarks({ row }: { row: TreasuryCaixaTimelineRow }) {
  const coverage = row.closingCoverage;
  const showPartial = coverage != null && coverage.accountsExpected > 0 && !coverage.complete;
  const showManual =
    row.closingSource === "MANUAL_CLOSING" && coverage != null && coverage.complete === true;
  const showTodayRealized =
    row.kind === "TODAY" &&
    row.closingRealized != null &&
    row.closingRealized !== row.closingCalculated;
  if (!showPartial && !showManual && !showTodayRealized) return null;
  return (
    <>
      {showPartial ? <ClosingCoveragePartialMark coverage={coverage!} /> : null}
      {showManual ? <ClosingManualMark coverage={coverage!} /> : null}
      {showTodayRealized ? (
        <TodayRealizedMark
          closingRealized={row.closingRealized as number}
          closingCalculated={row.closingCalculated}
        />
      ) : null}
    </>
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

/**
 * @deprecated Só usado pelo fallback quando `canonicalDays` estiver ausente.
 * O caminho canônico (Fase B) não distingue realizado vs previsto no drill-down:
 * o motor único-de-dia já entrega as QUATRO dimensões separadas por dia.
 * Remoção acompanha a saída do fallback (Fase D — quando cutover no board estiver
 * estável em produção).
 */
function isRealizedDayKind(kind: TreasuryCaixaTimelineRow["kind"]): boolean {
  return kind === "REALIZED" || kind === "TODAY";
}

/**
 * @deprecated Fallback do drill-down quando `canonicalDays` estiver ausente.
 * A fonte canônica agora é `TreasuryCaixaCanonicalDay.receivableDueTitles`
 * (vencendo hoje em aberto) e `receivableReceivedTitles` (baixados hoje),
 * já entregues pelo backend com os totais que fecham no centavo.
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

/**
 * @deprecated Fallback do drill-down; a fonte canônica é
 * `TreasuryCaixaCanonicalDay.payableDueTitles` / `payablePaidTitles`.
 */
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

/** Rótulo/tom pt-BR para o status calculado do título (open/overdue/dueToday/upcoming/settled/suspended). */
const TITLE_STATUS_META: Record<string, { label: string; className: string }> = {
  open: { label: "Em aberto", className: "bg-slate-100 text-slate-700" },
  overdue: { label: "Vencido", className: "bg-red-100 text-red-800" },
  dueToday: { label: "Vence hoje", className: "bg-amber-100 text-amber-800" },
  upcoming: { label: "A vencer", className: "bg-sky-100 text-sky-800" },
  settled: { label: "Liquidado", className: "bg-emerald-100 text-emerald-800" },
  suspended: { label: "Suspenso", className: "bg-zinc-200 text-zinc-700" },
};

export function TitleStatusBadge({ status }: { status: string }) {
  const meta = TITLE_STATUS_META[status] ?? {
    label: status,
    className: "bg-slate-100 text-slate-700",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

type DayDrilldownRow = {
  id: string | number;
  name: string | null;
  status: string;
  dueDate: string | null;
  /** Contribuição do título ao Entrou/Saiu do dia (baixa se realizado, saldo se previsto). */
  amount: number;
  /** "Valor" — valor original do título (bruto, igual ao grid de baixo). */
  grossAmount: number;
  /** "Pago"/"Recebido" — quanto já foi liquidado deste título. */
  settledAmount: number;
  /** "Saldo" — quanto ainda falta. */
  balanceAmount: number;
};

/**
 * Card de um lado do drill-down (Receber ou Pagar) — cabeçalho clicável
 * (colapsa/expande só esta seção), tom suave (verde/vermelho) e lista de
 * títulos com as mesmas colunas do grid "Contas a Receber/Pagar" abaixo
 * (Vencimento, Fornecedor/Cliente, Status, Valor, Pago/Recebido, Saldo).
 */
function DayDrilldownCard({
  title,
  counterpartyLabel,
  settledLabel,
  rows,
  tone,
  defaultOpen = true,
}: {
  title: string;
  counterpartyLabel: string;
  settledLabel: string;
  rows: DayDrilldownRow[];
  tone: "in" | "out";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const isIn = tone === "in";
  const Icon = isIn ? ArrowDownCircle : ArrowUpCircle;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border",
        isIn ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
        data-testid={`caixa-timeline-drilldown-toggle-${isIn ? "receber" : "pagar"}`}
      >
        <Icon
          className={cn("h-4 w-4 shrink-0", isIn ? "text-emerald-600" : "text-red-500")}
          aria-hidden
        />
        <span
          className={cn(
            "text-xs font-bold uppercase tracking-wide",
            isIn ? "text-emerald-800" : "text-red-800"
          )}
        >
          {title}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground">
          ({rows.length})
        </span>
        <span
          className={cn(
            "ml-auto text-sm font-semibold tabular-nums",
            isIn ? "text-emerald-700" : "text-red-700"
          )}
        >
          {money(total)}
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        )}
      </button>
      {open ? (
        <div className="border-t border-black/5 bg-background/70 px-3 py-2">
          {rows.length === 0 ? (
            <p className="py-1 text-[11px] text-muted-foreground">
              Nenhum título neste dia.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-[11px]">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-semibold">Vencimento</th>
                    <th className="py-1 pr-2 font-semibold">{counterpartyLabel}</th>
                    <th className="py-1 pr-2 font-semibold">Status</th>
                    <th className="py-1 pr-2 text-right font-semibold">Valor</th>
                    <th className="py-1 pr-2 text-right font-semibold">{settledLabel}</th>
                    <th className="py-1 text-right font-semibold">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-border/30 last:border-0">
                      <td className="whitespace-nowrap py-1.5 pr-2 tabular-nums">
                        {row.dueDate ? formatCivilDate(row.dueDate) : "—"}
                      </td>
                      <td className="max-w-[220px] truncate py-1.5 pr-2">{row.name ?? "—"}</td>
                      <td className="py-1.5 pr-2">
                        <TitleStatusBadge status={row.status} />
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {money(row.grossAmount)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">
                        {money(row.settledAmount)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap py-1.5 text-right font-medium tabular-nums",
                          isIn ? "text-emerald-700" : "text-red-700"
                        )}
                      >
                        {money(row.balanceAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Drill-down inline canônico de um dia — QUATRO dimensões vindas do backend
 * (`canonicalDays`), cada uma com os títulos que fecham o seu total:
 *   A pagar / Pago / A receber / Recebido.
 * O frontend não filtra por data nem escolhe realizado/previsto — o motor
 * único-de-dia já entregou tudo separado.
 *
 * Fallback: quando `canonicalDay` estiver ausente (board antigo ou dia fora
 * da janela canônica), volta ao filtro em memória por `dueDate`/`settlementDate`
 * usando as grids — mesmo comportamento anterior, sem regredir o que já
 * funcionava.
 */
function DayDrilldown({
  civilDate,
  colSpan,
  canonicalDay,
  receivables,
  payables,
  realized,
}: {
  civilDate: string;
  colSpan: number;
  canonicalDay: TreasuryCaixaCanonicalDay | null;
  receivables: readonly FinanceAccountsReceivableGridRow[];
  payables: readonly FinanceAccountsPayableGridRow[];
  realized: boolean;
}) {
  // ── Caminho canônico (Fase B) ──────────────────────────────────────────
  if (canonicalDay) {
    const payableDueRows: DayDrilldownRow[] = canonicalDay.payableDueTitles.map(
      (p) => ({
        id: p.externalId,
        name: p.personName,
        status: p.calculatedStatus,
        dueDate: p.dueDate,
        amount: p.balancePayable,
        grossAmount: p.amountPayable,
        settledAmount: p.amountPaid,
        balanceAmount: p.balancePayable,
      })
    );
    const payablePaidRows: DayDrilldownRow[] =
      canonicalDay.payablePaidTitles.map((p) => ({
        id: p.externalId,
        name: p.personName,
        status: p.calculatedStatus,
        dueDate: p.dueDate,
        amount: p.amountPaid,
        grossAmount: p.amountPayable,
        settledAmount: p.amountPaid,
        balanceAmount: p.balancePayable,
      }));
    const receivableDueRows: DayDrilldownRow[] =
      canonicalDay.receivableDueTitles.map((r) => ({
        id: r.externalId,
        name: r.personName,
        status: r.calculatedStatus,
        dueDate: r.dueDate,
        amount: r.balanceReceivable,
        grossAmount: r.amountReceivable,
        settledAmount: r.amountReceived,
        balanceAmount: r.balanceReceivable,
      }));
    const receivableReceivedRows: DayDrilldownRow[] =
      canonicalDay.receivableReceivedTitles.map((r) => ({
        id: r.externalId,
        name: r.personName,
        status: r.calculatedStatus,
        dueDate: r.dueDate,
        amount: r.amountReceived,
        grossAmount: r.amountReceivable,
        settledAmount: r.amountReceived,
        balanceAmount: r.balanceReceivable,
      }));

    const allEmpty =
      payableDueRows.length === 0 &&
      payablePaidRows.length === 0 &&
      receivableDueRows.length === 0 &&
      receivableReceivedRows.length === 0;

    return (
      <tr
        className="border-b border-border/30 bg-background"
        data-testid={`caixa-timeline-day-drilldown-${civilDate}`}
        data-source="canonical"
      >
        <td colSpan={colSpan} className="px-2 py-2.5 pl-7">
          {allEmpty ? (
            <p className="text-[11px] text-muted-foreground">
              Nenhum título de CR/CP explica o movimento deste dia — pode ser
              lançamento manual, transferência ou saldo informado diretamente.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              <DayDrilldownCard
                title="A pagar (vencendo hoje, em aberto)"
                counterpartyLabel="Fornecedor"
                settledLabel="Pago"
                tone="out"
                rows={payableDueRows}
              />
              <DayDrilldownCard
                title="Pago hoje (baixados)"
                counterpartyLabel="Fornecedor"
                settledLabel="Pago"
                tone="out"
                rows={payablePaidRows}
              />
              <DayDrilldownCard
                title="A receber (vencendo hoje, em aberto)"
                counterpartyLabel="Cliente"
                settledLabel="Recebido"
                tone="in"
                rows={receivableDueRows}
              />
              <DayDrilldownCard
                title="Recebido hoje (baixados)"
                counterpartyLabel="Cliente"
                settledLabel="Recebido"
                tone="in"
                rows={receivableReceivedRows}
              />
            </div>
          )}
        </td>
      </tr>
    );
  }

  // ── Fallback (compatibilidade retroativa) ──────────────────────────────
  const dayReceivables = filterCaixaDayReceivables(receivables, civilDate, realized);
  const dayPayables = filterCaixaDayPayables(payables, civilDate, realized);

  const payableRows: DayDrilldownRow[] = dayPayables.map((p) => ({
    id: p.externalId,
    name: p.personName,
    status: p.calculatedStatus,
    dueDate: p.dueDate,
    amount: realized ? p.amountPaid : p.balancePayable,
    grossAmount: p.amountPayable,
    settledAmount: p.amountPaid,
    balanceAmount: p.balancePayable,
  }));
  const receivableRows: DayDrilldownRow[] = dayReceivables.map((r) => ({
    id: r.externalId,
    name: r.personName,
    status: r.calculatedStatus,
    dueDate: r.dueDate,
    amount: realized ? r.amountReceived : r.balanceReceivable,
    grossAmount: r.amountReceivable,
    settledAmount: r.amountReceived,
    balanceAmount: r.balanceReceivable,
  }));

  return (
    <tr
      className="border-b border-border/30 bg-background"
      data-testid={`caixa-timeline-day-drilldown-${civilDate}`}
      data-source="fallback"
    >
      <td colSpan={colSpan} className="px-2 py-2.5 pl-7">
        {receivableRows.length === 0 && payableRows.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            Nenhum título de CR/CP explica o movimento deste dia — pode ser
            lançamento manual, transferência ou saldo informado diretamente.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            <DayDrilldownCard
              title="Contas a Pagar"
              counterpartyLabel="Fornecedor"
              settledLabel="Pago"
              tone="out"
              rows={payableRows}
            />
            <DayDrilldownCard
              title="Contas a Receber"
              counterpartyLabel="Cliente"
              settledLabel="Recebido"
              tone="in"
              rows={receivableRows}
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
  monthlyDueEstimates = [],
  receivables = [],
  payables = [],
  canonicalDays = [],
  historicalArMonthlyInflowDeltaByMonth,
}: TreasuryCaixaTimelineProps) {
  const canonicalByDay = useMemo(() => {
    const map = new Map<string, TreasuryCaixaCanonicalDay>();
    for (const d of canonicalDays) map.set(d.civilDate, d);
    return map;
  }, [canonicalDays]);
  const months = useMemo(() => {
    if (!timeline) return [];
    const fromDays = buildTreasuryCaixaMonthlyTimeline(timeline.rows, {
      historicalArMonthlyInflowDeltaByMonth,
    });
    return appendTreasuryCaixaMonthlyDueEstimates(fromDays, monthlyDueEstimates);
  }, [timeline, monthlyDueEstimates, historicalArMonthlyInflowDeltaByMonth]);
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

      {loading ? (
        <p className="py-3 text-xs text-muted-foreground">Carregando…</p>
      ) : !timeline || timeline.rows.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground">
          Sem dias no período selecionado.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="caixa-timeline-table w-full text-xs" data-testid="caixa-timeline-table">
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
                            <BalanceCell value={m.opening} boldWhenNegative={false} />
                            <td className="px-2 py-1.5 text-right tabular-nums text-[#059669]">
                              {m.inflows === 0 ? "—" : money(m.inflows)}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-[#DC2626]">
                              {m.outflows === 0 ? "—" : money(m.outflows)}
                            </td>
                            <td
                              className={cn(
                                "px-2 py-1.5 text-right tabular-nums font-semibold",
                                m.closing != null && m.closing > 0 && "text-[#059669]",
                                m.closing != null && m.closing < 0 && "text-[#DC2626]"
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
                                      <BalanceCell
                                        value={r.opening}
                                        boldWhenNegative={false}
                                        marks={<RowOpeningMarks row={r} />}
                                      />
                                      <td className="px-2 py-1.5 text-right tabular-nums text-[#059669]">
                                        {r.inflows === 0 ? "—" : money(r.inflows)}
                                        {outliers.has(`${r.civilDate}|inflows`) ? (
                                          <OutlierMark
                                            direction={
                                              outliers.get(`${r.civilDate}|inflows`)!
                                            }
                                          />
                                        ) : null}
                                        {r.forecastInflows != null ? (
                                          <ForecastPortionMark
                                            amount={r.forecastInflows}
                                            direction="IN"
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
                                        {r.forecastOutflows != null ? (
                                          <ForecastPortionMark
                                            amount={r.forecastOutflows}
                                            direction="OUT"
                                          />
                                        ) : null}
                                      </td>
                                      <BalanceCell
                                        value={r.closing}
                                        emphasized
                                        marks={<RowClosingMarks row={r} />}
                                      />
                                      <DivergenceCell
                                        value={r.divergence}
                                        informed={r.closingInformed}
                                        scope="day"
                                        divergenceBaseline={r.divergenceBaseline}
                                      />
                                    </tr>
                                    {dayOpen ? (
                                      <DayDrilldown
                                        civilDate={r.civilDate}
                                        colSpan={7}
                                        canonicalDay={
                                          canonicalByDay.get(r.civilDate) ?? null
                                        }
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
                            <BalanceCell
                              value={r.opening}
                              boldWhenNegative={false}
                              marks={<RowOpeningMarks row={r} />}
                            />
                            <td className="px-2 py-1.5 text-right tabular-nums text-[#059669]">
                              {r.inflows === 0 ? "—" : money(r.inflows)}
                              {outliers.has(`${r.civilDate}|inflows`) ? (
                                <OutlierMark
                                  direction={outliers.get(`${r.civilDate}|inflows`)!}
                                />
                              ) : null}
                              {r.forecastInflows != null ? (
                                <ForecastPortionMark
                                  amount={r.forecastInflows}
                                  direction="IN"
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
                              {r.forecastOutflows != null ? (
                                <ForecastPortionMark
                                  amount={r.forecastOutflows}
                                  direction="OUT"
                                />
                              ) : null}
                            </td>
                            <BalanceCell
                              value={r.closing}
                              emphasized
                              marks={<RowClosingMarks row={r} />}
                            />
                            <DivergenceCell
                              value={r.divergence}
                              informed={r.closingInformed}
                              divergenceBaseline={r.divergenceBaseline}
                              scope="day"
                            />
                          </tr>
                          {dayOpen ? (
                            <DayDrilldown
                              civilDate={r.civilDate}
                              colSpan={7}
                              canonicalDay={
                                canonicalByDay.get(r.civilDate) ?? null
                              }
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

          {/*
           * Legenda longa consolidada em um menu cascata (<details>) — a
           * tela fica limpa; quem quiser entender clica pra ler. Semântico
           * puro (sem JS extra) e acessível.
           */}
          <details
            className="mt-2 rounded-md border border-dashed border-border/60 bg-muted/20 text-[11px] text-muted-foreground"
            data-testid="caixa-timeline-legend"
          >
            <summary className="cursor-pointer select-none px-2.5 py-1.5 font-semibold text-foreground/80 hover:text-foreground">
              Como ler esta tabela (regras, cores, ✓/—/▲▼)
            </summary>
            <div className="space-y-2 border-t border-border/60 px-2.5 py-2 leading-snug">
              <p>
                Dias passados mostram o que foi <strong>realmente</strong> pago
                e recebido. Dias futuros mostram <strong>previsão</strong> pelos
                títulos em aberto — esses ainda podem mudar. O dia de{" "}
                <strong>hoje</strong> soma os dois: o que já foi baixado{" "}
                <em>mais</em> os títulos que vencem hoje e ainda não foram
                confirmados (marcados com <strong>prev.</strong>) — a
                confirmação da baixa acontece no dia seguinte, e a partir de
                amanhã a linha passa a mostrar só o realizado.
                {mode === "month" ? " Clique num mês para ver os dias." : ""}{" "}
                Clique num dia para ver os títulos de Contas a Receber/Pagar por
                trás do Entrou/Saiu daquele dia.
              </p>
              {months.some((m) => m.estimateOnly) ||
              timeline.rows.some((r) => r.estimated) ? (
                <p data-testid="caixa-timeline-estimate-legend">
                  <strong>Estimativa</strong> = futuro sem projeção
                  materializada, estimado <strong>dia a dia</strong> pelos
                  títulos em aberto que vencem em cada dia (mesma regra da
                  &quot;Linha do tempo mensal&quot; do Fluxo de Caixa). Cada dia
                  abre no fechamento do dia anterior — a âncora é o{" "}
                  <strong>último caixa conhecido</strong>: informar o saldo de
                  hoje recalcula toda a cadeia futura. É estimativa — títulos
                  ainda podem mudar de data e valor.
                </p>
              ) : null}
              <p>
                <strong>&quot;Começou&quot; e &quot;Terminou&quot;</strong>{" "}
                aparecem em <span className="text-[#059669]">verde</span> quando
                positivos e <span className="text-[#DC2626]">vermelho</span>{" "}
                quando negativos. Nos dias passados são{" "}
                <strong>calculados</strong>: partem de R$ 0,00 em 01/01/2026 e
                acumulam entrada/saída dia a dia. Quando existe fechamento do
                dia, o <strong>saldo informado no extrato vale</strong> — o dia
                fecha nele e o dia seguinte começa nele.
              </p>
              <p>
                <strong>Divergência</strong> é o saldo informado menos o
                calculado pelos títulos: é o dinheiro que andou sem título por
                trás. <span className="text-[#0369A1]">Azul</span> = entrou a
                mais que o esperado;{" "}
                <span className="text-[#B45309]">âmbar</span> = saiu a mais.{" "}
                <span className="text-[#059669]">✓</span> = bate exatamente.{" "}
                <strong>&quot;—&quot;</strong> = ninguém informou saldo naquele
                dia, então não há o que comparar.
              </p>
              {outlierCount > 0 ? (
                <p data-testid="caixa-timeline-outlier-legend">
                  <span className="font-bold text-[#B45309]">▲▼</span> marcam{" "}
                  <strong>
                    {outlierCount} valor{outlierCount === 1 ? "" : "es"} fora do
                    padrão
                  </strong>{" "}
                  do período — muito acima ou muito abaixo do dia típico. Não é
                  erro: é um convite a conferir (pode ser um pagamento grande
                  legítimo ou um lançamento errado).
                </p>
              ) : null}
              <p>
                Entrou/Saiu dos dias passados seguem{" "}
                <strong>as mesmas regras</strong> da &quot;Linha do tempo
                mensal&quot; do Fluxo de Caixa (os totais do mês batem 1:1 com
                aquela tela): contas a receber entram no dia da{" "}
                <strong>baixa</strong> — recebimento adiantado ou atrasado
                aparece no dia em que o dinheiro andou; contas a pagar valem
                pelo <strong>vencimento</strong> (regra canônica — o Nomus
                raramente informa a data real do pagamento). Títulos previstos
                para hoje só entram quando forem de fato baixados; o saldo
                informado das contas é sempre a referência, e o futuro parte
                dele.
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
