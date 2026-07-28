/**
 * Serviço — posição financeira atual da Tesouraria.
 * Observado (snapshot) ≠ calculado (snapshot + movimentos oficiais) ≠ conciliado.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type { TreasuryFinancialPositionDto } from "../contracts/treasuryDto.js";
import {
  canTreasuryActorViewAccountBalance,
  canTreasuryActorViewAllAccounts,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import {
  computeTreasuryAccountFinancialPosition,
  consolidateTreasuryFinancialPositions,
  type TreasuryPositionAccountInput,
  type TreasuryPositionSnapshotInput,
} from "../domain/treasuryFinancialPositionRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBalanceRepository,
  type TreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.server.js";
import {
  createTreasuryOfficialRealizedMovementRepository,
  type TreasuryOfficialRealizedMovementRepository,
} from "../repositories/treasuryOfficialRealizedMovementRepository.server.js";
import {
  createTreasuryReconciledBalanceRepository,
  type TreasuryReconciledBalanceRepository,
} from "../repositories/treasuryReconciledBalanceRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryFinancialPositionActor = TreasuryAccountActor;

export function buildTreasuryFinancialPositionActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryFinancialPositionActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId: requestId ?? null,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
    canManageBalances: canTreasuryCapability(user, "manageBalances"),
  };
}

export type TreasuryFinancialPositionQuery = {
  companyCode?: string | null;
  asOf?: Date;
  accountIds?: string[] | null;
  includeInactive?: boolean;
};

export type TreasuryFinancialPositionService = {
  getCurrentPosition(
    actor: TreasuryFinancialPositionActor,
    query?: TreasuryFinancialPositionQuery
  ): Promise<TreasuryFinancialPositionDto>;
};

function moneyFromSnapshotField(
  value: { toFixed(digits: number): string } | string | number
): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function createTreasuryFinancialPositionService(deps: {
  prisma?: PrismaClient;
  accountRepository?: TreasuryAccountRepository;
  balanceRepository?: TreasuryBalanceRepository;
  movementRepository?: TreasuryOfficialRealizedMovementRepository;
  reconciledRepository?: TreasuryReconciledBalanceRepository;
}): TreasuryFinancialPositionService {
  const prisma = deps.prisma;
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma!);
  const balanceRepo =
    deps.balanceRepository ?? createTreasuryBalanceRepository(prisma!);
  const movementRepo =
    deps.movementRepository ??
    createTreasuryOfficialRealizedMovementRepository(prisma);
  const reconciledRepo =
    deps.reconciledRepository ??
    createTreasuryReconciledBalanceRepository(prisma);

  return {
    async getCurrentPosition(actor, query = {}) {
      if (!actor.canViewAccounts && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar posição financeira."
        );
      }

      const asOf = query.asOf ?? new Date();
      const listed = await accountRepo.list({
        companyCode: query.companyCode ?? null,
        isActive: query.includeInactive ? null : true,
        sortBy: "sortOrder",
        sortDirection: "asc",
        page: 1,
        pageSize: 200,
        accessibleByUserId: canTreasuryActorViewAllAccounts(actor)
          ? null
          : actor.userId,
      });

      let accounts = listed.rows;
      if (query.accountIds?.length) {
        const wanted = new Set(query.accountIds);
        accounts = accounts.filter((a) => wanted.has(a.id));
      }

      const accountIdsForAcl = accounts.map((a) => a.id);
      const accessRows = canTreasuryActorViewAllAccounts(actor)
        ? []
        : await accountRepo.listAccessForUser(actor.userId, accountIdsForAcl);
      const accessByAccountId = new Map(
        accessRows.map((row) => [row.accountId, row] as const)
      );

      const visible: typeof accounts = [];
      for (const acc of accounts) {
        const accessRow = accessByAccountId.get(acc.id) ?? null;
        const access = accessRow
          ? {
              userId: accessRow.userId,
              accessLevel: accessRow.accessLevel as
                | "VIEW"
                | "OPERATE"
                | "MANAGE",
              isActive: accessRow.isActive,
              revokedAt: accessRow.revokedAt,
              canViewBalance: accessRow.canViewBalance,
              canMutateBalance: accessRow.canMutateBalance,
            }
          : null;
        if (canTreasuryActorViewAccountBalance(actor, access)) {
          visible.push(acc);
        }
      }

      const accountIds = visible.map((a) => a.id);
      const [movements, reconciledHints, latestByAccount] = await Promise.all([
        movementRepo.listByAccountIds({ accountIds, asOf }),
        reconciledRepo.listByAccountIds({ accountIds, asOf }),
        balanceRepo.findLatestByAccountIds(accountIds),
      ]);

      const positions = [];
      for (const acc of visible) {
        const latest = latestByAccount.get(acc.id) ?? null;
        const snapshot: TreasuryPositionSnapshotInput | null = latest
          ? {
              id: latest.id,
              accountId: latest.accountId,
              referenceAt: latest.referenceAt,
              availableBalance: moneyFromSnapshotField(latest.availableBalance),
              blockedBalance: moneyFromSnapshotField(latest.blockedBalance),
              investmentsBalance: moneyFromSnapshotField(
                latest.investmentsBalance
              ),
              usedLimit: moneyFromSnapshotField(latest.usedLimit),
              origin: latest.origin,
            }
          : null;

        const accountInput: TreasuryPositionAccountInput = {
          id: acc.id,
          code: acc.code,
          name: acc.name,
          accountType: String(acc.accountType),
          includeInConsolidated: acc.includeInConsolidated,
          liquidity: acc.liquidity,
          allowNegativeBalance: acc.allowNegativeBalance,
          isActive: acc.isActive,
        };

        positions.push(
          computeTreasuryAccountFinancialPosition({
            account: accountInput,
            snapshot,
            movements: movements.filter((m) => m.accountId === acc.id),
            reconciled:
              reconciledHints.find((r) => r.accountId === acc.id) ?? null,
          })
        );
      }

      const consolidated = consolidateTreasuryFinancialPositions(positions);
      const alerts = [
        ...new Set([
          ...consolidated.alerts,
          ...positions.flatMap((p) => p.alerts),
        ]),
      ];

      return {
        asOf: formatTreasuryTimestampIso(asOf),
        companyCode: query.companyCode ?? null,
        accounts: positions,
        consolidated,
        alerts,
      };
    },
  };
}
