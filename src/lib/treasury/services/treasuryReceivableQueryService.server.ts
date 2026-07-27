/**
 * Query service de Contas a Receber (Tesouraria) — leitura oficial + complemento.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryReceivablesListQuery } from "../contracts/treasurySchemas.js";
import type {
  TreasuryReceivableDetailResponse,
  TreasuryReceivablesListResponse,
} from "../contracts/treasuryReceivableContracts.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  assertReceivableFound,
  createTreasuryReceivableQueryRepository,
  type TreasuryReceivableQueryRepository,
} from "../repositories/treasuryReceivableQueryRepository.server.js";

export type TreasuryReceivableQueryActor = {
  userId: string;
  role: string;
  isSuperAdmin: boolean;
  canViewReceivables: boolean;
};

export function buildTreasuryReceivableQueryActor(
  user: AppAuthContext
): TreasuryReceivableQueryActor {
  return {
    userId: user.id,
    role: user.role,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReceivables: canTreasuryCapability(user, "viewReceivables"),
  };
}

export type TreasuryReceivableQueryService = {
  listReceivables(
    actor: TreasuryReceivableQueryActor,
    query: TreasuryReceivablesListQuery,
    referenceDate?: Date
  ): Promise<TreasuryReceivablesListResponse>;
  getReceivable(
    actor: TreasuryReceivableQueryActor,
    titleId: string,
    referenceDate?: Date
  ): Promise<TreasuryReceivableDetailResponse["receivable"]>;
};

function assertCanView(actor: TreasuryReceivableQueryActor) {
  if (!actor.canViewReceivables && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar contas a receber da Tesouraria."
    );
  }
}

export function createTreasuryReceivableQueryService(deps: {
  prisma?: PrismaClient;
  repository?: TreasuryReceivableQueryRepository;
}): TreasuryReceivableQueryService {
  const repository =
    deps.repository ??
    createTreasuryReceivableQueryRepository(deps.prisma!);

  return {
    async listReceivables(actor, query, referenceDate) {
      assertCanView(actor);
      const result = await repository.list(query, referenceDate);
      return {
        ok: true,
        rows: result.rows,
        pagination: result.pagination,
        sortBy: result.sortBy,
        sortDirection: result.sortDirection,
      };
    },

    async getReceivable(actor, titleId, referenceDate) {
      assertCanView(actor);
      const id = titleId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "titleId é obrigatório.",
          "titleId"
        );
      }
      const row = await repository.getByTitleId(id, referenceDate);
      assertReceivableFound(row);
      return row;
    },
  };
}
