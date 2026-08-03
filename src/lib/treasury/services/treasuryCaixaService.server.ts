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
import {
  buildTreasuryCaixaOverdue,
  buildTreasuryCaixaRealizedDays,
  computeTreasuryCaixaTotals,
  resolveTreasuryCaixaDueDateRange,
  type TreasuryCaixaBoardDto,
  type TreasuryCaixaPeriodInput,
} from "../domain/treasuryCaixaRules.js";

export type TreasuryCaixaService = {
  getBoard(period: TreasuryCaixaPeriodInput): Promise<TreasuryCaixaBoardDto>;
};

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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
      // A janela é limitada de propósito: cobre atraso realista sem varrer a
      // tabela inteira.
      const settlementLoadFilters = {
        status: "all",
        dueDateFrom: civilDateToLocalDate(`${period.year - 1}-01-01`),
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
      const realizedDays = buildTreasuryCaixaRealizedDays({
        receivables: buildFinanceAccountsReceivableRulesResult(arSettled.rows, {
          referenceDate,
          syncCutoff: arSettled.syncCutoff,
          filters: settlementLoadFilters,
        }).gridRows,
        // CP é alocado pelo VENCIMENTO (regra canônica do financeiro): a data de
        // baixa é apenas informativa e o Nomus sequer a preenche.
        payables: buildFinanceAccountsPayableRulesResult(apSettled.rows, {
          referenceDate,
          syncCutoff: apSettled.syncCutoff,
          filters: settlementLoadFilters,
        }).gridRows,
        // Só os dias do período filtrado entram na linha do tempo.
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
