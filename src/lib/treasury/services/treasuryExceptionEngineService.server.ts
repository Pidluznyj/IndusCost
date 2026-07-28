/**
 * Orquestra o motor de exceções: gera/atualiza candidatos e
 * auto-resolve apenas quando o plano marca como seguro.
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryExceptionDto } from "../contracts/treasuryDto.js";
import {
  runTreasuryExceptionEngine,
  type TreasuryExceptionEngineInput,
  type TreasuryExceptionEngineResult,
  TREASURY_EXCEPTION_ALGORITHM_VERSION,
} from "../domain/treasuryExceptionEngine.js";
import { TREASURY_OPEN_EXCEPTION_STATUSES } from "../contracts/treasuryEnums.js";
import {
  createTreasuryExceptionService,
  type TreasuryExceptionActor,
  type TreasuryExceptionService,
} from "./treasuryExceptionService.server.js";

export type TreasuryExceptionEngineApplyResult = {
  algorithmVersion: typeof TREASURY_EXCEPTION_ALGORITHM_VERSION;
  engine: TreasuryExceptionEngineResult;
  upserted: TreasuryExceptionDto[];
  autoResolved: TreasuryExceptionDto[];
};

export type TreasuryExceptionEngineService = {
  /**
   * Planeja a partir dos fatos (puro) — não persiste.
   */
  plan(
    input: Omit<TreasuryExceptionEngineInput, "openExceptions"> & {
      openExceptions?: TreasuryExceptionEngineInput["openExceptions"];
    }
  ): TreasuryExceptionEngineResult;
  /**
   * Carrega causas abertas da empresa, executa o motor e aplica
   * upserts + auto-resolves seguros.
   */
  runAndApply(
    actor: TreasuryExceptionActor,
    input: Omit<TreasuryExceptionEngineInput, "openExceptions">
  ): Promise<TreasuryExceptionEngineApplyResult>;
};

export function createTreasuryExceptionEngineService(deps: {
  prisma?: PrismaClient;
  exceptionService?: TreasuryExceptionService;
}): TreasuryExceptionEngineService {
  const exceptionService =
    deps.exceptionService ??
    createTreasuryExceptionService({ prisma: deps.prisma! });

  return {
    plan(input) {
      return runTreasuryExceptionEngine(input);
    },

    async runAndApply(actor, input) {
      const listed = await exceptionService.list(actor, {
        companyCode: input.companyCode,
        status: null,
        statuses: [...TREASURY_OPEN_EXCEPTION_STATUSES],
        type: null,
        severity: null,
        responsibleUserId: null,
        search: null,
        sortBy: "detectedAt",
        sortDirection: "desc",
        page: 1,
        pageSize: 5000,
      });
      const openItems: TreasuryExceptionDto[] = listed.items;

      const engine = runTreasuryExceptionEngine({
        ...input,
        openExceptions: openItems.map((e) => ({
          id: e.id,
          uniqueKey: e.uniqueKey,
          type: e.type,
          status: e.status,
          version: e.version,
        })),
      });

      const upserted: TreasuryExceptionDto[] = [];
      for (const c of engine.plan.upserts) {
        const result = await exceptionService.upsertByUniqueKey(actor, {
          companyCode: input.companyCode,
          uniqueKey: c.uniqueKey,
          type: c.type,
          severity: c.severity,
          entityKind: c.entityKind,
          entityId: c.entityId,
          accountId: c.accountId,
          nomusExternalId: c.nomusExternalId,
          title: c.title,
          description: c.description,
          amount: c.amount,
          detectedAt: input.detectedAtIso,
          dueAt: c.dueAt,
          responsibleUserId: c.responsibleUserId,
          metadata: {
            ...c.metadata,
            algorithmVersion: engine.algorithmVersion,
            detectedAtIso: input.detectedAtIso,
          },
        });
        upserted.push(result.exception);
      }

      const autoResolved: TreasuryExceptionDto[] = [];
      for (const r of engine.plan.autoResolves) {
        const resolved = await exceptionService.resolve(actor, r.id, {
          expectedVersion: r.version,
          resolution: r.resolution,
        });
        autoResolved.push(resolved);
      }

      return {
        algorithmVersion: engine.algorithmVersion,
        engine,
        upserted,
        autoResolved,
      };
    },
  };
}
