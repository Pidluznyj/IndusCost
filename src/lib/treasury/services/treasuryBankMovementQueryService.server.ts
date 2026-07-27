/**
 * Consulta de lotes e movimentos bancários (leitura).
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildTreasuryPaginationMeta } from "../contracts/treasuryPagination.js";
import type {
  TreasuryBankImportsListQuery,
  TreasuryBankMovementsListQuery,
} from "../contracts/treasurySchemas.js";
import type {
  TreasuryBankImportBatchDto,
  TreasuryBankMovementDto,
} from "../contracts/treasuryDto.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  toTreasuryBankImportBatchDto,
  toTreasuryBankMovementDto,
  type TreasuryBankImportBatchMappedRow,
  type TreasuryBankMovementMappedRow,
} from "../mappers/treasuryBankMovementMappers.js";
import {
  createTreasuryBankMovementRepository,
  type TreasuryBankMovementRepository,
} from "../repositories/treasuryBankMovementRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryBankMovementQueryActor = {
  userId: string;
  role: string;
  isSuperAdmin: boolean;
  canViewReconciliation: boolean;
  canManageReconciliation: boolean;
  requestId?: string | null;
};

export function buildTreasuryBankMovementQueryActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryBankMovementQueryActor {
  return {
    userId: user.id,
    role: user.role,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewReconciliation:
      canTreasuryCapability(user, "viewReconciliation") ||
      canTreasuryCapability(user, "manageReconciliation"),
    canManageReconciliation: canTreasuryCapability(user, "manageReconciliation"),
    requestId: requestId ?? null,
  };
}

function requireView(actor: TreasuryBankMovementQueryActor): void {
  if (!actor.canViewReconciliation && !actor.isSuperAdmin) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Sem permissão para visualizar movimentos bancários."
    );
  }
}

function civilToUtcStart(civil: string | null): Date | null {
  if (!civil) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function civilToUtcEnd(civil: string | null): Date | null {
  const start = civilToUtcStart(civil);
  if (!start) return null;
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

function statusesForBucket(
  bucket: TreasuryBankMovementsListQuery["bucket"],
  explicit: TreasuryBankMovementsListQuery["reconciliationStatus"]
): string[] | null {
  if (explicit) return [explicit];
  if (!bucket) return null;
  if (bucket === "UNRECONCILED") return ["PENDING", "UNMATCHED"];
  if (bucket === "PARTIAL") return ["PARTIAL"];
  if (bucket === "RECONCILED") return ["MATCHED"];
  if (bucket === "DUPLICATES") return []; // empty set → no persisted rows
  return null;
}

export type TreasuryBankMovementQueryService = {
  listBatches(
    actor: TreasuryBankMovementQueryActor,
    query: TreasuryBankImportsListQuery
  ): Promise<{
    items: TreasuryBankImportBatchDto[];
    pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
  }>;
  listMovements(
    actor: TreasuryBankMovementQueryActor,
    query: TreasuryBankMovementsListQuery
  ): Promise<{
    items: TreasuryBankMovementDto[];
    pagination: ReturnType<typeof buildTreasuryPaginationMeta>;
    duplicatesNotPersisted: boolean;
    message: string | null;
  }>;
  getMovement(
    actor: TreasuryBankMovementQueryActor,
    id: string
  ): Promise<TreasuryBankMovementDto>;
};

export function createTreasuryBankMovementQueryService(deps: {
  prisma: PrismaClient;
  movementRepo?: TreasuryBankMovementRepository;
}): TreasuryBankMovementQueryService {
  const movementRepo =
    deps.movementRepo ?? createTreasuryBankMovementRepository(deps.prisma);

  return {
    async listBatches(actor, query) {
      requireView(actor);
      const result = await movementRepo.listBatches({
        companyCode: query.companyCode,
        accountId: query.accountId,
        status: query.status,
        from: civilToUtcStart(query.from),
        to: civilToUtcEnd(query.to),
        page: query.page,
        pageSize: query.pageSize,
      });
      return {
        items: (result.rows as TreasuryBankImportBatchMappedRow[]).map(
          toTreasuryBankImportBatchDto
        ),
        pagination: buildTreasuryPaginationMeta({
          page: query.page,
          pageSize: query.pageSize,
          totalRows: result.totalRows,
        }),
      };
    },

    async listMovements(actor, query) {
      requireView(actor);
      if (query.bucket === "DUPLICATES") {
        return {
          items: [],
          pagination: buildTreasuryPaginationMeta({
            page: query.page,
            pageSize: query.pageSize,
            totalRows: 0,
          }),
          duplicatesNotPersisted: true,
          message:
            "Duplicados não são gravados. Eles aparecem no preview OFX e no resumo do lote após a confirmação.",
        };
      }
      const statuses = statusesForBucket(
        query.bucket,
        query.reconciliationStatus
      );
      const result = await movementRepo.listMovements({
        companyCode: query.companyCode,
        accountId: query.accountId,
        batchId: query.batchId,
        reconciliationStatuses: statuses,
        search: query.search,
        from: civilToUtcStart(query.from),
        to: civilToUtcEnd(query.to),
        page: query.page,
        pageSize: query.pageSize,
      });
      return {
        items: (result.rows as TreasuryBankMovementMappedRow[]).map(
          toTreasuryBankMovementDto
        ),
        pagination: buildTreasuryPaginationMeta({
          page: query.page,
          pageSize: query.pageSize,
          totalRows: result.totalRows,
        }),
        duplicatesNotPersisted: false,
        message: null,
      };
    },

    async getMovement(actor, id) {
      requireView(actor);
      const row = await movementRepo.findMovementById(id.trim());
      if (!row) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Movimento bancário não encontrado.",
          "id"
        );
      }
      return toTreasuryBankMovementDto(row as TreasuryBankMovementMappedRow);
    },
  };
}
