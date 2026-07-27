/**
 * Consulta de lotes e movimentos bancários (leitura).
 * ACL por conta: usuário só vê contas autorizadas (anti-IDOR).
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
import {
  canTreasuryActorViewAccountBalance,
  canTreasuryActorViewAllAccounts,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  toTreasuryBankImportBatchDto,
  toTreasuryBankMovementDto,
  type TreasuryBankImportBatchMappedRow,
  type TreasuryBankMovementMappedRow,
} from "../mappers/treasuryBankMovementMappers.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBankMovementRepository,
  type TreasuryBankMovementRepository,
} from "../repositories/treasuryBankMovementRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryBankMovementQueryActor = TreasuryAccountActor & {
  canViewReconciliation: boolean;
  canManageReconciliation: boolean;
};

export function buildTreasuryBankMovementQueryActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryBankMovementQueryActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    // Conciliação implica leitura das contas com ACL explícita (anti-IDOR).
    canViewAccounts:
      canTreasuryCapability(user, "viewAccounts") ||
      canTreasuryCapability(user, "viewReconciliation") ||
      canTreasuryCapability(user, "manageReconciliation"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
    canManageBalances: canTreasuryCapability(user, "manageBalances"),
    canViewReconciliation:
      canTreasuryCapability(user, "viewReconciliation") ||
      canTreasuryCapability(user, "manageReconciliation"),
    canManageReconciliation: canTreasuryCapability(user, "manageReconciliation"),
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
  if (bucket === "DUPLICATES") return [];
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

async function resolveAuthorizedAccountIds(
  actor: TreasuryBankMovementQueryActor,
  accountRepo: TreasuryAccountRepository,
  requestedAccountId: string | null | undefined
): Promise<string[]> {
  const listed = await accountRepo.list({
    companyCode: null,
    isActive: true,
    sortBy: "sortOrder",
    sortDirection: "asc",
    page: 1,
    pageSize: 200,
    accessibleByUserId: canTreasuryActorViewAllAccounts(actor)
      ? null
      : actor.userId,
  });

  const authorized: string[] = [];
  for (const acc of listed.rows) {
    const accessRow = await accountRepo.findAccess(acc.id, actor.userId);
    const access = accessRow
      ? {
          userId: accessRow.userId,
          accessLevel: accessRow.accessLevel as "VIEW" | "OPERATE" | "MANAGE",
          isActive: accessRow.isActive,
          revokedAt: accessRow.revokedAt,
          canViewBalance: accessRow.canViewBalance,
          canMutateBalance: accessRow.canMutateBalance,
        }
      : null;
    if (canTreasuryActorViewAccountBalance(actor, access)) {
      authorized.push(acc.id);
    }
  }

  if (requestedAccountId?.trim()) {
    const id = requestedAccountId.trim();
    if (!authorized.includes(id)) {
      throw new TreasuryDomainError(
        "FORBIDDEN",
        "Sem acesso à conta financeira solicitada.",
        "accountId"
      );
    }
    return [id];
  }

  return authorized;
}

export function createTreasuryBankMovementQueryService(deps: {
  prisma: PrismaClient;
  movementRepo?: TreasuryBankMovementRepository;
  accountRepository?: TreasuryAccountRepository;
}): TreasuryBankMovementQueryService {
  const movementRepo =
    deps.movementRepo ?? createTreasuryBankMovementRepository(deps.prisma);
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(deps.prisma);

  return {
    async listBatches(actor, query) {
      requireView(actor);
      const accountIds = await resolveAuthorizedAccountIds(
        actor,
        accountRepo,
        query.accountId
      );
      if (!accountIds.length) {
        return {
          items: [],
          pagination: buildTreasuryPaginationMeta({
            page: query.page,
            pageSize: query.pageSize,
            totalRows: 0,
          }),
        };
      }
      const result = await movementRepo.listBatches({
        companyCode: query.companyCode,
        accountId: query.accountId,
        accountIds,
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
      const accountIds = await resolveAuthorizedAccountIds(
        actor,
        accountRepo,
        query.accountId
      );
      if (!accountIds.length) {
        return {
          items: [],
          pagination: buildTreasuryPaginationMeta({
            page: query.page,
            pageSize: query.pageSize,
            totalRows: 0,
          }),
          duplicatesNotPersisted: false,
          message: null,
        };
      }
      const statuses = statusesForBucket(
        query.bucket,
        query.reconciliationStatus
      );
      const result = await movementRepo.listMovements({
        companyCode: query.companyCode,
        accountId: query.accountId,
        accountIds,
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
      const authorized = await resolveAuthorizedAccountIds(
        actor,
        accountRepo,
        null
      );
      if (!authorized.includes(row.accountId)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem acesso ao movimento bancário solicitado.",
          "id"
        );
      }
      return toTreasuryBankMovementDto(row as TreasuryBankMovementMappedRow);
    },
  };
}
