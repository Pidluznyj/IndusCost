/**
 * Orquestrador do Apoio ao Caixa (CS-006) — a única camada com I/O.
 *
 * Compõe os três serviços oficiais já existentes (nenhum é reimplementado):
 *   - treasuryCaixaService.getBoard        → canonicalDays
 *   - treasuryBankMovementQueryService     → movimentos bancários (com ACL)
 *   - treasuryReconciliationMatchService   → matches ativos por movimento
 * e entrega o resultado a `buildCashSupportReadModel` (função pura, CS-005).
 *
 * Autenticação/RBAC/ACL/feature flag continuam nas rotas (`treasuryRoutes.ts`),
 * igual ao resto do módulo — este service não decide permissão, só monta dado.
 */

import type { PrismaClient } from "@prisma/client";
import { createTreasuryCaixaService } from "./treasuryCaixaService.server.js";
import {
  buildTreasuryBankMovementQueryActor,
  createTreasuryBankMovementQueryService,
  type TreasuryBankMovementQueryActor,
} from "./treasuryBankMovementQueryService.server.js";
import {
  buildTreasuryReconciliationMatchActor,
  createTreasuryReconciliationMatchService,
  type TreasuryReconciliationMatchActor,
} from "./treasuryReconciliationMatchService.server.js";
import { treasuryCompanyCodePresentWhere } from "../treasuryPrismaFilters.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryReconciliationMatchDto } from "../contracts/treasuryDto.js";
import { buildCashSupportReadModel } from "../domain/cashSupportReadModel.js";
import type {
  CashSupportFilters,
  CashSupportReadModel,
} from "../contracts/cashSupportContracts.js";

export type CashSupportServiceActor = {
  appUser: AppAuthContext;
  requestId: string | null;
};

export type CashSupportService = {
  getReadModel(
    actor: CashSupportServiceActor,
    filters: CashSupportFilters
  ): Promise<CashSupportReadModel>;
};

function civilDateToPeriod(civilDateFrom: string): { year: number; month: number } {
  const [y, m] = civilDateFrom.split("-").map(Number);
  return { year: y!, month: m! };
}

export function createCashSupportService(deps: {
  prisma: PrismaClient;
}): CashSupportService {
  const { prisma } = deps;
  const caixaService = createTreasuryCaixaService({ prisma });
  const bankMovementService = createTreasuryBankMovementQueryService({ prisma });
  const reconciliationService = createTreasuryReconciliationMatchService({ prisma });

  return {
    async getReadModel(actor, filters) {
      const bankActor: TreasuryBankMovementQueryActor = buildTreasuryBankMovementQueryActor(
        actor.appUser,
        actor.requestId ?? undefined
      );
      const reconciliationActor: TreasuryReconciliationMatchActor =
        buildTreasuryReconciliationMatchActor(actor.appUser, actor.requestId ?? undefined);

      const { year, month } = civilDateToPeriod(filters.civilDateFrom);

      const [board, movementsPage, companyAccounts] = await Promise.all([
        caixaService.getBoard({ year, month }),
        bankMovementService.listMovements(bankActor, {
          page: 1,
          pageSize: 200,
          companyCode: filters.companyCode ?? null,
          accountId: filters.accountId ?? null,
          batchId: null,
          bucket: null,
          reconciliationStatus: null,
          search: filters.search ?? null,
          from: filters.civilDateFrom,
          to: filters.civilDateTo,
        }),
        prisma.treasuryFinancialAccount.findMany({
          where: { isActive: true, ...treasuryCompanyCodePresentWhere() },
          select: { companyCode: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      ]);

      // Mesma resolução monoempresa do board (treasuryCaixaService.server.ts) —
      // não é recalculada por regra nova, só reutilizada aqui.
      const companyCode = companyAccounts[0]?.companyCode?.trim() || null;

      const activeMatchesByMovementId = new Map<
        string,
        readonly TreasuryReconciliationMatchDto[]
      >();
      // N+1 aceitável para o volume de uma página (≤200) — documentado como
      // limitação de escala em 13-full-implementation-checklist.md; otimizar
      // com uma query em lote fica para pós-MVP se o volume exigir.
      await Promise.all(
        movementsPage.items.map(async (movement) => {
          const matches = await reconciliationService.listActiveByBankMovement(
            reconciliationActor,
            movement.id
          );
          if (matches.length > 0) {
            activeMatchesByMovementId.set(movement.id, matches);
          }
        })
      );

      return buildCashSupportReadModel({
        canonicalDays: board.canonicalDays,
        companyCode,
        bankMovements: movementsPage.items,
        activeMatchesByMovementId,
        filters,
        analysisAsOfDateTime: new Date().toISOString(),
      });
    },
  };
}
