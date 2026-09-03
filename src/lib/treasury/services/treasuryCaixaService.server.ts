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
  type FinanceAccountsReceivableGridRow,
} from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import {
  buildFinanceApPrismaWhere,
  loadFinanceApManagementRowsFromPrisma,
  mapPrismaRowToFinanceApDashboardRow,
  type FinanceApDashboardRow,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import { FINANCE_AP_TITLE_SELECT } from "@/src/lib/financeAccountsPayableTitles.js";
import {
  resolveNomusApReportSyncCutoffFromPrisma,
  type NomusApReportSyncCutoff,
} from "@/src/lib/financeNomusApReportFreshness.js";
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
import { resolveFinanceArEffectiveSettlementDate } from "@/src/lib/financeAccountsReceivableRules.js";
import type { FinanceSettlementReconciliationPolicy } from "@/src/lib/finance/financeSettlementReconciliation.js";
import { FINANCE_SETTLEMENT_RECONCILIATION_LEGACY } from "@/src/lib/finance/financeSettlementReconciliation.js";
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
  resolveTreasuryCaixaCanonicalWindow,
  resolveTreasuryCaixaDueDateRange,
  selectTreasuryCaixaCanonicalPopulation,
  TREASURY_CAIXA_GENESIS_CIVIL_DATE,
  type TreasuryCaixaAccountPositionDto,
  type TreasuryCaixaBoardDto,
  type TreasuryCaixaPeriodInput,
  type TreasuryCaixaRealizedDay,
} from "../domain/treasuryCaixaRules.js";
import type {
  TreasuryDailyBalanceAuthorityDay,
  TreasuryDailyBalanceAuthorityResult,
  TreasuryGenericSnapshotPolicy,
} from "../domain/treasuryDailyBalanceAuthority.js";
import type { TreasuryConsolidatedAccountUniverse } from "./treasuryConsolidatedAccountUniverse.server.js";
import type { TreasuryDailyBalanceEvidence } from "./treasuryDailyBalanceEvidence.server.js";
import { buildTreasuryCaixaCanonicalDays } from "../domain/treasuryCaixaCanonicalDay.js";
import {
  loadTreasuryOfficialTodayBalance,
  type TreasuryOfficialTodayBalance,
} from "./treasuryOfficialTodayBalance.server.js";
import { todayTreasuryCivilDateInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import { createTreasuryScenarioPolicyService } from "./treasuryScenarioPolicyService.server.js";
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
 * dia de `buildTreasuryCaixaRealizedDays` — usando a MESMA autoridade
 * canônica de data efetiva que o motor único-de-dia (`canonicalDay`) e o
 * fluxo de HOJE já usam:
 *
 * - CR entra pela DATA EFETIVA (`resolveFinanceArEffectiveSettlementDate`)
 *   sob a política de conciliação informada — dueDate <= settlementDate <=
 *   dueDate+N dias vira dueDate; além da tolerância, vira a data real da
 *   baixa. `reconciliation` é OBRIGATÓRIO para o CR (não tem default oculto).
 * - CP entra sempre pelo VENCIMENTO (`FINANCE_SETTLEMENT_RECONCILIATION_LEGACY`):
 *   pagamos em dia e a baixa Nomus é frequentemente retroativa — a regra dos
 *   N dias distorce o mês do caixa no pagar. A política de cenário não altera CP.
 * - CP usa `resolveFinanceApRealizedAmount`, cancelados fora;
 * - o dia precisa cair DENTRO do ano do contexto: cada tabela anual do Fluxo
 *   só enxerga títulos daquele ano-vencimento baixados naquele ano.
 *
 * Esta função é exclusiva da Tesouraria > Caixa (não é chamada pela "Linha do
 * tempo mensal" do Fluxo de Caixa, que tem sua própria composição em
 * `financeCashFlowExecutiveSummary.ts`) — mudar a regra aqui não altera
 * aquela tela; as duas autoridades são deliberadamente desacopladas.
 */
export function buildTreasuryCaixaCanonicalRealizedInputs(
  contexts: readonly FinanceCashFlowCanonicalRealizedYearSets[],
  reconciliation: FinanceSettlementReconciliationPolicy
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
      "dueDate" | "settlementDate" | "amountReceived" | "balanceReceivable"
    >[]) {
      const effective = resolveFinanceArEffectiveSettlementDate(
        {
          dueDate: row.dueDate,
          settlementDate: row.settlementDate,
          amountReceived: row.amountReceived,
          balanceReceivable: row.balanceReceivable,
        },
        { reconciliation }
      );
      if (!effective) continue;
      const key = toCivilDateKey(effective);
      if (!key || !key.startsWith(yearPrefix)) continue;
      const amount = Number(row.amountReceived);
      if (!Number.isFinite(amount) || amount === 0) continue;
      receivables.push({ settlementDate: key, amountReceived: amount });
    }

    for (const row of ctx.apPaidRows as readonly FinanceCashFlowApRow[]) {
      if (isFinanceApCancelledTitle(row)) continue;
      // CP: sempre vencimento — independente da política de conciliação do CR.
      const paidAt = resolveFinanceApEffectivePaymentDate(row, {
        reconciliation: FINANCE_SETTLEMENT_RECONCILIATION_LEGACY,
      });
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

/**
 * CP LIQUIDADO dentro da janela, com VENCIMENTO fora dela — a metade que
 * `loadFinanceApManagementRowsFromPrisma` (escopado só por `dueDate`) não
 * enxerga. Sem esta consulta, um título vencido muito antes da janela mas
 * pago DENTRO dela (ou vencendo bem depois mas pago antecipadamente dentro
 * dela) fica invisível ao motor canônico — mesmo contribuindo
 * financeiramente para um dos dias da janela (regra dos N dias:
 * `effectiveSettlementDate` pode ser a data da baixa, não o vencimento).
 *
 * Consulta ESCOPADA pela janela (settlementDate OU paymentDate dentro dela)
 * — nunca a história inteira da empresa. `status: "settled"` restringe a
 * títulos com baixa (balancePayable <= 0); título em aberto não tem data de
 * liquidação para comparar.
 */
async function loadTreasuryCaixaApSettledOutsideDueWindow(
  prisma: PrismaClient,
  windowFrom: Date,
  windowToExclusive: Date,
  syncCutoff: NomusApReportSyncCutoff | null
): Promise<FinanceApDashboardRow[]> {
  const baseWhere = buildFinanceApPrismaWhere(
    { status: "settled", suspendPayment: "all" },
    syncCutoff
  );
  const rows = await prisma.nomusAccountsPayable.findMany({
    where: {
      AND: [
        baseWhere,
        {
          OR: [
            { settlementDate: { gte: windowFrom, lt: windowToExclusive } },
            { paymentDate: { gte: windowFrom, lt: windowToExclusive } },
          ],
        },
      ],
    },
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return rows.map(mapPrismaRowToFinanceApDashboardRow);
}

/** Dedup por `externalId` — a mesma linha pode ter vindo de duas consultas (vencimento e liquidação). */
function dedupeFinanceApRowsByExternalId(
  rows: readonly FinanceApDashboardRow[]
): FinanceApDashboardRow[] {
  const byId = new Map<number, FinanceApDashboardRow>();
  for (const row of rows) byId.set(row.externalId, row);
  return [...byId.values()];
}

export function createTreasuryCaixaService(input: {
  prisma: PrismaClient;
}): TreasuryCaixaService {
  const { prisma } = input;

  return {
    async getBoard(period) {
      const { dueDateFrom, dueDateTo } = resolveTreasuryCaixaDueDateRange(period);
      const referenceDate = new Date();

      // Política de conciliação — carregada uma única vez aqui (não depende
      // de AR/AP) e reusada por TODOS os regimes da Timeline (Realizado via
      // `buildTreasuryCaixaCanonicalRealizedInputs` mais abaixo, e o motor
      // único-de-dia `canonicalDays`): a mesma autoridade de data efetiva
      // rege passado E hoje, sem duas fontes de verdade. Sem
      // política/ausência do singleton → LEGACY (comportamento histórico).
      const policyService = createTreasuryScenarioPolicyService({ prisma });
      const policy = await policyService.getForEngine();
      const reconciliationPolicy: FinanceSettlementReconciliationPolicy = {
        enabled: policy.settlementReconciliationEnabled,
        toleranceDays: policy.settlementReconciliationToleranceDays,
      };

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

      // Passado da linha do tempo: MESMA população de títulos (CR/CP) que a
      // "Linha do tempo mensal" do Fluxo de Caixa carrega, ano a ano da
      // gênese até o ano filtrado. CR usa a regra dos N dias
      // (`reconciliationPolicy`); CP ancora sempre no vencimento (baixa Nomus
      // retroativa não desloca o mês). As duas telas (Tesouraria vs Fluxo)
      // permanecem autoridades DESACOPLADAS: o que é comum é a POPULAÇÃO; o
      // consumo (data efetiva do CR, vencimento do CP) continua só daqui.
      //
      // A população canônica é sempre carregada pelo próprio loader — inclusive
      // no ano filtrado. O `arRows` do board é carregado só por vencimento
      // (a carteira aberta não pode receber as linhas da janela de baixa), então
      // reusá-lo aqui devolveria uma população menor que a da tela de Fluxo e
      // quebraria a paridade. Custo: uma consulta AR a mais por render.
      const chainYears = resolveTreasuryCaixaChainYears(period.year);
      const canonicalContexts: FinanceCashFlowCanonicalRealizedYearSets[] = [];
      for (const year of chainYears) {
        canonicalContexts.push(
          await loadFinanceCashFlowCanonicalRealizedYearSets(
            prisma,
            year,
            referenceDate
          )
        );
      }
      const periodFrom = toIsoDate(dueDateFrom);
      const periodTo = toIsoDate(dueDateTo);
      const realizedDaysAll = buildTreasuryCaixaRealizedDays(
        buildTreasuryCaixaCanonicalRealizedInputs(
          canonicalContexts,
          reconciliationPolicy
        )
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

      // Âncora oficial de saldo de HOJE — mesma precedência que o motor
      // único-de-dia consome. Carregada aqui (e não depois) para também
      // re-ancorar a cadeia da Linha do tempo mensal / gráfico de saldo
      // por mês, que é montada por `applyTreasuryCaixaRunningBalance`.
      // Sem esta injeção, a linha do tempo mensal e os cenários apresentam
      // saldos divergentes para o mesmo dia (a linha do tempo reconstruía
      // do zero desde a gênese, ignorando o saldo real no banco).
      const todayCivilDate = todayTreasuryCivilDateInSaoPaulo();
      const officialToday = await loadTreasuryOfficialTodayBalance(
        prisma,
        todayCivilDate
      );
      // Só injeta se ainda não houver fonte mais forte para o dia (a
      // precedência foi resolvida por `loadTreasuryOfficialTodayBalance`,
      // e os mapas anteriores — TreasuryDailyClosing CLOSED e snapshots —
      // podem já ter posto valor). Prevalência coerente com a precedência
      // canônica: CLOSED > rotina > genérico > Nomus.
      if (
        officialToday.amount != null &&
        !informedClosingByCivilDate.has(todayCivilDate)
      ) {
        informedClosingByCivilDate.set(todayCivilDate, officialToday.amount);
      }

      // Acumula saldo desde a gênese ANTES de cortar pelo período filtrado —
      // senão um filtro de março recomeçaria a soma do zero em março e
      // perderia o efeito de janeiro/fevereiro. O saldo informado sobrepõe o
      // calculado e re-ancora a cadeia a partir dali. Agora com a âncora
      // oficial de HOJE, a cadeia mensal converge com o gráfico dos cenários.
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

      // HOJE tem que existir SEMPRE no motor único-de-dia — a regra
      // financeira não pode depender do filtro Ano/Mês/Dia da tela.
      const canonicalWindow = resolveTreasuryCaixaCanonicalWindow({
        windowDays,
        todayCivilDate,
      });
      const canonicalWindowDays = canonicalWindow.canonicalWindowDays;
      const canonicalWindowRange = {
        fromCivilDate: canonicalWindow.widenedFromCivilDate,
        toCivilDate: canonicalWindow.widenedToCivilDate,
      };
      const canonicalWindowFromDate = civilDateToLocalDate(
        canonicalWindow.widenedFromCivilDate
      );
      const canonicalWindowToExclusiveDate = new Date(
        civilDateToLocalDate(canonicalWindow.widenedToCivilDate).getTime() +
          24 * 60 * 60 * 1000
      );
      const todayYear = Number(todayCivilDate.slice(0, 4));

      // POPULAÇÃO RELEVANTE = vencimento na janela OU liquidação na janela
      // (nunca só vencimento) — um título vencido bem antes da janela mas
      // baixado DENTRO dela (ou vencendo bem depois mas baixado
      // antecipadamente dentro dela) contribui financeiramente para um dos
      // dias da janela mesmo sem vencer nela. `selectTreasuryCaixaCanonicalPopulation`
      // aplica a mesma regra e deduplica por identidade oficial (o título
      // pode ter vindo das duas metades da união).
      //
      // AR: `arEffectiveRows`/`todayArEffectiveRows` já cobrem o ANO INTEIRO
      // (sem recorte por mês/dia) — a união devolve o mesmo custo de round-trip
      // de antes; só o filtro final muda (vencimento OU baixa, não só vencimento).
      const arRowsForCanonical: FinanceAccountsReceivableGridRow[] = [
        ...buildFinanceAccountsReceivableRulesResult(arEffectiveRows, {
          referenceDate,
          syncCutoff: arLoaded.syncCutoff,
          filters: { status: "all" },
        }).gridRows,
      ];
      if (todayYear !== period.year) {
        const todayArLoaded = await loadFinanceArManagementRowsFromPrisma(
          prisma,
          { status: "all", year: todayYear },
          referenceDate
        );
        const todayArRows = todayArLoaded.rows as FinanceCashFlowArRow[];
        const { orderContexts: todayOrderContexts, nfeOrderLinks: todayNfeOrderLinks } =
          await enrichFinanceCashFlowArLoadBundle(prisma, todayArRows, referenceDate);
        const todayArEffectiveRows = buildFinanceCashFlowEffectiveArPortfolio({
          rows: todayArRows,
          filters: { status: "all", year: todayYear },
          orderContexts: todayOrderContexts,
          nfeOrderLinks: todayNfeOrderLinks,
          referenceDate,
          syncCutoff: todayArLoaded.syncCutoff,
        });
        arRowsForCanonical.push(
          ...buildFinanceAccountsReceivableRulesResult(todayArEffectiveRows, {
            referenceDate,
            syncCutoff: todayArLoaded.syncCutoff,
            filters: { status: "all" },
          }).gridRows
        );
      }
      const canonicalReceivables = selectTreasuryCaixaCanonicalPopulation(
        arRowsForCanonical,
        canonicalWindowRange,
        (row) => (row.amountReceived > 0 ? row.settlementDate : null)
      );

      // AP: duas consultas escopadas pela MESMA janela — vencimento na janela
      // (a carga oficial já usada por `apResult`/etc., sem recorte extra) UNIDA
      // com liquidação na janela sem exigir vencimento na janela
      // (`loadTreasuryCaixaApSettledOutsideDueWindow`). Nenhuma das duas busca
      // a história inteira da empresa — ambas escopadas em [from, toExclusive).
      const apSyncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(prisma);
      const [apDueWindowLoaded, apSettledOutsideDueWindow] = await Promise.all([
        loadFinanceApManagementRowsFromPrisma(
          prisma,
          {
            status: "all",
            dueDateFrom: canonicalWindowFromDate,
            dueDateTo: civilDateToLocalDate(canonicalWindow.widenedToCivilDate),
          },
          referenceDate
        ),
        loadTreasuryCaixaApSettledOutsideDueWindow(
          prisma,
          canonicalWindowFromDate,
          canonicalWindowToExclusiveDate,
          apSyncCutoff
        ),
      ]);
      const apRowsForCanonical = dedupeFinanceApRowsByExternalId([
        ...apDueWindowLoaded.rows,
        ...apSettledOutsideDueWindow,
      ]);
      const apGridRowsForCanonical = buildFinanceAccountsPayableRulesResult(
        apRowsForCanonical,
        { referenceDate, syncCutoff: apSyncCutoff, filters: { status: "all" } }
      ).gridRows;
      const canonicalPayables = selectTreasuryCaixaCanonicalPopulation(
        apGridRowsForCanonical,
        canonicalWindowRange,
        (row) =>
          row.amountPaid > 0 ? (row.paymentDate ?? row.settlementDate ?? null) : null
      );

      // Saldo inicial da janela canônica: fechamento REALIZADO do último dia
      // conhecido anterior ao primeiro dia da janela. Reaproveita `realizedDaysAll`
      // (já com running balance encadeado desde a gênese), sem consulta nova.
      // Sem histórico anterior → null, que emite warning `NO_OPENING_BALANCE`
      // no primeiro dia canônico (indisponível ≠ zero falso).
      const firstWindowDay = canonicalWindowDays[0] ?? null;
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

      // Âncora oficial já foi carregada acima (linha ~561) para injetar no
      // running balance da Linha do tempo mensal. Reusa a mesma instância
      // aqui — o motor único-de-dia também re-ancora no dia da âncora.
      const anchor =
        officialToday.amount != null &&
        canonicalWindowDays.some((d) => d === todayCivilDate)
          ? {
              civilDate: todayCivilDate,
              amount: officialToday.amount,
              sourceLabel: officialToday.sourceLabel,
              strength: officialTodayStrength(officialToday.source),
              accountsPartial: officialToday.accountsWithoutBalance > 0,
            }
          : null;

      // Política de conciliação já carregada no topo de `getBoard()` — a
      // MESMA instância que corrigiu `realizedDaysAll` alimenta o motor
      // único-de-dia aqui, sem round-trip duplicado nem risco de divergir.
      const canonicalDays = buildTreasuryCaixaCanonicalDays({
        civilDatesInWindow: canonicalWindowDays,
        receivables: canonicalReceivables,
        payables: canonicalPayables,
        // Ledger/transfer não são consultados para dias arbitrários (a rotina
        // guiada só cobre HOJE). Marca explicitamente para a UI mostrar aviso
        // em vez de fingir que "outras entradas/saídas" foi carregado.
        otherMovementsLoadStatus: "not_loaded",
        openingBalanceOfFirstDay,
        officialTodayBalance: anchor,
        reconciliationPolicy,
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

// ───────────────────────────────────────────────────────────────────────────
// Autoridade única de saldos — composição PURA (testável sem banco)
// ───────────────────────────────────────────────────────────────────────────

export type TreasuryCaixaBalanceAuthorityComposeInput = {
  universe: TreasuryConsolidatedAccountUniverse;
  evidence: TreasuryDailyBalanceEvidence;
  /** Realizado consolidado por dia, cru (saída de `buildTreasuryCaixaRealizedDays`). */
  realizedDaysAll: readonly TreasuryCaixaRealizedDay[];
  todayCivilDate: string;
  /** Período exibido (recorte DEPOIS de resolver a cadeia inteira). */
  periodFrom: string;
  periodTo: string;
  /** Realizado/previsto de HOJE vindos do motor único-de-dia (canonicalDays[hoje]). */
  todayRealized: { inflows: number; outflows: number } | null;
  todayPredicted: { inflows: number; outflows: number } | null;
  genesisCivilDate?: string;
  genericSnapshotPolicy?: TreasuryGenericSnapshotPolicy;
};

export type TreasuryCaixaBalanceAuthorityComposeResult = {
  authority: TreasuryDailyBalanceAuthorityResult;
  /** Dias < hoje dentro do período, com saldos/cobertura/proveniência da autoridade. */
  realizedDays: TreasuryCaixaRealizedDay[];
  todayBalance: TreasuryDailyBalanceAuthorityDay | null;
  /** DERIVADO da autoridade: só fechamento informado COMPLETO de hoje ancora. */
  officialTodayBalance: TreasuryOfficialTodayBalance;
  /** Fechamento efetivo do último dia ANTES de `firstWindowDay` (RC4). */
  openingBalanceBefore(firstWindowDay: string): number | null;
  accountPositions: TreasuryCaixaAccountPositionDto[];
};

/**
 * Junta universo + evidências + fluxos numa única resolução de autoridade e
 * projeta tudo que o board publica. `getBoard()` só carrega e delega para cá.
 */
export function composeTreasuryCaixaBalanceAuthority(
  input: TreasuryCaixaBalanceAuthorityComposeInput
): TreasuryCaixaBalanceAuthorityComposeResult {
  void input;
  throw new Error("not implemented: composeTreasuryCaixaBalanceAuthority");
}
