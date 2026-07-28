/**
 * Serviço — experiência guiada “Tesouraria de hoje”.
 * Agrega dashboard + preview de fechamento (opcional) em um único payload.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryGuidedTodayDto } from "../contracts/treasuryDto.js";
import type { TreasuryDashboardQuery } from "../contracts/treasurySchemas.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  buildTreasuryGuidedTodayExperience,
  type TreasuryGuidedTodayAccountMeta,
} from "../domain/treasuryGuidedTodayRules.js";
import {
  buildTreasuryDashboardActor,
  createTreasuryDashboardService,
  type TreasuryDashboardActor,
  type TreasuryDashboardService,
} from "./treasuryDashboardService.server.js";
import {
  buildTreasuryDailyClosingPreviewActor,
  createTreasuryDailyClosingPreviewService,
  type TreasuryDailyClosingPreviewService,
} from "./treasuryDailyClosingPreviewService.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryGuidedTodayActor = {
  userId: string;
  canViewToday: boolean;
  isSuperAdmin: boolean;
  dashboardActor: TreasuryDashboardActor;
  rawUser: AppAuthContext;
};

export function buildTreasuryGuidedTodayActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryGuidedTodayActor {
  return {
    userId: user.id,
    canViewToday:
      canTreasuryCapability(user, "viewDashboard") ||
      user.role === "SUPER_ADMIN",
    isSuperAdmin: user.role === "SUPER_ADMIN",
    dashboardActor: buildTreasuryDashboardActor(user, requestId),
    rawUser: user,
  };
}

export type TreasuryGuidedTodayService = {
  getToday(
    actor: TreasuryGuidedTodayActor,
    query: TreasuryDashboardQuery
  ): Promise<TreasuryGuidedTodayDto>;
};

async function loadAccountMeta(
  prisma: PrismaClient | undefined,
  accountIds: string[] | null
): Promise<TreasuryGuidedTodayAccountMeta[]> {
  if (!prisma) return [];
  const rows = await prisma.treasuryFinancialAccount.findMany({
    where: {
      isActive: true,
      ...(accountIds?.length ? { id: { in: accountIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      code: true,
      institutionName: true,
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    institutionName: r.institutionName ?? null,
  }));
}

export function createTreasuryGuidedTodayService(deps: {
  prisma?: PrismaClient;
  dashboardService?: TreasuryDashboardService;
  closingPreviewService?: TreasuryDailyClosingPreviewService;
}): TreasuryGuidedTodayService {
  const dashboardService =
    deps.dashboardService ??
    createTreasuryDashboardService({ prisma: deps.prisma });
  const closingPreviewService =
    deps.closingPreviewService ??
    (deps.prisma
      ? createTreasuryDailyClosingPreviewService({ prisma: deps.prisma })
      : null);

  return {
    async getToday(actor, query) {
      if (!actor.canViewToday && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar a Tesouraria de hoje."
        );
      }

      const dashboardPromise = dashboardService.getDailyDashboard(
        actor.dashboardActor,
        query
      );

      const closingPromise = (async () => {
        if (!closingPreviewService) return null;
        try {
          const closingActor = buildTreasuryDailyClosingPreviewActor(
            actor.rawUser
          );
          if (!closingActor.canViewClosing && !closingActor.isSuperAdmin) {
            return null;
          }
          return await closingPreviewService.getPreview(closingActor, {
            date: query.date,
            companyCode: null,
            accountIds: query.accountIds,
          });
        } catch {
          return null;
        }
      })();

      const metaPromise = loadAccountMeta(deps.prisma, query.accountIds);

      const [dashboard, closingPreview, accountMeta] = await Promise.all([
        dashboardPromise,
        closingPromise,
        metaPromise,
      ]);

      return buildTreasuryGuidedTodayExperience({
        dashboard,
        closingPreview,
        accountMeta,
      });
    },
  };
}
