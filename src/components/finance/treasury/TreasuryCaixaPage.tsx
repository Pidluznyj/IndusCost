/**
 * Página — Caixa (Tesouraria).
 * Filtro Ano/(Mês)/(Dia) por vencimento → duas tabelas planas (CR e CP),
 * sem agrupar por banco, via motor oficial (financeAccountsReceivable/PayableRulesEngine).
 * Contas + lançamento de saldo reutilizam o painel/modal canônicos do Fluxo Gerencial
 * (APIs /today/opening e /today/closing, com log de usuário, data/hora e motivo).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchTreasuryCaixa, type TreasuryCaixaPayload } from "@/src/lib/treasury/treasuryCaixaApi.js";
import { formatCivilDate } from "@/src/lib/financeCivilDate.js";
import { fetchTreasuryAccounts } from "@/src/lib/treasury/treasuryAccountsApi.js";
import { fetchTreasuryAccountLatestBalance } from "@/src/lib/treasury/treasuryBalancesApi.js";
import {
  mapTreasuryAccountToPredictiveAccount,
  type PredictiveCashFlowAccount,
} from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { fetchTreasuryTodayClosing } from "@/src/lib/treasury/treasuryTodayClosingApi.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import { fetchTreasuryAgenda } from "@/src/lib/treasury/treasuryAgendaApi.js";
import type { TreasuryAgendaDayDto } from "@/src/lib/treasury/contracts/index.js";
import {
  appendTreasuryCaixaDailyDueEstimates,
  buildTreasuryCaixaDayFlow,
  buildTreasuryCaixaMonthlyBalanceChart,
  buildTreasuryCaixaMonthlyTimeline,
  buildTreasuryCaixaUnifiedTimeline,
  type TreasuryCaixaDayFlow,
  type TreasuryCaixaTimeline as TreasuryCaixaTimelineData,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { treasuryMoneyToNumber } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { TreasuryCaixaAccountsSummary } from "@/src/components/finance/treasury/TreasuryCaixaAccountsSummary";
import { TreasuryCaixaTodayFlow } from "@/src/components/finance/treasury/TreasuryCaixaTodayFlow";
import { TreasuryCaixaOverdueStrip } from "@/src/components/finance/treasury/TreasuryCaixaOverdueStrip";
import {
  TreasuryCaixaTimeline,
  TitleStatusBadge,
} from "@/src/components/finance/treasury/TreasuryCaixaTimeline";
import { TreasuryCaixaBalanceChart } from "@/src/components/finance/treasury/TreasuryCaixaBalanceChart";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { cn } from "@/src/lib/utils";

const MONTH_OPTIONS = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
] as const;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/**
 * Passado (do board, por data de liquidação) + hoje (fechamento do dia) +
 * futuro (agenda). Passar `agendaDays` vazio produz a linha do tempo só com o
 * que é fato — é o caminho usado quando não há projeção materializada.
 */
function buildTimelineFromSources(
  board: TreasuryCaixaPayload,
  todayFlow: TreasuryCaixaDayFlow | null,
  agendaDays: readonly TreasuryAgendaDayDto[]
): TreasuryCaixaTimelineData {
  return buildTreasuryCaixaUnifiedTimeline({
    todayCivilDate: todayTreasuryCivilDateInSaoPaulo(),
    realizedDays: board.realizedDays ?? [],
    todayFlow,
    // `inflows`/`outflows` = cenário pedido; são os que movem o closingBalance.
    // Os buckets `planned*` não servem: plannedOutflows só vem do contratual e
    // fica zerado quando se pede PROBABLE, deixando a coluna "Saiu" vazia.
    forecastDays: agendaDays.map((d) => ({
      civilDate: d.civilDate,
      openingBalance: treasuryMoneyToNumber(d.openingBalance),
      inflows: treasuryMoneyToNumber(d.inflows),
      outflows: treasuryMoneyToNumber(d.outflows),
      closingBalance:
        d.closingBalance == null
          ? null
          : treasuryMoneyToNumber(d.closingBalance),
    })),
  });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

function TotalizerCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "receivable" | "payable" | "net" | "neutral";
}) {
  const toneClass =
    tone === "receivable"
      ? "border-[#A7F3D0] text-[#065F46]"
      : tone === "payable"
        ? "border-[#FECACA] text-[#991B1B]"
        : tone === "net"
          ? "border-[#BFDBFE] text-[#1E3A8A]"
          : "border-border text-foreground";
  return (
    <div
      className={cn(
        "rounded-lg border bg-card px-3 py-2.5 shadow-sm",
        toneClass
      )}
      data-testid={`caixa-card-${label}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-extrabold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

export function TreasuryCaixaPage() {
  const auth = useAuth();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState<number | "">("");
  const [day, setDay] = useState<number | "">("");
  const [data, setData] = useState<TreasuryCaixaPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<PredictiveCashFlowAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [todayFlow, setTodayFlow] = useState<TreasuryCaixaDayFlow | null>(null);
  const [agendaDays, setAgendaDays] = useState<readonly TreasuryAgendaDayDto[]>(
    []
  );
  // Menu cascata: listas de títulos começam fechadas — a tela fica compacta e
  // quem quiser o detalhe abre por conta própria (mesmo padrão do Atrasados).
  const [receivablesOpen, setReceivablesOpen] = useState(false);
  const [payablesOpen, setPayablesOpen] = useState(false);
  const accountsAbortRef = useRef<AbortController | null>(null);

  /** Passo 1 — contas cadastradas + saldo mais recente de cada uma. */
  const loadAccounts = useCallback(async () => {
    accountsAbortRef.current?.abort();
    const controller = new AbortController();
    accountsAbortRef.current = controller;
    setAccountsLoading(true);
    try {
      const page = await fetchTreasuryAccounts({
        page: 1,
        pageSize: 200,
        isActive: true,
        sortBy: "sortOrder",
        sortDirection: "asc",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const rows = page?.rows ?? [];
      const withBalances = await Promise.all(
        rows.map(async (account) => {
          try {
            const snap = await fetchTreasuryAccountLatestBalance(
              account.id,
              controller.signal
            );
            return mapTreasuryAccountToPredictiveAccount(
              account,
              snap?.availableBalance ?? "0.00"
            );
          } catch {
            return mapTreasuryAccountToPredictiveAccount(account, "0.00");
          }
        })
      );
      if (controller.signal.aborted) return;
      setAccounts(withBalances);

      // Passo 3 — movimento de hoje: os 4 números já vêm calculados por conta
      // no workspace canônico de fechamento; aqui só consolidamos.
      const civilDate = todayTreasuryCivilDateInSaoPaulo();
      const closing = await fetchTreasuryTodayClosing({
        date: civilDate,
        signal: controller.signal,
      }).catch(() => null);
      if (controller.signal.aborted) return;
      setTodayFlow(
        closing
          ? buildTreasuryCaixaDayFlow({
              civilDate,
              accounts: closing.accounts
                .filter((a) => a.situation !== "INACTIVE")
                .map((a) => ({
                  openingBalance:
                    a.openingBalance == null
                      ? null
                      : treasuryMoneyToNumber(a.openingBalance),
                  realizedInflows: treasuryMoneyToNumber(a.realizedInflows),
                  realizedOutflows: treasuryMoneyToNumber(a.realizedOutflows),
                  realizedClosingBalance:
                    a.realizedClosingBalance == null
                      ? null
                      : treasuryMoneyToNumber(a.realizedClosingBalance),
                  informedClosingBalance:
                    a.informedClosingBalance == null
                      ? null
                      : treasuryMoneyToNumber(a.informedClosingBalance),
                })),
              predictedInflows:
                closing.predictedTodayInflows == null
                  ? null
                  : treasuryMoneyToNumber(closing.predictedTodayInflows),
              predictedOutflows:
                closing.predictedTodayOutflows == null
                  ? null
                  : treasuryMoneyToNumber(closing.predictedTodayOutflows),
            })
          : null
      );
    } catch {
      if (!controller.signal.aborted) {
        setAccounts([]);
        setTodayFlow(null);
      }
    } finally {
      if (!controller.signal.aborted) setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    return () => accountsAbortRef.current?.abort();
  }, [loadAccounts]);

  const yearOptions = useMemo(() => {
    const base = today.getFullYear();
    const out: number[] = [];
    for (let y = base - 3; y <= base + 3; y += 1) out.push(y);
    return out;
  }, [today]);

  const dayOptions = useMemo(() => {
    if (month === "") return [];
    const max = daysInMonth(year, month);
    return Array.from({ length: max }, (_, i) => i + 1);
  }, [year, month]);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchTreasuryCaixa({
        year,
        month: month === "" ? undefined : month,
        day: day === "" ? undefined : day,
      });
      setData(payload);

      // Passo 4 — linha do tempo do mesmo período, pela agenda canônica quando
      // existir (fica só como sinal de fundo — sem botão/aviso na tela; sem
      // cobertura, `data.dailyDueEstimates` já preenche o futuro por vencimento).
      // A agenda exige empresa; sem companyCode configurado ela não carrega.
      const companyCode = accounts
        .map((a) => a.companyCode?.trim())
        .find((c) => c);
      if (!companyCode) {
        setAgendaDays([]);
      } else {
        try {
          const agenda = await fetchTreasuryAgenda({
            companyCode,
            baseDate: payload.dueDateFrom,
            endDate: payload.dueDateTo,
            scenario: "PROBABLE",
            accountIds: null,
            consolidated: true,
            includeDayDetail: false,
          });
          setAgendaDays(agenda.days ?? []);
        } catch {
          // Falhou a projeção; passado e hoje continuam válidos, e o futuro
          // cai no fallback por vencimento (dailyDueEstimates).
          setAgendaDays([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar o caixa.");
      setData(null);
      setAgendaDays([]);
    } finally {
      setLoading(false);
    }
  }, [year, month, day, accounts]);

  // A linha do tempo é DERIVADA das três fontes. Montá-la aqui (e não dentro de
  // `search`) garante que ela reage quando o fluxo de hoje termina de carregar
  // depois da busca — antes, um closure obsoleto congelava `todayFlow` nulo e a
  // linha de hoje ficava sem o saldo informado (a realidade).
  const timeline = useMemo<TreasuryCaixaTimelineData | null>(() => {
    if (!data) return null;
    const base = buildTimelineFromSources(data, todayFlow, agendaDays);
    // Futuro fora da cobertura da projeção materializada: estima dia a dia
    // pelos CR/CP em aberto por vencimento, ancorado no último caixa
    // conhecido — informar o caixa de hoje re-ancora toda a cadeia futura.
    return appendTreasuryCaixaDailyDueEstimates(
      base,
      data.dailyDueEstimates ?? []
    );
  }, [data, todayFlow, agendaDays]);

  /**
   * Série do gráfico — mesmos meses da linha do tempo, então a curva e a tabela
   * nunca divergem: o ponto do gráfico É o "Terminou" do mês.
   */
  const balanceChartPoints = useMemo(
    () =>
      timeline
        ? buildTreasuryCaixaMonthlyBalanceChart(
            buildTreasuryCaixaMonthlyTimeline(timeline.rows)
          )
        : [],
    [timeline]
  );

  function handleMonthChange(value: string) {
    setMonth(value === "" ? "" : Number(value));
    setDay("");
  }

  return (
    <FinanceBiDashboardShell>
      <div className="flex flex-col gap-3" data-testid="treasury-caixa-page">
        <FinanceExecutivePageHeader
          eyebrow="FINANCEIRO · CENTRAL DE TESOURARIA"
          title="Caixa"
          subtitle="Recebido/pago realizados + saldos em aberto por vencimento. A receber inclui previsões do Pedido de Venda ainda sem CR emitido."
          compact
          actions={[]}
        />

        <section
          className="rounded-lg border border-border bg-card px-3 py-2.5 shadow-sm"
          data-testid="caixa-filters"
        >
          <div className="flex flex-wrap items-end gap-2">
            <label className="w-[6rem] space-y-0.5">
              <span className={financeModuleFilterLabelClass()}>Ano</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                data-testid="caixa-filter-year"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-[9rem] space-y-0.5">
              <span className={financeModuleFilterLabelClass()}>Mês (opcional)</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={month}
                onChange={(e) => handleMonthChange(e.target.value)}
                data-testid="caixa-filter-month"
              >
                <option value="">Todos os meses</option>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-[6rem] space-y-0.5">
              <span className={financeModuleFilterLabelClass()}>Dia (opcional)</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={day}
                onChange={(e) =>
                  setDay(e.target.value === "" ? "" : Number(e.target.value))
                }
                disabled={month === ""}
                data-testid="caixa-filter-day"
              >
                <option value="">Todos os dias</option>
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void search()}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
              data-testid="caixa-search-button"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Pesquisar
            </button>
          </div>
        </section>

        <TreasuryCaixaAccountsSummary
          accounts={accounts}
          loading={accountsLoading}
          isSuperAdmin={auth.isSuperAdmin()}
          onChanged={() => {
            void loadAccounts();
            if (data) void search();
          }}
        />

        <TreasuryCaixaTodayFlow
          flow={todayFlow}
          canonicalToday={
            data?.canonicalDays?.find(
              (d) => d.civilDate === todayTreasuryCivilDateInSaoPaulo()
            ) ?? null
          }
          loading={accountsLoading}
        />

        <TreasuryCaixaOverdueStrip overdue={data?.overdue ?? null} />

        {data ? (
          <TreasuryCaixaTimeline
            timeline={timeline}
            loading={loading}
            monthlyDueEstimates={data?.monthlyDueEstimates}
            receivables={data?.receivables}
            payables={data?.payables}
            canonicalDays={data?.canonicalDays}
          />
        ) : null}

        <TreasuryCaixaBalanceChart points={balanceChartPoints} />

        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <TotalizerCard
                label="Já Recebido"
                value={formatMoney(data.totals.totalReceived)}
                tone="receivable"
              />
              <TotalizerCard
                label="Já Pago"
                value={formatMoney(data.totals.totalPaid)}
                tone="payable"
              />
              <TotalizerCard
                label="Saldo Realizado"
                value={formatMoney(data.totals.netRealized)}
                tone="net"
              />
              <TotalizerCard
                label="A Receber (em aberto)"
                value={formatMoney(data.totals.totalReceivable)}
                tone="receivable"
              />
              <TotalizerCard
                label="A Pagar (em aberto)"
                value={formatMoney(data.totals.totalPayable)}
                tone="payable"
              />
              <TotalizerCard
                label="Saldo em Aberto"
                value={formatMoney(data.totals.netBalance)}
                tone="net"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Qtd. títulos no período — CR: {data.totals.receivableCount} / CP:{" "}
              {data.totals.payableCount}
            </p>

            <section
              className="rounded-lg border border-border bg-card shadow-sm"
              data-testid="caixa-receivables-section"
              data-open={receivablesOpen}
            >
              <button
                type="button"
                onClick={() => setReceivablesOpen((v) => !v)}
                aria-expanded={receivablesOpen}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                data-testid="caixa-receivables-toggle"
              >
                {receivablesOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <h2 className="text-sm font-semibold text-foreground">
                  Contas a Receber ({data.receivables.length})
                </h2>
                <span className="ml-auto text-xs font-medium tabular-nums text-emerald-600">
                  {formatMoney(data.totals.totalReceivable)}
                </span>
              </button>
              {receivablesOpen ? (
                <div className="overflow-x-auto border-t border-border p-3 pt-2">
                  <table className="w-full text-xs" data-testid="caixa-receivables-table">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="px-2 py-1.5">Vencimento</th>
                        <th className="px-2 py-1.5">Cliente</th>
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2 py-1.5 text-right">Valor</th>
                        <th className="px-2 py-1.5 text-right">Recebido</th>
                        <th className="px-2 py-1.5 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.receivables.map((r) => (
                        <tr key={r.externalId} className="border-b border-border/50">
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatCivilDate(r.dueDate)}
                          </td>
                          <td className="px-2 py-1.5">{r.personName ?? "—"}</td>
                          <td className="px-2 py-1.5">
                            <TitleStatusBadge status={r.calculatedStatus} />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMoney(r.amountReceivable)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMoney(r.amountReceived)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                            {formatMoney(r.balanceReceivable)}
                          </td>
                        </tr>
                      ))}
                      {data.receivables.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-2 py-4 text-center text-muted-foreground"
                          >
                            Sem títulos no período.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>

            <section
              className="rounded-lg border border-border bg-card shadow-sm"
              data-testid="caixa-payables-section"
              data-open={payablesOpen}
            >
              <button
                type="button"
                onClick={() => setPayablesOpen((v) => !v)}
                aria-expanded={payablesOpen}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                data-testid="caixa-payables-toggle"
              >
                {payablesOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <h2 className="text-sm font-semibold text-foreground">
                  Contas a Pagar ({data.payables.length})
                </h2>
                <span className="ml-auto text-xs font-medium tabular-nums text-red-600">
                  {formatMoney(data.totals.totalPayable)}
                </span>
              </button>
              {payablesOpen ? (
                <div className="overflow-x-auto border-t border-border p-3 pt-2">
                  <table className="w-full text-xs" data-testid="caixa-payables-table">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="px-2 py-1.5">Vencimento</th>
                        <th className="px-2 py-1.5">Fornecedor</th>
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2 py-1.5 text-right">Valor</th>
                        <th className="px-2 py-1.5 text-right">Pago</th>
                        <th className="px-2 py-1.5 text-right">Saldo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.payables.map((p) => (
                        <tr key={p.externalId} className="border-b border-border/50">
                          <td className="px-2 py-1.5 tabular-nums">
                            {formatCivilDate(p.dueDate)}
                          </td>
                          <td className="px-2 py-1.5">{p.personName ?? "—"}</td>
                          <td className="px-2 py-1.5">
                            <TitleStatusBadge status={p.calculatedStatus} />
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMoney(p.amountPayable)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatMoney(p.amountPaid)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                            {formatMoney(p.balancePayable)}
                          </td>
                        </tr>
                      ))}
                      {data.payables.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-2 py-4 text-center text-muted-foreground"
                          >
                            Sem títulos no período.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </>
        ) : !loading ? (
          <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-card text-sm text-muted-foreground">
            Selecione o período e clique em Pesquisar.
          </div>
        ) : null}
      </div>
    </FinanceBiDashboardShell>
  );
}
