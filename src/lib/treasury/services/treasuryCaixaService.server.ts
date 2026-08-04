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
import { buildFinanceAccountsReceivableRulesResult } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import { loadFinanceApManagementRowsFromPrisma } from "@/src/lib/financeAccountsPayableDashboard.js";
import { buildFinanceAccountsPayableRulesResult } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import { enrichFinanceCashFlowArLoadBundle } from "@/src/lib/finance/financeCashFlowEffectiveAr.server.js";
import { buildFinanceCashFlowEffectiveArPortfolio } from "@/src/lib/finance/financeCashFlowEffectiveAr.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";
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
import {
  parseTreasuryDailyRoutineSnapshotKey,
  TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX,
} from "../domain/treasuryDailyAccountRoutineRules.js";

export type TreasuryCaixaService = {
  getBoard(period: TreasuryCaixaPeriodInput): Promise<TreasuryCaixaBoardDto>;
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

      const totals = computeTreasuryCaixaTotals({
        receivables: arResult.gridRows,
        payables: apResult.gridRows,
      });

      // Passado da linha do tempo: agrupa por data de LIQUIDAÇÃO, não por
      // vencimento — um título vencido antes e pago dentro do período é caixa
      // do período. Por isso a carga aqui abre a janela de vencimento para trás
      // (início do ano anterior) em vez de usar o recorte do filtro; sem isso,
      // pagamento de título atrasado sumiria do dia em que o dinheiro andou.
      // O piso nunca passa da gênese da Caixa: o acumulado de saldo (abaixo)
      // precisa de TODO o histórico desde ali para o "Começou"/"Terminou" não
      // recomeçar do zero no meio do caminho quando o filtro for um ano futuro.
      const settlementWindowFromCivilDate =
        `${period.year - 1}-01-01` < TREASURY_CAIXA_GENESIS_CIVIL_DATE
          ? `${period.year - 1}-01-01`
          : TREASURY_CAIXA_GENESIS_CIVIL_DATE;
      const settlementLoadFilters = {
        status: "all",
        dueDateFrom: civilDateToLocalDate(settlementWindowFromCivilDate),
        dueDateTo,
      } as const;
      const [arSettled, apSettled] = await Promise.all([
        loadFinanceArManagementRowsFromPrisma(
          prisma,
          settlementLoadFilters,
          referenceDate
        ),
        loadFinanceApManagementRowsFromPrisma(
          prisma,
          settlementLoadFilters,
          referenceDate
        ),
      ]);
      const periodFrom = toIsoDate(dueDateFrom);
      const periodTo = toIsoDate(dueDateTo);
      const realizedDaysAll = buildTreasuryCaixaRealizedDays({
        receivables: buildFinanceAccountsReceivableRulesResult(arSettled.rows, {
          referenceDate,
          syncCutoff: arSettled.syncCutoff,
          filters: settlementLoadFilters,
        }).gridRows,
        // CP entra no dia do PAGAMENTO quando o Nomus informa (`paymentDate`);
        // fallback: vencimento (regra canônica do financeiro), pois a baixa de
        // CP raramente vem preenchida da origem.
        payables: buildFinanceAccountsPayableRulesResult(apSettled.rows, {
          referenceDate,
          syncCutoff: apSettled.syncCutoff,
          filters: settlementLoadFilters,
        }).gridRows,
      });
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

      return {
        period,
        dueDateFrom: toIsoDate(dueDateFrom),
        dueDateTo: toIsoDate(dueDateTo),
        totals,
        realizedDays,
        overdue,
        receivables: arResult.gridRows,
        payables: apResult.gridRows,
      };
    },
  };
}
