/**
 * Query service de Contas a Pagar (Tesouraria) — leitura oficial + complemento.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryPayablesListQuery } from "../contracts/treasurySchemas.js";
import type {
  TreasuryPayableDetailResponse,
  TreasuryPayablesListResponse,
} from "../contracts/treasuryPayableContracts.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import {
  assertPayableFound,
  createTreasuryPayableQueryRepository,
  type TreasuryPayableQueryRepository,
} from "../repositories/treasuryPayableQueryRepository.server.js";

export type TreasuryPayableQueryActor = {
  userId: string;
  role: string;
  isSuperAdmin: boolean;
  canViewPayables: boolean;
};

export function buildTreasuryPayableQueryActor(
  user: AppAuthContext
): TreasuryPayableQueryActor {
  return {
    userId: user.id,
    role: user.role,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewPayables: canTreasuryCapability(user, "viewPayables"),
  };
}

export type TreasuryPayableQueryService = {
  listPayables(
    actor: TreasuryPayableQueryActor,
    query: TreasuryPayablesListQuery,
    referenceDate?: Date
  ): Promise<TreasuryPayablesListResponse>;
  getPayable(
    actor: TreasuryPayableQueryActor,
    titleId: string,
    referenceDate?: Date
  ): Promise<TreasuryPayableDetailResponse["payable"]>;
};

function assertCanView(actor: TreasuryPayableQueryActor) {
  if (!actor.canViewPayables && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para consultar contas a pagar da Tesouraria."
    );
  }
}

export function createTreasuryPayableQueryService(deps: {
  prisma?: PrismaClient;
  repository?: TreasuryPayableQueryRepository;
}): TreasuryPayableQueryService {
  const repository =
    deps.repository ?? createTreasuryPayableQueryRepository(deps.prisma!);

  return {
    async listPayables(actor, query, referenceDate) {
      assertCanView(actor);
      const result = await repository.list(query, referenceDate);
      return {
        ok: true,
        rows: result.rows,
        pagination: result.pagination,
        summary: result.summary,
        sortBy: result.sortBy,
        sortDirection: result.sortDirection,
      };
    },

    async getPayable(actor, titleId, referenceDate) {
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
      assertPayableFound(row);
      return row;
    },
  };
}
