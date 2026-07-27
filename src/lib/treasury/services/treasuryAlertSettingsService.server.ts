/**
 * Serviço — configuração global de alertas da Tesouraria.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryAlertSettingsFields } from "../contracts/treasuryAlertConfig.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { parseTreasuryAlertSettingsInput } from "../domain/treasuryAlertSettingsRules.js";
import {
  createTreasuryAlertSettingsRepository,
  type TreasuryAlertSettingsRepository,
  type TreasuryAlertSettingsRow,
} from "../repositories/treasuryAlertSettingsRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryAlertSettingsDto = TreasuryAlertSettingsFields & {
  id: string;
  updatedAt: string;
  updatedByUserId: string | null;
};

export type TreasuryAlertSettingsActor = {
  userId: string;
  isSuperAdmin: boolean;
  canView: boolean;
  canManage: boolean;
};

export function buildTreasuryAlertSettingsActor(
  user: AppAuthContext
): TreasuryAlertSettingsActor {
  return {
    userId: user.id,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canView:
      canTreasuryCapability(user, "viewDashboard") ||
      canTreasuryCapability(user, "viewExceptions"),
    canManage: canTreasuryCapability(user, "manageExceptions"),
  };
}

function toDto(row: TreasuryAlertSettingsRow): TreasuryAlertSettingsDto {
  return {
    id: row.id,
    alertsEnabled: row.alertsEnabled,
    relevantReceiptMinAmount: row.relevantReceiptMinAmount,
    customerConcentrationTopN: row.customerConcentrationTopN,
    customerConcentrationMinSharePercent:
      row.customerConcentrationMinSharePercent,
    staleBalanceHours: row.staleBalanceHours,
    syncMaxAgeHours: row.syncMaxAgeHours,
    severityByKind: row.severityByKind,
    enabledByKind: row.enabledByKind,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
  };
}

export type TreasuryAlertSettingsService = {
  get(
    actor: TreasuryAlertSettingsActor
  ): Promise<TreasuryAlertSettingsDto>;
  update(
    actor: TreasuryAlertSettingsActor,
    body: Record<string, unknown>
  ): Promise<TreasuryAlertSettingsDto>;
  /** Uso interno (dashboard/agenda) — sem ACL de view. */
  getFields(): Promise<TreasuryAlertSettingsFields>;
};

export function createTreasuryAlertSettingsService(deps: {
  prisma?: PrismaClient;
  repository?: TreasuryAlertSettingsRepository;
}): TreasuryAlertSettingsService {
  const repo =
    deps.repository ?? createTreasuryAlertSettingsRepository(deps.prisma!);

  return {
    async get(actor) {
      if (!actor.canView && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar configuração de alertas."
        );
      }
      return toDto(await repo.getOrCreate());
    },

    async update(actor, body) {
      if (!actor.canManage && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para alterar configuração de alertas."
        );
      }
      const fields = parseTreasuryAlertSettingsInput(body);
      return toDto(await repo.save(fields, actor.userId));
    },

    async getFields() {
      const row = await repo.getOrCreate();
      return {
        alertsEnabled: row.alertsEnabled,
        relevantReceiptMinAmount: row.relevantReceiptMinAmount,
        customerConcentrationTopN: row.customerConcentrationTopN,
        customerConcentrationMinSharePercent:
          row.customerConcentrationMinSharePercent,
        staleBalanceHours: row.staleBalanceHours,
        syncMaxAgeHours: row.syncMaxAgeHours,
        severityByKind: row.severityByKind,
        enabledByKind: row.enabledByKind,
      };
    },
  };
}
