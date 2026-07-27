/**
 * Serviço — dashboard diário da Tesouraria.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryDashboardDto } from "../contracts/treasuryDto.js";
import type { TreasuryDashboardQuery } from "../contracts/treasurySchemas.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  assertTreasuryDashboardTotalsConsistent,
  buildFreshnessDto,
  buildTreasuryDashboardDto,
} from "../domain/treasuryDashboardRules.js";
import {
  createTreasuryDashboardDayFlowRepository,
  createTreasuryDashboardFreshnessRepository,
  isTreasurySourceStale,
  type TreasuryDashboardDayFlowRepository,
  type TreasuryDashboardFreshnessRepository,
} from "../repositories/treasuryDashboardDayFlowRepository.server.js";
import {
  buildTreasuryFinancialPositionActor,
  createTreasuryFinancialPositionService,
  type TreasuryFinancialPositionActor,
  type TreasuryFinancialPositionService,
} from "./treasuryFinancialPositionService.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";

export type TreasuryDashboardActor = {
  userId: string;
  canViewDashboard: boolean;
  positionActor: TreasuryFinancialPositionActor;
};

export function buildTreasuryDashboardActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryDashboardActor {
  return {
    userId: user.id,
    canViewDashboard: canTreasuryCapability(user, "viewDashboard"),
    positionActor: buildTreasuryFinancialPositionActor(user, requestId),
  };
}

export type TreasuryDashboardService = {
  getDailyDashboard(
    actor: TreasuryDashboardActor,
    query: TreasuryDashboardQuery
  ): Promise<TreasuryDashboardDto>;
};

export function createTreasuryDashboardService(deps: {
  prisma?: PrismaClient;
  positionService?: TreasuryFinancialPositionService;
  dayFlowRepository?: TreasuryDashboardDayFlowRepository;
  freshnessRepository?: TreasuryDashboardFreshnessRepository;
}): TreasuryDashboardService {
  const positionService =
    deps.positionService ??
    createTreasuryFinancialPositionService({ prisma: deps.prisma });
  const dayFlowRepository =
    deps.dayFlowRepository ??
    createTreasuryDashboardDayFlowRepository(deps.prisma!);
  const freshnessRepository =
    deps.freshnessRepository ??
    createTreasuryDashboardFreshnessRepository(deps.prisma!);

  return {
    async getDailyDashboard(actor, query) {
      if (!actor.canViewDashboard && !actor.positionActor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar o dashboard da Tesouraria."
        );
      }

      const asOf = civilDateToLocalDate(query.date);
      // fim do dia civil local para freshness/position
      asOf.setHours(23, 59, 59, 999);

      const [position, dayFlow, freshnessSources] = await Promise.all([
        positionService.getCurrentPosition(actor.positionActor, {
          asOf,
          accountIds: query.accountIds,
        }),
        dayFlowRepository.aggregateDayFlow({
          civilDate: query.date,
          scenario: query.scenario,
          accountIds: query.accountIds,
        }),
        freshnessRepository.loadSources(asOf),
      ]);

      const freshness = buildFreshnessDto({
        asOf: formatTreasuryTimestampIso(asOf),
        sources: freshnessSources.map((s) => ({
          source: s.source,
          label: s.label,
          lastSuccessAt: s.lastSuccessAt
            ? formatTreasuryTimestampIso(s.lastSuccessAt)
            : null,
          isStale: isTreasurySourceStale(s.lastSuccessAt, asOf),
          detail: s.detail,
        })),
      });

      const dto = buildTreasuryDashboardDto({
        civilDate: query.date,
        scenario: query.scenario,
        accountIds: query.accountIds,
        position,
        dayFlow: {
          receivables: dayFlow.receivables,
          payables: dayFlow.payables,
        },
        freshness,
        highPriorityReceivableCount: dayFlow.highPriorityReceivableCount,
        highPriorityPayableCount: dayFlow.highPriorityPayableCount,
      });

      assertTreasuryDashboardTotalsConsistent(dto);
      return dto;
    },
  };
}
