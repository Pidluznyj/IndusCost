/**
 * Service — aba "Caixa" da Tesouraria.
 * Zero regra de negócio própria: carrega via loaders canônicos e monta o
 * resultado com os motores oficiais (financeAccountsReceivable/PayableRulesEngine).
 * Sem agrupar por banco — lista plana de títulos, igual ao motor entrega.
 */

import type { PrismaClient } from "@prisma/client";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.server.js";
import { buildFinanceAccountsReceivableRulesResult } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import { loadFinanceApManagementRowsFromPrisma } from "@/src/lib/financeAccountsPayableDashboard.js";
import { buildFinanceAccountsPayableRulesResult } from "@/src/lib/financeAccountsPayableRulesEngine.js";
import {
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

      const [arLoaded, apLoaded] = await Promise.all([
        loadFinanceArManagementRowsFromPrisma(
          prisma,
          { status: "all", dueDateFrom, dueDateTo },
          referenceDate
        ),
        loadFinanceApManagementRowsFromPrisma(
          prisma,
          { status: "all", dueDateFrom, dueDateTo },
          referenceDate
        ),
      ]);

      const arResult = buildFinanceAccountsReceivableRulesResult(arLoaded.rows, {
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

      return {
        period,
        dueDateFrom: toIsoDate(dueDateFrom),
        dueDateTo: toIsoDate(dueDateTo),
        totals,
        receivables: arResult.gridRows,
        payables: apResult.gridRows,
      };
    },
  };
}
