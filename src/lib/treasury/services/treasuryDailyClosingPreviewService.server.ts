/**
 * Serviço — preview do fechamento diário da Tesouraria.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "../contracts/treasuryAlertConfig.js";
import type { TreasuryDailyClosingPreviewDto } from "../contracts/treasuryDto.js";
import type { TreasuryDailyClosingPreviewQuery } from "../contracts/treasurySchemas.js";
import { buildTreasuryDailyClosingPreview } from "../domain/treasuryDailyClosingPreviewRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  createTreasuryDailyClosingPreviewFactsRepository,
  type TreasuryDailyClosingPreviewFactsRepository,
} from "../repositories/treasuryDailyClosingPreviewFactsRepository.server.js";
import {
  createTreasuryAlertSettingsService,
  type TreasuryAlertSettingsService,
} from "./treasuryAlertSettingsService.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryDailyClosingPreviewActor = {
  userId: string;
  isSuperAdmin: boolean;
  canViewClosing: boolean;
};

export function buildTreasuryDailyClosingPreviewActor(
  user: AppAuthContext
): TreasuryDailyClosingPreviewActor {
  return {
    userId: user.id,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewClosing: canTreasuryCapability(user, "viewClosing"),
  };
}

export type TreasuryDailyClosingPreviewService = {
  getPreview(
    actor: TreasuryDailyClosingPreviewActor,
    query: TreasuryDailyClosingPreviewQuery
  ): Promise<TreasuryDailyClosingPreviewDto>;
};

export function createTreasuryDailyClosingPreviewService(deps: {
  prisma?: PrismaClient;
  factsRepository?: TreasuryDailyClosingPreviewFactsRepository;
  alertSettingsService?: TreasuryAlertSettingsService;
}): TreasuryDailyClosingPreviewService {
  const factsRepository =
    deps.factsRepository ??
    createTreasuryDailyClosingPreviewFactsRepository(deps.prisma!);
  const alertSettingsService =
    deps.alertSettingsService ??
    createTreasuryAlertSettingsService({ prisma: deps.prisma });

  return {
    async getPreview(actor, query) {
      if (!actor.canViewClosing && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar preview de fechamento diário."
        );
      }

      const settings = await alertSettingsService.getFields().catch(() => ({
        ...DEFAULT_TREASURY_ALERT_SETTINGS,
      }));
      const staleBalanceHours = settings.staleBalanceHours;
      const syncMaxAgeHours = settings.syncMaxAgeHours;

      const facts = await factsRepository.loadPreviewFacts({
        civilDate: query.date,
        companyCode: query.companyCode,
        accountIds: query.accountIds,
        staleBalanceHours,
        syncMaxAgeHours,
      });

      return buildTreasuryDailyClosingPreview(facts);
    },
  };
}
