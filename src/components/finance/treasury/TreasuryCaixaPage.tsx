/**
 * Página — Caixa (Tesouraria).
 * Filtro Ano/(Mês)/(Dia) por vencimento → duas tabelas planas (CR e CP),
 * sem agrupar por banco, via motor oficial (financeAccountsReceivable/PayableRulesEngine).
 * Contas + lançamento de saldo reutilizam o painel/modal canônicos do Fluxo Gerencial
 * (APIs /today/opening e /today/closing, com log de usuário, data/hora e motivo).
 * Lançar saldo NÃO recalcula a tela: fica o aviso "Dados desatualizados" até o
 * usuário clicar em "Atualizar tela".
 * Abrir a tela carrega SÓ os saldos (Caixa hoje). O resto — movimento de hoje,
 * atrasados, linha do tempo, evolução do saldo, projeção e títulos do período —
 * só carrega quando o usuário pede ("Carregar movimentação" ou Pesquisar).
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
  alignTreasuryCaixaTodayFlowWithBalanceAuthority,
  appendTreasuryCaixaDailyDueEstimates,
  applyTreasuryCaixaCanonicalTodayFlow,
  buildTreasuryCaixaDayFlow,
  buildTreasuryCaixaMonthlyBalanceChart,
  buildTreasuryCaixaMonthlyTimeline,
  resolveTreasuryCaixaChainedOpeningForToday,
  type TreasuryCaixaDayFlow,
  type TreasuryCaixaTimeline as TreasuryCaixaTimelineData,
} from "@/src/lib/treasury/domain/treasuryCaixaRules.js";
import { buildTreasuryCaixaTimelineFromBoardSources } from "@/src/lib/treasury/treasuryCaixaAnnualViewUi.js";
import { treasuryMoneyToNumber } from "@/src/lib/treasury/treasuryPredictiveCashFlow.js";
import { TreasuryCaixaAccountsSummary } from "@/src/components/finance/treasury/TreasuryCaixaAccountsSummary";
import { TreasuryCaixaStaleBanner } from "@/src/components/finance/treasury/TreasuryCaixaStaleBanner";
import { TreasuryCaixaMovementPlaceholder } from "@/src/components/finance/treasury/TreasuryCaixaMovementPlaceholder";
import {
  addTreasuryCaixaPendingBalance,
  type TreasuryCaixaPendingBalance,
} from "@/src/lib/treasury/treasuryCaixaPendingBalances.js";
import { TreasuryCaixaTodayFlow } from "@/src/components/finance/treasury/TreasuryCaixaTodayFlow";
import { TreasuryCaixaOverdueStrip } from "@/src/components/finance/treasury/TreasuryCaixaOverdueStrip";
import {
  TreasuryCaixaTimeline,
  TitleStatusBadge,
} from "@/src/components/finance/treasury/TreasuryCaixaTimeline";
import "./treasury-caixa-timeline.css";
import { TreasuryCaixaBalanceChart } from "@/src/components/finance/treasury/TreasuryCaixaBalanceChart";
import { TreasuryCaixaScenariosChart } from "@/src/components/finance/treasury/TreasuryCaixaScenariosChart";
import {
  TreasuryCaixaTotalizerAuditModal,
  type TreasuryCaixaTotalizerAuditKind,
} from "@/src/components/finance/treasury/TreasuryCaixaTotalizerAuditModal";
import {
  fetchTreasuryCaixaScenarios,
  type TreasuryCaixaScenariosPayload,
} from "@/src/lib/treasury/treasuryCaixaScenariosApi.js";
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
 * Modal "Visão anual" — lazy: o chunk (modal + série anual) só baixa quando o
 * usuário clica no botão do gráfico. Nenhum request acontece ao abrir; o
 * fetch é disparado apenas pelo "Gerar gráfico" dentro do modal.
 */
const TreasuryCaixaAnnualViewModal = React.lazy(() =>
  import(
    "@/src/components/finance/treasury/TreasuryCaixaAnnualViewModal"
  ).then((m) => ({ default: m.TreasuryCaixaAnnualViewModal }))
);

/**
 * Modal "Visão ampliada" da Projeção do caixa — cenários (lazy: chunk só
 * baixa ao clicar; nenhum request antes do "Gerar projeção" do modal).
 */
const TreasuryCaixaScenariosExpandedModal = React.lazy(() =>
  import(
    "@/src/components/finance/treasury/TreasuryCaixaScenariosExpandedModal"
  ).then((m) => ({ default: m.TreasuryCaixaScenariosExpandedModal }))
);

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
  onClick,
}: {
  label: string;
  value: string;
  tone?: "receivable" | "payable" | "net" | "neutral";
  /** Quando informado, o card vira clicável e abre a auditoria. */
  onClick?: () => void;
}) {
  const toneClass =
    tone === "receivable"
      ? "border-[#A7F3D0] text-[#065F46]"
      : tone === "payable"
        ? "border-[#FECACA] text-[#991B1B]"
        : tone === "net"
          ? "border-[#BFDBFE] text-[#1E3A8A]"
          : "border-border text-foreground";
  const interactive = onClick != null;
  const commonClass = cn(
    "rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm",
    toneClass,
    interactive &&
      "cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#93C5FD]"
  );
  const inner = (
    <>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
        {interactive ? (
          <span className="ml-1 text-[9px] font-semibold text-[#2563EB]">
            (ver títulos)
          </span>
        ) : null}
      </p>
      <p className="mt-1 text-lg font-extrabold tabular-nums tracking-tight">
        {value}
      </p>
    </>
  );
  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={commonClass}
        data-testid={`caixa-card-${label}`}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={commonClass} data-testid={`caixa-card-${label}`}>
      {inner}
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
  // Começa "carregando": o card só aparece com a movimentação carregada, e é aí
  // que o movimento de hoje é buscado.
  const [todayFlowLoading, setTodayFlowLoading] = useState(true);
  const [agendaDays, setAgendaDays] = useState<readonly TreasuryAgendaDayDto[]>(
    []
  );
  // Menu cascata: listas de títulos começam fechadas — a tela fica compacta e
  // quem quiser o detalhe abre por conta própria (mesmo padrão do Atrasados).
  const [receivablesOpen, setReceivablesOpen] = useState(false);
  const [payablesOpen, setPayablesOpen] = useState(false);
  const [annualViewOpen, setAnnualViewOpen] = useState(false);
  const [scenariosExpandedOpen, setScenariosExpandedOpen] = useState(false);
  // Modal de auditoria dos totalizadores — abre ao clicar num card.
  const [auditKind, setAuditKind] =
    useState<TreasuryCaixaTotalizerAuditKind | null>(null);
  const accountsAbortRef = useRef<AbortController | null>(null);
  const todayFlowAbortRef = useRef<AbortController | null>(null);
  // Movimentação sob demanda: abrir a tela carrega só os saldos (Caixa hoje);
  // tudo abaixo espera "Carregar movimentação" — são as consultas pesadas.
  const [movementRequested, setMovementRequested] = useState(false);
  // Saldos gravados depois do último cálculo: a tela NÃO recalcula sozinha a
  // cada saldo (é pesado); fica o aviso até o usuário clicar em "Atualizar tela".
  const [pendingBalances, setPendingBalances] = useState<TreasuryCaixaPendingBalance[]>([]);

  // Cenários (Otimista/Realista/Pessimista) — endpoint único.
  const [scenarios, setScenarios] =
    useState<TreasuryCaixaScenariosPayload | null>(null);
  // Começa "carregando" pelo mesmo motivo do movimento de hoje: só é buscada
  // com a movimentação carregada.
  const [scenariosLoading, setScenariosLoading] = useState(true);
  const [scenariosHorizon, setScenariosHorizon] = useState<number>(30);
  const scenariosAbortRef = useRef<AbortController | null>(null);

  const loadScenarios = useCallback(async () => {
    scenariosAbortRef.current?.abort();
    const controller = new AbortController();
    scenariosAbortRef.current = controller;
    setScenariosLoading(true);
    try {
      const payload = await fetchTreasuryCaixaScenarios({
        horizonDays: scenariosHorizon,
        signal: controller.signal,
      });
      if (!controller.signal.aborted) setScenarios(payload);
    } catch {
      if (!controller.signal.aborted) setScenarios(null);
    } finally {
      if (!controller.signal.aborted) setScenariosLoading(false);
    }
  }, [scenariosHorizon]);

  // Projeção só com a movimentação carregada (e recarrega ao trocar o horizonte).
  useEffect(() => {
    if (!movementRequested) return;
    void loadScenarios();
    return () => scenariosAbortRef.current?.abort();
  }, [movementRequested, loadScenarios]);

  /**
   * Passo 1 — contas cadastradas + saldo mais recente de cada uma. É a ÚNICA
   * carga ao abrir a tela (Caixa hoje).
   */
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
    } catch {
      if (!controller.signal.aborted) setAccounts([]);
    } finally {
      if (!controller.signal.aborted) setAccountsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    return () => accountsAbortRef.current?.abort();
  }, [loadAccounts]);

  /**
   * Passo 3 — movimento de hoje (só com a movimentação carregada): os 4 números
   * já vêm calculados por conta no workspace canônico de fechamento; aqui só
   * consolidamos. Depende só da data — não das contas/saldos do passo 1.
   */
  const loadTodayFlow = useCallback(async () => {
    todayFlowAbortRef.current?.abort();
    const controller = new AbortController();
    todayFlowAbortRef.current = controller;
    setTodayFlowLoading(true);
    try {
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
              // `predictedTodayInflows/Outflows` do `/today/closing` (regra de
              // data crua) NÃO entram mais: a previsão de hoje passou a mover o
              // caixa (regra D+1) e sua única autoridade é o motor único-de-dia
              // — `applyTreasuryCaixaCanonicalTodayFlow` preenche `predicted*`
              // a partir de `canonicalDays[hoje].receivableDue/payableDue`.
              // Duas fontes para o mesmo número reabririam a divergência que a
              // correção canônica fechou.
            })
          : null
      );
    } catch {
      if (!controller.signal.aborted) setTodayFlow(null);
    } finally {
      if (!controller.signal.aborted) setTodayFlowLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!movementRequested) return;
    void loadTodayFlow();
    return () => todayFlowAbortRef.current?.abort();
  }, [movementRequested, loadTodayFlow]);

  const yearOptions = useMemo(() => {
    const base = today.getFullYear();
    const out: number[] = [];
    for (let y = base - 3; y <= base + 3; y += 1) out.push(y);
    return out;
  }, [today]);

  // Mesma resolução de empresa que o `search` usa para a agenda canônica.
  const annualCompanyCode = useMemo(
    () => accounts.map((a) => a.companyCode?.trim()).find((c) => c) ?? null,
    [accounts]
  );

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

  /**
   * Primeira busca do período (caixa + agenda) ao carregar a movimentação, com
   * os filtros do momento (de início, ano atual + todos os meses). Dispara uma
   * única vez e só depois que as contas terminam de carregar — assim ela se
   * comporta exatamente como um clique manual (companyCode disponível para a
   * agenda canônica). Buscas seguintes continuam manuais (Pesquisar).
   */
  const didAutoSearchRef = useRef(false);
  useEffect(() => {
    if (!movementRequested || accountsLoading || didAutoSearchRef.current) return;
    didAutoSearchRef.current = true;
    void search();
  }, [movementRequested, accountsLoading, search]);

  /**
   * "Carregar movimentação" (ou Pesquisar antes de carregar): libera tudo abaixo
   * do Caixa hoje — os efeitos acima buscam movimento de hoje, caixa do período
   * e projeção. Saldos lançados antes disso entram junto: recarrega as contas e
   * limpa o aviso, para a tela inteira sair do mesmo cálculo (sem carregar a
   * movimentação uma segunda vez no "Atualizar tela").
   */
  const requestMovement = useCallback(() => {
    if (movementRequested) return;
    if (pendingBalances.length > 0) {
      setPendingBalances([]);
      void loadAccounts();
    }
    setMovementRequested(true);
    // A busca do período espera as contas; até ela começar, a seção já aparece
    // carregando (e não "Selecione o período").
    setLoading(true);
  }, [movementRequested, pendingBalances.length, loadAccounts]);

  /**
   * "Atualizar tela": recalcula o que está na tela e limpa o aviso — as contas
   * sempre; com a movimentação carregada, também movimento de hoje, caixa do
   * período (linha do tempo/gráfico) e projeção. É o único caminho que
   * recalcula depois de lançar saldo.
   */
  const refreshScreen = useCallback(() => {
    setPendingBalances([]);
    void loadAccounts();
    // Sem a movimentação carregada, só os saldos estão na tela.
    if (!movementRequested) return;
    void loadTodayFlow();
    void search();
    void loadScenarios();
  }, [movementRequested, loadAccounts, loadTodayFlow, search, loadScenarios]);

  // Dia canônico de hoje (motor único-de-dia) — mesma fonte que o drill-down
  // e o card "Movimento de hoje" já usam para A receber/Recebido/A pagar/Pago.
  const canonicalToday = useMemo(
    () =>
      data?.canonicalDays?.find(
        (d) => d.civilDate === todayTreasuryCivilDateInSaoPaulo()
      ) ?? null,
    [data]
  );

  // Corrige `todayFlow.inflows/outflows` (fechamento bancário bruto de
  // `/today/closing`, sem a regra dos 3 dias) para a MESMA autoridade AR/AP
  // canônica do drill-down — é essa versão corrigida que alimenta tanto o
  // card "Movimento de hoje" quanto a linha "hoje" da linha do tempo, para os
  // dois nunca mais divergirem entre si.
  /**
   * Abertura automática de hoje quando ninguém informou saldo do dia: o
   * fechamento do último dia realizado. Sem isso, um dia sem lançamento manual
   * mostrava "—" em Começou/Terminou e a projeção perdia a âncora, mesmo com o
   * saldo de ontem conhecido.
   */
  const chainedOpeningForToday = useMemo(
    () =>
      resolveTreasuryCaixaChainedOpeningForToday(
        data?.realizedDays ?? [],
        todayTreasuryCivilDateInSaoPaulo()
      ),
    [data]
  );

  const correctedTodayFlow = useMemo(
    () =>
      todayFlow
        ? // Começou/Terminou da autoridade única de saldos — os MESMOS da linha
          // HOJE (sem o board ainda, fica o fluxo corrigido pelo dia canônico).
          alignTreasuryCaixaTodayFlowWithBalanceAuthority(
            applyTreasuryCaixaCanonicalTodayFlow(todayFlow, canonicalToday, {
              fallbackOpening: chainedOpeningForToday,
            }),
            data?.todayBalance
          )
        : null,
    [todayFlow, canonicalToday, chainedOpeningForToday, data]
  );

  // A linha do tempo é DERIVADA das três fontes. Montá-la aqui (e não dentro de
  // `search`) garante que ela reage quando o fluxo de hoje termina de carregar
  // depois da busca — antes, um closure obsoleto congelava `todayFlow` nulo e a
  // linha de hoje ficava sem o saldo informado (a realidade).
  const timeline = useMemo<TreasuryCaixaTimelineData | null>(() => {
    if (!data) return null;
    const base = buildTreasuryCaixaTimelineFromBoardSources(
      data,
      correctedTodayFlow,
      agendaDays
    );
    // Futuro fora da cobertura da projeção materializada: estima dia a dia
    // pelos CR/CP em aberto por vencimento, ancorado no último caixa
    // conhecido — informar o caixa de hoje re-ancora toda a cadeia futura.
    return appendTreasuryCaixaDailyDueEstimates(
      base,
      data.dailyDueEstimates ?? []
    );
  }, [data, correctedTodayFlow, agendaDays]);

  /**
   * Série do gráfico — mesmos meses da linha do tempo, então a curva e a tabela
   * nunca divergem: o ponto do gráfico É o "Terminou" do mês.
   */
  const balanceChartPoints = useMemo(
    () =>
      timeline
        ? buildTreasuryCaixaMonthlyBalanceChart(
            buildTreasuryCaixaMonthlyTimeline(timeline.rows, {
              historicalArMonthlyInflowDeltaByMonth:
                data?.historicalArMonthlyInflowDeltaByMonth,
            })
          )
        : [],
    [timeline, data?.historicalArMonthlyInflowDeltaByMonth]
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
              // Antes de carregar a movimentação, Pesquisar é o próprio "Carregar
              // movimentação" (com o período escolhido); depois, recalcula só o período.
              onClick={() => (movementRequested ? void search() : requestMovement())}
              disabled={loading}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-semibold text-foreground hover:bg-muted/40 disabled:opacity-50"
              data-testid="caixa-search-button"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Pesquisar
            </button>
          </div>
        </section>

        <TreasuryCaixaStaleBanner
          pendingBalances={pendingBalances}
          movementLoaded={movementRequested}
          onRefresh={refreshScreen}
        />

        <TreasuryCaixaAccountsSummary
          accounts={accounts}
          loading={accountsLoading}
          isSuperAdmin={auth.isSuperAdmin()}
          pendingBalances={pendingBalances}
          // Só guarda o lançamento: nada é recalculado até "Atualizar tela".
          onBalanceSaved={(entry) => setPendingBalances((list) => addTreasuryCaixaPendingBalance(list, entry))}
        />

        {/* Movimentação sob demanda: tudo abaixo do Caixa hoje só existe depois de "Carregar movimentação". */}
        {!movementRequested ? (
          <TreasuryCaixaMovementPlaceholder onLoad={requestMovement} />
        ) : (
          <>
            <TreasuryCaixaTodayFlow
              flow={correctedTodayFlow}
              canonicalToday={canonicalToday}
              openingCoverage={data?.todayBalance?.openingCoverage ?? null}
              // Espera também o caixa do período: antes dele o card mostraria o
              // subtotal do /today/closing no lugar dos saldos da autoridade.
              loading={todayFlowLoading || (loading && data == null)}
              onOpenAudit={(kind) => {
                // Mapa "dimensão do dia" → kind da modal de auditoria.
                const map = {
                  receivableDue: "todayReceivableDue",
                  receivableReceived: "todayReceivableReceived",
                  payableDue: "todayPayableDue",
                  payablePaid: "todayPayablePaid",
                } as const;
                setAuditKind(map[kind]);
              }}
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
                historicalArMonthlyInflowDeltaByMonth={
                  data?.historicalArMonthlyInflowDeltaByMonth
                }
              />
            ) : null}

            <TreasuryCaixaBalanceChart
              points={balanceChartPoints}
              headerAction={
                <button
                  type="button"
                  onClick={() => setAnnualViewOpen(true)}
                  className="rounded-md border border-border px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-muted"
                  data-testid="caixa-annual-open"
                >
                  Visão anual
                </button>
              }
            />

            {annualViewOpen ? (
              <React.Suspense fallback={null}>
                <TreasuryCaixaAnnualViewModal
                  defaultYear={year}
                  yearOptions={yearOptions}
                  todayFlowRaw={todayFlow}
                  companyCode={annualCompanyCode}
                  onClose={() => setAnnualViewOpen(false)}
                />
              </React.Suspense>
            ) : null}

            <TreasuryCaixaScenariosChart
              data={scenarios}
              loading={scenariosLoading}
              horizonDays={scenariosHorizon}
              onHorizonChange={setScenariosHorizon}
              onRefresh={() => void loadScenarios()}
              // FONTE ÚNICA: a MESMA série que alimenta a tabela "Linha do tempo"
              // alimenta a linha Realista do gráfico. Não é uma segunda conta que
              // "deveria" bater — é o mesmo array. Otimista/Pessimista preservam
              // o delta que o motor canônico do backend calculou.
              timelineRows={timeline?.rows}
              headerAction={
                <button
                  type="button"
                  onClick={() => setScenariosExpandedOpen(true)}
                  className="rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1 text-[11px] font-semibold hover:bg-[#F9FAFB]"
                  data-testid="caixa-scenarios-expanded-open"
                >
                  Visão ampliada
                </button>
              }
            />

            {scenariosExpandedOpen ? (
              <React.Suspense fallback={null}>
                <TreasuryCaixaScenariosExpandedModal
                  todayFlowRaw={todayFlow}
                  companyCode={annualCompanyCode}
                  onClose={() => setScenariosExpandedOpen(false)}
                />
              </React.Suspense>
            ) : null}

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
                    onClick={() => setAuditKind("totalReceived")}
                  />
                  <TotalizerCard
                    label="Já Pago"
                    value={formatMoney(data.totals.totalPaid)}
                    tone="payable"
                    onClick={() => setAuditKind("totalPaid")}
                  />
                  <TotalizerCard
                    label="Saldo Realizado"
                    value={formatMoney(data.totals.netRealized)}
                    tone="net"
                    onClick={() => setAuditKind("netRealized")}
                  />
                  <TotalizerCard
                    label="A Receber (em aberto)"
                    value={formatMoney(data.totals.totalReceivable)}
                    tone="receivable"
                    onClick={() => setAuditKind("totalReceivable")}
                  />
                  <TotalizerCard
                    label="A Pagar (em aberto)"
                    value={formatMoney(data.totals.totalPayable)}
                    tone="payable"
                    onClick={() => setAuditKind("totalPayable")}
                  />
                  <TotalizerCard
                    label="Saldo em Aberto"
                    value={formatMoney(data.totals.netBalance)}
                    tone="net"
                    onClick={() => setAuditKind("netBalance")}
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
          </>
        )}
      </div>

      {data ? (
        <TreasuryCaixaTotalizerAuditModal
          kind={auditKind}
          periodLabel={
            auditKind && auditKind.startsWith("today")
              ? `Hoje · ${formatCivilDate(todayTreasuryCivilDateInSaoPaulo())}`
              : formatCaixaPeriodLabel(year, month, day)
          }
          cardValue={resolveAuditCardValue(data.totals, auditKind, canonicalToday)}
          receivables={data.receivables ?? []}
          payables={data.payables ?? []}
          canonicalToday={canonicalToday}
          onClose={() => setAuditKind(null)}
        />
      ) : null}
    </FinanceBiDashboardShell>
  );
}

/** Rótulo pt-BR do período consultado — reuso do próprio filtro da tela. */
function formatCaixaPeriodLabel(
  year: number,
  month: number | "",
  day: number | ""
): string {
  const monthLabel =
    month === ""
      ? "Ano inteiro"
      : MONTH_OPTIONS.find((m) => m.value === month)?.label ??
        String(month).padStart(2, "0");
  if (day === "") return `${monthLabel}/${year}`;
  return `${String(day).padStart(2, "0")} · ${monthLabel}/${year}`;
}

/** Valor do card que a modal está auditando — mesma fonte que os cards usam.
 *  Totalizadores do período vêm de `data.totals`; cards do "Movimento de
 *  hoje" vêm do canonicalDay do dia (mesmo dado que o próprio card mostra). */
function resolveAuditCardValue(
  totals: {
    totalReceived: number;
    totalPaid: number;
    netRealized: number;
    totalReceivable: number;
    totalPayable: number;
    netBalance: number;
  },
  kind: TreasuryCaixaTotalizerAuditKind | null,
  canonicalToday: {
    receivableDue: number;
    receivableReceived: number;
    payableDue: number;
    payablePaid: number;
  } | null
): number {
  if (kind == null) return 0;
  switch (kind) {
    case "todayReceivableDue":
      return canonicalToday?.receivableDue ?? 0;
    case "todayReceivableReceived":
      return canonicalToday?.receivableReceived ?? 0;
    case "todayPayableDue":
      return canonicalToday?.payableDue ?? 0;
    case "todayPayablePaid":
      return canonicalToday?.payablePaid ?? 0;
    default:
      return totals[kind];
  }
}
