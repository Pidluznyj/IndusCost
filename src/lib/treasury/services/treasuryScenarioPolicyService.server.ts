/**
 * Serviço da política persistida dos cenários da Caixa — server-only.
 *
 * Singleton "GLOBAL" em TreasuryScenarioPolicy. Alterações são versionadas
 * (version++) e auditadas via TreasuryAuditLog (entityType "MODULE",
 * entityId "SCENARIO_POLICY:GLOBAL"). O motor dos cenários lê essa política
 * antes de projetar — nunca embute default no código sem o par persistido.
 */

import type { PrismaClient, TreasuryScenarioPolicy } from "@prisma/client";
import {
  TREASURY_SCENARIO_POLICY_DEFAULTS,
  TREASURY_SCENARIO_POLICY_SINGLETON_ID,
  assertValidTreasuryScenarioPolicyPatch,
  type TreasuryScenarioPolicyDto,
  type TreasuryScenarioPolicyPatch,
} from "../contracts/treasuryScenarioPolicyContracts.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { writeTreasuryAuditLog } from "./treasuryAuditService.server.js";
import { buildTreasuryUpdatedAudit } from "../treasuryAuditHelpers.js";

export type TreasuryScenarioPolicyActor = {
  userId: string | null;
  userName?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  canView: boolean;
  canManage: boolean;
  isSuperAdmin: boolean;
};

export type TreasuryScenarioPolicyService = {
  /** Leitura para admin (exige canView). */
  get(actor: TreasuryScenarioPolicyActor): Promise<TreasuryScenarioPolicyDto>;
  /** Alteração — exige canManage; versão incrementa; audita. */
  update(
    actor: TreasuryScenarioPolicyActor,
    patch: TreasuryScenarioPolicyPatch
  ): Promise<TreasuryScenarioPolicyDto>;
  /**
   * Uso interno pelo motor dos cenários — sem ACL de view (é o motor que
   * decide o cenário; a política é premissa). Retorna defaults quando o
   * singleton ainda não existe (setup novo antes da migration rodar).
   */
  getForEngine(): Promise<TreasuryScenarioPolicyDto>;
};

function toDto(row: TreasuryScenarioPolicy): TreasuryScenarioPolicyDto {
  return {
    id: TREASURY_SCENARIO_POLICY_SINGLETON_ID,
    pessimisticEnabled: row.pessimisticEnabled,
    optimisticReceivableAdvanceLimitDays: row.optimisticReceivableAdvanceLimitDays,
    optimisticPayableDelayLimitDays: row.optimisticPayableDelayLimitDays,
    pessimisticReceivableDelayDays: row.pessimisticReceivableDelayDays,
    pessimisticOverdueReceivableDelayDays:
      row.pessimisticOverdueReceivableDelayDays,
    pessimisticTreatBrokenPromiseAsDelayed: row.pessimisticTreatBrokenPromiseAsDelayed,
    useCustomerBehaviorHistory: row.useCustomerBehaviorHistory,
    useSupplierBehaviorHistory: row.useSupplierBehaviorHistory,
    version: row.version,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    updatedByUserId: row.updatedByUserId,
  };
}

function fallbackDefaultsDto(): TreasuryScenarioPolicyDto {
  const now = new Date();
  const iso = formatTreasuryTimestampIso(now);
  return {
    id: TREASURY_SCENARIO_POLICY_SINGLETON_ID,
    ...TREASURY_SCENARIO_POLICY_DEFAULTS,
    version: 0,
    updatedAt: iso,
    createdAt: iso,
    updatedByUserId: null,
  };
}

async function getOrCreate(
  prisma: PrismaClient
): Promise<TreasuryScenarioPolicy> {
  const existing = await prisma.treasuryScenarioPolicy.findUnique({
    where: { id: TREASURY_SCENARIO_POLICY_SINGLETON_ID },
  });
  if (existing) return existing;
  return prisma.treasuryScenarioPolicy.create({
    data: { id: TREASURY_SCENARIO_POLICY_SINGLETON_ID },
  });
}

function auditPayload(row: TreasuryScenarioPolicy) {
  return {
    pessimisticEnabled: row.pessimisticEnabled,
    optimisticReceivableAdvanceLimitDays: row.optimisticReceivableAdvanceLimitDays,
    optimisticPayableDelayLimitDays: row.optimisticPayableDelayLimitDays,
    pessimisticReceivableDelayDays: row.pessimisticReceivableDelayDays,
    pessimisticOverdueReceivableDelayDays: row.pessimisticOverdueReceivableDelayDays,
    pessimisticTreatBrokenPromiseAsDelayed: row.pessimisticTreatBrokenPromiseAsDelayed,
    useCustomerBehaviorHistory: row.useCustomerBehaviorHistory,
    useSupplierBehaviorHistory: row.useSupplierBehaviorHistory,
    version: row.version,
  };
}

export function createTreasuryScenarioPolicyService(deps: {
  prisma: PrismaClient;
}): TreasuryScenarioPolicyService {
  const prisma = deps.prisma;

  return {
    async get(actor) {
      if (!actor.canView && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar a política de cenários da Caixa."
        );
      }
      const row = await getOrCreate(prisma);
      return toDto(row);
    },

    async update(actor, patch) {
      if (!actor.canManage && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para alterar a política de cenários da Caixa."
        );
      }
      assertValidTreasuryScenarioPolicyPatch(patch);

      const before = await getOrCreate(prisma);
      const after = await prisma.treasuryScenarioPolicy.update({
        where: { id: TREASURY_SCENARIO_POLICY_SINGLETON_ID },
        data: {
          ...patch,
          version: { increment: 1 },
          updatedByUserId: actor.userId,
        },
      });

      await writeTreasuryAuditLog(
        prisma,
        buildTreasuryUpdatedAudit({
          entityType: "MODULE",
          entityId: `SCENARIO_POLICY:${TREASURY_SCENARIO_POLICY_SINGLETON_ID}`,
          before: auditPayload(before),
          after: auditPayload(after),
          justification:
            "Política de cenários da Caixa atualizada — afeta somente projeções futuras.",
          actor: {
            userId: actor.userId,
            userName: actor.userName ?? null,
            sessionId: actor.sessionId ?? null,
            requestId: actor.requestId ?? null,
          },
        })
      );

      return toDto(after);
    },

    async getForEngine() {
      try {
        const row = await getOrCreate(prisma);
        return toDto(row);
      } catch {
        // Setup novo antes da migration rodar; motor não trava.
        return fallbackDefaultsDto();
      }
    },
  };
}
