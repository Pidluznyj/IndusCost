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
import { sumFinanceArReceivedBySettlementInPeriod } from "@/src/lib/financeAccountsReceivableDashboard.js";
import {
  loadFinanceApManagementRowsFromPrisma,
  sumFinanceApPaidInPaymentPeriod,
} from "@/src/lib/financeAccountsPayableDashboard.js";
import { buildFinanceAccountsPayableRulesResult } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import { enrichFinanceCashFlowArLoadBundle } from "@/src/lib/finance/financeCashFlowEffectiveAr.server.js";
import { buildFinanceCashFlowEffectiveArPortfolio } from "@/src/lib/finance/financeCashFlowEffectiveAr.js";
import type { FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";
import {
  buildTreasuryCaixaCashBalance,
  computeTreasuryCaixaTotals,
  resolveTreasuryCaixaDueDateRange,
  TREASURY_CAIXA_BASELINE_CIVIL_DATE,
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

      // Saldo em caixa: soma pela data de LIQUIDAÇÃO (baixa/pagamento), não por
      // vencimento — um título vencido em 2025 e pago em 2026 é caixa de 2026.
      // Por isso a carga é sem recorte de vencimento; o recorte é a janela de
      // liquidação [baseline, fim do período].
      const baselineDate = civilDateToLocalDate(TREASURY_CAIXA_BASELINE_CIVIL_DATE);
      const unfilteredFilters = { status: "all" } as const;
      const [arCashLoaded, apCashLoaded] = await Promise.all([
        loadFinanceArManagementRowsFromPrisma(prisma, unfilteredFilters, referenceDate),
        loadFinanceApManagementRowsFromPrisma(prisma, unfilteredFilters, referenceDate),
      ]);
      const cashBalance = buildTreasuryCaixaCashBalance({
        baselineDate: TREASURY_CAIXA_BASELINE_CIVIL_DATE,
        asOfDate: toIsoDate(dueDateTo),
        received: sumFinanceArReceivedBySettlementInPeriod(
          arCashLoaded.rows,
          unfilteredFilters,
          referenceDate,
          arCashLoaded.syncCutoff,
          baselineDate,
          dueDateTo
        ),
        paid: sumFinanceApPaidInPaymentPeriod(
          apCashLoaded.rows,
          unfilteredFilters,
          referenceDate,
          apCashLoaded.syncCutoff,
          baselineDate,
          dueDateTo
        ),
      });

      return {
        period,
        dueDateFrom: toIsoDate(dueDateFrom),
        dueDateTo: toIsoDate(dueDateTo),
        totals,
        cashBalance,
        receivables: arResult.gridRows,
        payables: apResult.gridRows,
      };
    },
  };
}
