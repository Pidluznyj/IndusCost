/**
 * Serviço — relatórios da Tesouraria.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { TreasuryReportDto } from "../contracts/treasuryDto.js";
import type { TreasuryReportQuery } from "../contracts/treasurySchemas.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import { buildTreasuryReportDto } from "../domain/treasuryReportRules.js";
import {
  canTreasuryActorViewAccountBalance,
  canTreasuryActorViewAllAccounts,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryReportRepository,
  resolveTreasuryReportCompanyCode,
  type TreasuryReportRepository,
} from "../repositories/treasuryReportRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";

export type TreasuryReportActor = TreasuryAccountActor & {
  canViewReports: boolean;
};

export function buildTreasuryReportActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryReportActor {
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
    canViewReports: canTreasuryCapability(user, "viewReports"),
  };
}

export type TreasuryReportService = {
  getReport(
    actor: TreasuryReportActor,
    query: TreasuryReportQuery
  ): Promise<TreasuryReportDto>;
};

export function createTreasuryReportService(deps: {
  prisma?: PrismaClient;
  accountRepository?: TreasuryAccountRepository;
  reportRepository?: TreasuryReportRepository;
}): TreasuryReportService {
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(deps.prisma!);
  const reportRepo =
    deps.reportRepository ?? createTreasuryReportRepository(deps.prisma!);

  return {
    async getReport(actor, query) {
      if (!actor.canViewReports && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar relatórios da Tesouraria."
        );
      }

      const listed = await accountRepo.list({
        companyCode: query.companyCode,
        isActive: true,
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

      const authorized: typeof accounts = [];
      for (const acc of accounts) {
        const accessRow = await accountRepo.findAccess(acc.id, actor.userId);
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
          authorized.push(acc);
        }
      }

      const authorizedAccountIds = authorized.map((a) => a.id);
      const companyCode = resolveTreasuryReportCompanyCode(query.companyCode);

      const facts = await reportRepo.loadFacts({
        reportKey: query.reportKey,
        from: query.from,
        to: query.to,
        accountIds: authorizedAccountIds,
        scenario: query.scenario,
        companyCode,
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        severity: query.severity,
        search: query.search,
      });

      return buildTreasuryReportDto({
        reportKey: query.reportKey,
        from: query.from,
        to: query.to,
        accountIds: query.accountIds,
        authorizedAccountIds,
        scenario: query.scenario,
        filters: {
          companyCode,
          status: query.status,
          severity: query.severity,
          search: query.search,
          scenario: query.scenario,
        },
        buckets: facts.buckets,
        rows: facts.rows,
        totalRows: facts.totalRows,
        page: query.page,
        pageSize: query.pageSize,
        paginate: facts.paginate,
        extras: facts.extras,
        totalsAmountOverride: facts.totalsAmountOverride,
        totalsCountOverride: facts.totalsCountOverride,
      });
    },
  };
}
