/**
 * Service — aba "Caixa" da Tesouraria.
 * Zero regra de negócio própria: carrega via loaders canônicos e monta o
 * resultado com os motores oficiais (financeAccountsReceivable/PayableRulesEngine).
 * CR usa a agenda efetiva FIN-08 (mesma fonte da linha do tempo mensal do Fluxo de
 * Caixa), então inclui previsões do Pedido de Venda ainda sem CR emitido.
 * Sem agrupar por banco — lista plana de títulos, igual ao motor entrega.
 */

import type { PrismaClient } from "@prisma/client";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.server.js";
import {
  buildFinanceAccountsReceivableRulesResult,
  sumOfficialArOpenDueByCivilDay,
  sumOfficialArOpenDueInPeriod,
} from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import { loadFinanceApManagementRowsFromPrisma } from "@/src/lib/financeAccountsPayableDashboard.js";
import {
  buildFinanceAccountsPayableRulesResult,
  sumOfficialApOpenDueByCivilDay,
  sumOfficialApOpenDueInPeriod,
} from "@/src/lib/financeAccountsPayableRulesEngine.js";
import { enrichFinanceCashFlowArLoadBundle } from "@/src/lib/finance/financeCashFlowEffectiveAr.server.js";
import { buildFinanceCashFlowEffectiveArPortfolio } from "@/src/lib/finance/financeCashFlowEffectiveAr.js";
import {
  loadFinanceCashFlowCanonicalRealizedYearSets,
  type FinanceCashFlowCanonicalRealizedYearSets,
} from "@/src/lib/finance/financeCashFlowCanonicalRealized.server.js";
import {
  isFinanceApCancelledTitle,
  resolveFinanceApEffectivePaymentDate,
  resolveFinanceApRealizedAmount,
} from "@/src/lib/financeAccountsPayableRules.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";
import { civilDateToLocalDate, toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { treasuryCompanyCodePresentWhere } from "../treasuryPrismaFilters.js";
import {
  applyTreasuryCaixaRunningBalance,
  buildTreasuryCaixaOverdue,
  buildTreasuryCaixaRealizedDays,
  computeTreasuryCaixaTotals,
  resolveTreasuryCaixaDueDateRange,
  TREASURY_CAIXA_GENESIS_CIVIL_DATE,
  type TreasuryCaixaBoardDto,
  type TreasuryCaixaPeriodInput,
} from "../domain/treasuryCaixaRules.js";
import { buildTreasuryCaixaCanonicalDays } from "../domain/treasuryCaixaCanonicalDay.js";
import {
  loadTreasuryOfficialTodayBalance,
  type TreasuryOfficialTodayBalance,
} from "./treasuryOfficialTodayBalance.server.js";
import { todayTreasuryCivilDateInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import {
  parseTreasuryDailyRoutineSnapshotKey,
  TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX,
} from "../domain/treasuryDailyAccountRoutineRules.js";

export type TreasuryCaixaService = {
  getBoard(period: TreasuryCaixaPeriodInput): Promise<TreasuryCaixaBoardDto>;
};

/**
 * Meses civis cobertos por `[dueDateFrom, dueDateTo]`, para a estimativa
 * mensal por vencimento (ver `appendTreasuryCaixaMonthlyDueEstimates` no
 * domínio). Os limites já vêm alinhados a mês/ano por `resolveTreasuryCaixaDueDateRange`,
 * então cada mês entra com o intervalo do CALENDÁRIO inteiro — não recortado
 * pelo período pedido — mesma regra do "Linha do tempo mensal" do Fluxo de
 * Caixa (`buildExecutiveMonthlyTimeline`), garantindo que os números batam
 * mês a mês com aquela tela.
 */
export function resolveTreasuryCaixaMonthlyEstimateRanges(
  dueDateFrom: Date,
  dueDateTo: Date
): Array<{ monthKey: string; monthStart: Date; monthEnd: Date }> {
  const ranges: Array<{ monthKey: string; monthStart: Date; monthEnd: Date }> =
    [];
  let year = dueDateFrom.getFullYear();
  let month = dueDateFrom.getMonth();
  const lastYear = dueDateTo.getFullYear();
  const lastMonth = dueDateTo.getMonth();
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    ranges.push({
      monthKey: `${year}-${String(month + 1).padStart(2, "0")}`,
      monthStart: new Date(year, month, 1),
      monthEnd: new Date(year, month + 1, 0),
    });
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return ranges;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Anos civis cujo realizado precisa entrar na cadeia da linha do tempo:
 * da gênese da Caixa até o ano filtrado (a acumulação parte de zero na
 * gênese). Ano anterior à gênese fica sozinho — não há premissa de saldo lá.
 */
export function resolveTreasuryCaixaChainYears(
  periodYear: number,
  genesisCivilDate: string = TREASURY_CAIXA_GENESIS_CIVIL_DATE
): number[] {
  const genesisYear = Number(genesisCivilDate.slice(0, 4));
  const start = Math.min(periodYear, genesisYear);
  const years: number[] = [];
  for (let y = start; y <= periodYear; y += 1) years.push(y);
  return years;
}

/**
 * Converte os conjuntos canônicos do Fluxo de Caixa (por ano) nas entradas de
 * dia de `buildTreasuryCaixaRealizedDays` — MESMAS regras da "Linha do tempo
 * mensal" do Fluxo:
 *
 * - CR entra no dia da BAIXA (`settlementDate`), valor `amountReceived`;
 * - CP entra pela data canônica `resolveFinanceApEffectivePaymentDate`
 *   (= vencimento — o Nomus raramente informa a data real do pagamento),
 *   valor `resolveFinanceApRealizedAmount`, cancelados fora;
 * - o dia precisa cair DENTRO do ano do contexto: cada tabela anual do Fluxo
 *   só enxerga títulos daquele ano-vencimento baixados naquele ano. Baixa
 *   cruzando ano (título de um ano pago no outro) fica fora — é exatamente o
 *   recorte da tela de referência, e é o que faz os números baterem 1:1.
 */
export function buildTreasuryCaixaCanonicalRealizedInputs(
  contexts: readonly FinanceCashFlowCanonicalRealizedYearSets[]
): {
  receivables: { settlementDate: string | null; amountReceived: number }[];
  payables: {
    dueDate: string | null;
    paymentDate: string | null;
    amountPaid: number;
  }[];
} {
  const receivables: { settlementDate: string | null; amountReceived: number }[] =
    [];
  const payables: {
    dueDate: string | null;
    paymentDate: string | null;
    amountPaid: number;
  }[] = [];

  for (const ctx of contexts) {
    const yearPrefix = `${ctx.year}-`;

    for (const row of ctx.arReceivedRows as readonly Pick<
      FinanceCashFlowArRow,
      "settlementDate" | "amountReceived"
    >[]) {
      if (!row.settlementDate) continue;
      const key = toCivilDateKey(row.settlementDate);
      if (!key || !key.startsWith(yearPrefix)) continue;
      const amount = Number(row.amountReceived);
      if (!Number.isFinite(amount) || amount === 0) continue;
      receivables.push({ settlementDate: key, amountReceived: amount });
    }

    for (const row of ctx.apPaidRows as readonly FinanceCashFlowApRow[]) {
      if (isFinanceApCancelledTitle(row)) continue;
      const paidAt = resolveFinanceApEffectivePaymentDate(row);
      const realized = resolveFinanceApRealizedAmount(row);
      if (!paidAt || realized <= 0) continue;
      const key = toCivilDateKey(paidAt);
      if (!key || !key.startsWith(yearPrefix)) continue;
      payables.push({ dueDate: null, paymentDate: key, amountPaid: realized });
    }
  }

  return { receivables, payables };
}

/**
 * Limites UTC para filtrar coluna `@db.Date`.
 *
 * `TreasuryDailyClosing.civilDate` é `@db.Date`: o Postgres devolve meia-noite
 * UTC. Montar o limite com `civilDateToLocalDate` (meia-noite LOCAL) desloca
 * para 03:00Z em UTC-3, e o fechamento do próprio dia do limite cairia fora do
 * `gte`. Mesma razão do helper `civilRange` do repositório de relatórios —
 * limite superior exclusivo (`lt` no dia seguinte) em vez de `lte`.
 */
export function civilDateUtcRange(
  from: string,
  to: string
): { gte: Date; lt: Date } {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return {
    gte: new Date(Date.UTC(fy!, fm! - 1, fd!)),
    lt: new Date(Date.UTC(ty!, tm! - 1, td! + 1)),
  };
}

/**
 * Fallback do saldo informado quando o dia NÃO tem fechamento formal
 * (`TreasuryDailyClosing` CLOSED): soma, por dia civil, o snapshot
 * `daily-closing-bank` mais recente de cada conta ativa da empresa.
 *
 * Sem isso, "Saldos do Dia" (o atalho rápido — grava só em
 * `TreasuryBalanceSnapshot`) fica invisível na linha do tempo do Caixa até
 * alguém repetir a informação via fechamento formal. O fechamento formal
 * continua tendo prioridade quando os dois existirem para o mesmo dia (é o
 * dado imutável/reconciliado); este fallback só preenche o que falta.
 */
export async function loadFallbackDailyClosingBankSumByCivilDate(
  prisma: PrismaClient,
  accountIds: string[],
  fromCivilDate: string,
  toCivilDate: string
): Promise<Map<string, number>> {
  const sumByDay = new Map<string, number>();
  if (accountIds.length === 0) return sumByDay;

  const rows = await prisma.treasuryBalanceSnapshot.findMany({
    where: {
      accountId: { in: accountIds },
      origin: "MANUAL",
      cancelledAt: null,
      idempotencyKey: {
        startsWith: `${TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX}:`,
      },
    },
    orderBy: { createdAt: "desc" },
    select: { accountId: true, idempotencyKey: true, availableBalance: true },
  });

  // orderBy createdAt desc + primeira ocorrência vista = versão mais recente
  // por conta+dia (reabertura/correção grava idempotencyKey com versão nova).
  const seenAccountDay = new Set<string>();
  for (const row of rows) {
    const parsed = parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey);
    if (!parsed || parsed.kind !== "closingBank") continue;
    if (parsed.civilDate < fromCivilDate || parsed.civilDate > toCivilDate) continue;

    const accountDayKey = `${row.accountId}:${parsed.civilDate}`;
    if (seenAccountDay.has(accountDayKey)) continue;
    seenAccountDay.add(accountDayKey);

    const value = Number(row.availableBalance);
    if (!Number.isFinite(value)) continue;
    sumByDay.set(parsed.civilDate, (sumByDay.get(parsed.civilDate) ?? 0) + value);
  }

  return sumByDay;
}

/**
 * Fallback do saldo informado pela tela genérica "Saldo"
 * (`TreasuryAccountBalancePage` → `POST .../balance-snapshots`) — o mesmo
 * `TreasuryBalanceSnapshot` origem MANUAL, mas sem a chave especial da rotina
 * "Saldos do Dia". Cobre o caso de informar saldo inicial/final retroativo de
 * um mês inteiro sem passar pela rotina diária guiada.
 *
 * Diferença crucial em relação ao fallback acima: aqui o dia civil vem de
 * `referenceAt` (a data que o usuário escolheu no formulário), não de uma
 * chave — porque este fluxo não embute a data civil na idempotencyKey. Por
 * isso os dois fallbacks são mutuamente exclusivos (o parse da chave da
 * rotina é usado para pular linhas que pertencem ao outro fallback).
 */
export async function loadFallbackGenericManualBalanceSumByCivilDate(
  prisma: PrismaClient,
  accountIds: string[],
  fromCivilDate: string,
  toCivilDate: string
): Promise<Map<string, number>> {
  const sumByDay = new Map<string, number>();
  if (accountIds.length === 0) return sumByDay;

  const rangeFrom = civilDateToLocalDate(fromCivilDate);
  const rangeToExclusive = new Date(
    civilDateToLocalDate(toCivilDate).getTime() + 24 * 60 * 60 * 1000
  );

  const rows = await prisma.treasuryBalanceSnapshot.findMany({
    where: {
      accountId: { in: accountIds },
      origin: "MANUAL",
      cancelledAt: null,
      referenceAt: { gte: rangeFrom, lt: rangeToExclusive },
    },
    orderBy: [{ referenceAt: "desc" }, { createdAt: "desc" }],
    select: {
      accountId: true,
      idempotencyKey: true,
      referenceAt: true,
      availableBalance: true,
    },
  });

  // orderBy referenceAt/createdAt desc + primeira ocorrência vista = versão
  // mais recente informada por conta+dia civil.
  const seenAccountDay = new Set<string>();
  for (const row of rows) {
    // Snapshot da rotina "Saldos do Dia": referenceAt é o instante do
    // registro (agora), não o dia civil sendo fechado — já coberto pelo
    // fallback dedicado acima, que lê o dia certo embutido na chave.
    if (parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey)) continue;

    const civilDate = toIsoDate(row.referenceAt);
    if (civilDate < fromCivilDate || civilDate > toCivilDate) continue;

    const accountDayKey = `${row.accountId}:${civilDate}`;
    if (seenAccountDay.has(accountDayKey)) continue;
    seenAccountDay.add(accountDayKey);

    const value = Number(row.availableBalance);
    if (!Number.isFinite(value)) continue;
    sumByDay.set(civilDate, (sumByDay.get(civilDate) ?? 0) + value);
  }

  return sumByDay;
}

/**
 * Saldo aberto por vencimento (CR/CP), num range qualquer — mesmo motor
 * canônico (`sumOfficialArOpenDueInPeriod`/`sumOfficialApOpenDueInPeriod`) e
 * mesmo tratamento FIN-08 do CR (`buildFinanceCashFlowEffectiveArPortfolio`,
 * inclui previsão do Pedido de Venda ainda sem CR emitido) usados por
 * `getBoard()` e pela "Linha do tempo mensal" do Fluxo de Caixa.
 *
 * Reutilizável por qualquer tela que precise de "quanto tem para
 * entrar/sair" num período sem duplicar a regra — ex.: o previsto de hoje no
 * card "Movimento de hoje" (`treasuryGuidedDailyClosingService.server.ts`).
 * CR sempre carrega o ano inteiro de `dueDateFrom` (mesma exigência do FIN-08
 * já aceita em `getBoard()`), mesmo que o range pedido seja um único dia.
 */
export async function loadTreasuryOpenDueTotals(
  prisma: PrismaClient,
  referenceDate: Date,
  dueDateFrom: Date,
  dueDateTo: Date
): Promise<{ estimatedInflow: number; estimatedOutflow: number }> {
  const arPortfolioFilters = {
    status: "all",
    year: dueDateFrom.getFullYear(),
  } as const;

  const [arLoaded, apLoaded] = await Promise.all([
    loadFinanceArManagementRowsFromPrisma(
      prisma,
      arPortfolioFilters,
      referenceDate
    ),
    loadFinanceApManagementRowsFromPrisma(
      prisma,
      { status: "all", dueDateFrom, dueDateTo },
      referenceDate
    ),
  ]);

  const arRows = arLoaded.rows as FinanceCashFlowArRow[];
  const { orderContexts, nfeOrderLinks } = await enrichFinanceCashFlowArLoadBundle(
    prisma,
    arRows,
    referenceDate
  );
  const arEffectiveRows = buildFinanceCashFlowEffectiveArPortfolio({
    rows: arRows,
    filters: arPortfolioFilters,
    orderContexts,
    nfeOrderLinks,
    referenceDate,
    syncCutoff: arLoaded.syncCutoff,
  });

  return {
    estimatedInflow: sumOfficialArOpenDueInPeriod(
      arEffectiveRows,
      dueDateFrom,
      dueDateTo
    ),
    estimatedOutflow: sumOfficialApOpenDueInPeriod(
      apLoaded.rows,
      dueDateFrom,
      dueDateTo
    ),
  };
}

export function createTreasuryCaixaService(input: {
  prisma: PrismaClient;
}): TreasuryCaixaService {
  const { prisma } = input;

  return {
    async getBoard(period) {
      const { dueDateFrom, dueDateTo } = resolveTreasuryCaixaDueDateRange(period);
      const referenceDate = new Date();

      // CR carrega o ano inteiro: o motor FIN-08 precisa do portfólio sem recorte
      // para casar CR real x previsão do Pedido. O recorte do período é aplicado
      // depois, pelo motor oficial, via dueDateFrom/dueDateTo.
      const arPortfolioFilters = { status: "all", year: period.year } as const;

      const [arLoaded, apLoaded] = await Promise.all([
        loadFinanceArManagementRowsFromPrisma(
          prisma,
          arPortfolioFilters,
          referenceDate
        ),
        loadFinanceApManagementRowsFromPrisma(
          prisma,
          { status: "all", dueDateFrom, dueDateTo },
          referenceDate
        ),
      ]);

      const arRows = arLoaded.rows as FinanceCashFlowArRow[];
      const { orderContexts, nfeOrderLinks } =
        await enrichFinanceCashFlowArLoadBundle(prisma, arRows, referenceDate);

      const arEffectiveRows = buildFinanceCashFlowEffectiveArPortfolio({
        rows: arRows,
        filters: arPortfolioFilters,
        orderContexts,
        nfeOrderLinks,
        referenceDate,
        syncCutoff: arLoaded.syncCutoff,
      });

      const arResult = buildFinanceAccountsReceivableRulesResult(arEffectiveRows, {
        referenceDate,
        syncCutoff: arLoaded.syncCutoff,
        filters: { status: "all", dueDateFrom, dueDateTo },
      });
      const apResult = buildFinanceAccountsPayableRulesResult(apLoaded.rows, {
        referenceDate,
        syncCutoff: apLoaded.syncCutoff,
        filters: { status: "all", dueDateFrom, dueDateTo },
      });

      // Mesma regra do Radar Diário de Caixa/Fluxo de Caixa: título com
      // pagamento/recebimento suspenso não soma no fluxo (o Ledger zera o
      // valor lá; aqui exclui antes de somar) — sem isso os totais divergiam
      // da tela de Fluxo de Caixa sempre que existisse um título suspenso no
      // período. Não filtra `arResult.gridRows`/`apResult.gridRows` em si:
      // a listagem de títulos devolvida (`receivables`/`payables` do DTO)
      // continua mostrando os suspensos, como as telas de gestão de CR/CP.
      const totals = computeTreasuryCaixaTotals({
        receivables: arResult.gridRows.filter((r) => !r.suspendCollection),
        payables: apResult.gridRows.filter((r) => !r.suspendPayment),
      });

      // Passado da linha do tempo: MESMOS conjuntos e MESMAS regras da
      // "Linha do tempo mensal" do Fluxo de Caixa (Recebido/Pago), ano a ano
      // da gênese até o ano filtrado — os totais mensais batem 1:1 com aquela
      // tela por construção; aqui só particionamos por dia. CR entra no dia da
      // baixa; CP pela data canônica (vencimento — o Nomus raramente informa
      // o pagamento real). Baixa cruzando ano fica fora, como lá.
      const chainYears = resolveTreasuryCaixaChainYears(period.year);
      const canonicalContexts: FinanceCashFlowCanonicalRealizedYearSets[] = [];
      for (const year of chainYears) {
        canonicalContexts.push(
          await loadFinanceCashFlowCanonicalRealizedYearSets(
            prisma,
            year,
            referenceDate,
            // O board já carregou o AR canônico do ano filtrado
            // ({ status: "all", year }) — reusa em vez de recarregar.
            year === period.year
              ? {
                  arRows,
                  syncCutoff: arLoaded.syncCutoff,
                  orderContexts,
                  nfeOrderLinks,
                }
              : undefined
          )
        );
      }
      const periodFrom = toIsoDate(dueDateFrom);
      const periodTo = toIsoDate(dueDateTo);
      const realizedDaysAll = buildTreasuryCaixaRealizedDays(
        buildTreasuryCaixaCanonicalRealizedInputs(canonicalContexts)
      );
      // Janela dos saldos informados (fechamentos/snapshots): da gênese (ou do
      // ano filtrado, se anterior a ela) até o fim do período — independe do
      // recorte de vencimento dos títulos.
      const settlementWindowFromCivilDate =
        `${period.year - 1}-01-01` < TREASURY_CAIXA_GENESIS_CIVIL_DATE
          ? `${period.year - 1}-01-01`
          : TREASURY_CAIXA_GENESIS_CIVIL_DATE;
      // Saldo INFORMADO por dia — motor canônico de fechamento diário.
      // Espelha a carga do relatório oficial (treasuryReportRepository):
      // só CLOSED e, por dia, a versão mais alta (reabertura gera nova versão).
      // `observedBalance` é o saldo do extrato; `closingBalance` é o calculado.
      // A divergência entre os dois é apurada no domínio, não aqui.
      const companyAccounts = await prisma.treasuryFinancialAccount.findMany({
        where: { isActive: true, ...treasuryCompanyCodePresentWhere() },
        select: { id: true, companyCode: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      });
      const companyCode = companyAccounts[0]?.companyCode?.trim() || null;

      const informedClosingByCivilDate = new Map<string, number>();
      if (companyCode) {
        const closingRange = civilDateUtcRange(
          settlementWindowFromCivilDate,
          periodTo
        );
        const closings = await prisma.treasuryDailyClosing.findMany({
          where: {
            companyCode,
            status: "CLOSED",
            civilDate: { gte: closingRange.gte, lt: closingRange.lt },
          },
          orderBy: [{ civilDate: "asc" }, { version: "desc" }],
          distinct: ["civilDate"],
          select: { civilDate: true, observedBalance: true },
        });
        for (const c of closings) {
          const value = Number(c.observedBalance);
          if (!Number.isFinite(value)) continue;
          informedClosingByCivilDate.set(toIsoDate(c.civilDate), value);
        }

        // Fallback: dia sem fechamento formal, mas com saldo informado via
        // "Saldos do Dia" — não sobrepõe o fechamento formal, só preenche o
        // que falta (evita que o atalho rápido fique invisível na tela).
        const accountIds = companyAccounts.map((a) => a.id);
        const fallbackByCivilDate = await loadFallbackDailyClosingBankSumByCivilDate(
          prisma,
          accountIds,
          settlementWindowFromCivilDate,
          periodTo
        );
        for (const [civilDate, value] of fallbackByCivilDate) {
          if (informedClosingByCivilDate.has(civilDate)) continue;
          informedClosingByCivilDate.set(civilDate, value);
        }

        // Fallback: saldo informado pela tela genérica "Saldo" (fora da
        // rotina diária guiada) — cobre backfill retroativo de saldo
        // inicial/final por mês. Só preenche o que os dois anteriores não
        // cobriram (fechamento formal e "Saldos do Dia" continuam prioritários).
        const genericByCivilDate =
          await loadFallbackGenericManualBalanceSumByCivilDate(
            prisma,
            accountIds,
            settlementWindowFromCivilDate,
            periodTo
          );
        for (const [civilDate, value] of genericByCivilDate) {
          if (informedClosingByCivilDate.has(civilDate)) continue;
          informedClosingByCivilDate.set(civilDate, value);
        }
      }

      // Acumula saldo desde a gênese ANTES de cortar pelo período filtrado —
      // senão um filtro de março recomeçaria a soma do zero em março e
      // perderia o efeito de janeiro/fevereiro. O saldo informado sobrepõe o
      // calculado e re-ancora a cadeia a partir dali.
      const realizedDays = applyTreasuryCaixaRunningBalance(realizedDaysAll, {
        informedClosingByCivilDate,
      }).filter((d) => d.civilDate >= periodFrom && d.civilDate <= periodTo);

      // Atrasados são ESTOQUE: o que está vencido hoje, independente do período
      // filtrado. Por isso carrega com status "overdue" e sem recorte de data —
      // filtrar por período esconderia atraso antigo, que é o mais grave.
      const overdueFilters = { status: "overdue" } as const;
      const [arOverdue, apOverdue] = await Promise.all([
        loadFinanceArManagementRowsFromPrisma(
          prisma,
          overdueFilters,
          referenceDate
        ),
        loadFinanceApManagementRowsFromPrisma(
          prisma,
          overdueFilters,
          referenceDate
        ),
      ]);
      const overdue = buildTreasuryCaixaOverdue({
        receivables: buildFinanceAccountsReceivableRulesResult(arOverdue.rows, {
          referenceDate,
          syncCutoff: arOverdue.syncCutoff,
          filters: overdueFilters,
        }).gridRows,
        payables: buildFinanceAccountsPayableRulesResult(apOverdue.rows, {
          referenceDate,
          syncCutoff: apOverdue.syncCutoff,
          filters: overdueFilters,
        }).gridRows,
      });

      // Estimativa mensal por vencimento, para TODO o período pedido — mesma
      // regra e mesmas fontes (arEffectiveRows/apLoaded.rows, já em memória,
      // sem round-trip extra) do "Linha do tempo mensal" do Fluxo de Caixa.
      // O front usa isso para complementar meses que a agenda/projeção
      // materializada (capada em 90 dias) ainda não cobre — sem isso, "tudo"
      // (ano inteiro) parava no mês corrente.
      const monthlyDueEstimates = resolveTreasuryCaixaMonthlyEstimateRanges(
        dueDateFrom,
        dueDateTo
      ).map(({ monthKey, monthStart, monthEnd }) => ({
        monthKey,
        estimatedInflow: sumOfficialArOpenDueInPeriod(
          arEffectiveRows,
          monthStart,
          monthEnd
        ),
        estimatedOutflow: sumOfficialApOpenDueInPeriod(
          apLoaded.rows,
          monthStart,
          monthEnd
        ),
      }));

      // Estimativa DIÁRIA por vencimento — mesmas fontes/regra do mensal
      // acima, agrupada por dia civil numa passada só (soma dos dias do mês
      // = soma oficial do mês, mesma partição). Dia sem movimento fica fora
      // do payload. O front encadeia o saldo dia a dia a partir do último
      // caixa conhecido — informar o caixa de hoje re-ancora toda a cadeia.
      const arDueByDay = sumOfficialArOpenDueByCivilDay(arEffectiveRows);
      const apDueByDay = sumOfficialApOpenDueByCivilDay(apLoaded.rows);
      const dailyDueEstimates = [
        ...new Set([...arDueByDay.keys(), ...apDueByDay.keys()]),
      ]
        .filter((civilDate) => civilDate >= periodFrom && civilDate <= periodTo)
        .sort()
        .map((civilDate) => ({
          civilDate,
          estimatedInflow: arDueByDay.get(civilDate) ?? 0,
          estimatedOutflow: apDueByDay.get(civilDate) ?? 0,
        }));

      // Motor único-de-dia canônico: seis dimensões disjuntas por dia
      // (a receber / recebido / a pagar / pago / outras entradas / outras
      // saídas), com as listas de títulos que compõem cada total. Fonte para
      // "Movimento de hoje" e drill-down do dia — sem cálculo paralelo no
      // frontend, sem recarregar o banco (usa as MESMAS grids que já foram
      // montadas acima). Outros movimentos (ledger/transferência) ficam de
      // fora aqui — o service canônico de fechamento (`/today/closing`) já
      // carrega ledger/transfer para HOJE; a extensão para dias arbitrários
      // fica para uma iteração futura, quando a rotina cobrir dias passados.
      const windowDays: string[] = [];
      {
        const cursor = new Date(dueDateFrom);
        const end = new Date(dueDateTo);
        while (cursor <= end) {
          windowDays.push(toIsoDate(cursor));
          cursor.setDate(cursor.getDate() + 1);
        }
      }
      // Saldo inicial da janela canônica: fechamento REALIZADO do último dia
      // conhecido anterior ao primeiro dia da janela. Reaproveita `realizedDaysAll`
      // (já com running balance encadeado desde a gênese), sem consulta nova.
      // Sem histórico anterior → null, que emite warning `NO_OPENING_BALANCE`
      // no primeiro dia canônico (indisponível ≠ zero falso).
      const firstWindowDay = windowDays[0] ?? null;
      let openingBalanceOfFirstDay: number | null = null;
      if (firstWindowDay) {
        for (let i = realizedDaysAll.length - 1; i >= 0; i -= 1) {
          const rd = realizedDaysAll[i]!;
          if (rd.civilDate < firstWindowDay && rd.closing != null) {
            openingBalanceOfFirstDay = rd.closing;
            break;
          }
        }
      }

      // Âncora oficial de saldo de HOJE — a mais confiável dentre as fontes
      // disponíveis (fechamento CLOSED → snapshots do dia → snapshots
      // genéricos → availableBalance do Nomus). Sem ela o motor caía na
      // cadeia calculada desde a gênese (fragil, começa em zero, ignora
      // aportes/transferências sem título).
      const todayCivilDate = todayTreasuryCivilDateInSaoPaulo();
      const officialToday = await loadTreasuryOfficialTodayBalance(
        prisma,
        todayCivilDate
      );

      const anchor =
        officialToday.amount != null &&
        windowDays.some((d) => d === todayCivilDate)
          ? {
              civilDate: todayCivilDate,
              amount: officialToday.amount,
              sourceLabel: officialToday.sourceLabel,
              strength: officialTodayStrength(officialToday.source),
              accountsPartial: officialToday.accountsWithoutBalance > 0,
            }
          : null;

      const canonicalDays = buildTreasuryCaixaCanonicalDays({
        civilDatesInWindow: windowDays,
        receivables: arResult.gridRows,
        payables: apResult.gridRows,
        // Ledger/transfer não são consultados para dias arbitrários (a rotina
        // guiada só cobre HOJE). Marca explicitamente para a UI mostrar aviso
        // em vez de fingir que "outras entradas/saídas" foi carregado.
        otherMovementsLoadStatus: "not_loaded",
        openingBalanceOfFirstDay,
        officialTodayBalance: anchor,
      });

      return {
        period,
        dueDateFrom: toIsoDate(dueDateFrom),
        dueDateTo: toIsoDate(dueDateTo),
        totals,
        realizedDays,
        overdue,
        receivables: arResult.gridRows,
        payables: apResult.gridRows,
        monthlyDueEstimates,
        dailyDueEstimates,
        canonicalDays,
        officialTodayBalance: officialToday,
      };
    },
  };
}

/**
 * Classifica a força da fonte da âncora oficial. STRONG = fechamento
 * imutável; MEDIUM = snapshots informados manualmente; WEAK = snapshot
 * automático do Nomus, que pode não bater centavo com um extrato conciliado.
 */
function officialTodayStrength(
  source: TreasuryOfficialTodayBalance["source"]
): "STRONG" | "MEDIUM" | "WEAK" {
  if (source === "DAILY_CLOSING") return "STRONG";
  if (source === "DAILY_ROUTINE_SNAPSHOT" || source === "GENERIC_MANUAL_SNAPSHOT") return "MEDIUM";
  return "WEAK";
}
