/**
 * Serviço — saldos iniciais guiados do dia (lote).
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { civilDateToLocalDate, toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  todayTreasuryCivilDateInSaoPaulo,
  type TreasuryCivilDate,
} from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryGuidedDailyOpeningSaveResultDto,
  TreasuryGuidedDailyOpeningWorkspaceDto,
} from "../contracts/treasuryDto.js";
import { parseTreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import { buildTreasuryCreatedAudit } from "../treasuryAuditHelpers.js";
import {
  canTreasuryActorMutateAccountBalance,
  canTreasuryActorViewAccountBalance,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  TREASURY_GUIDED_DAILY_OPENING_NEXT_STEP_HREF,
  buildTreasuryGuidedDailyOpeningWorkspace,
  planTreasuryGuidedDailyOpeningSaveItem,
  type TreasuryGuidedDailyOpeningAccountSeed,
  type TreasuryGuidedDailyOpeningSaveItemInput,
} from "../domain/treasuryGuidedDailyOpeningRules.js";
import { parseTreasuryDailyRoutineSnapshotKey } from "../domain/treasuryDailyAccountRoutineRules.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBalanceRepository,
  type TreasuryBalanceDb,
  type TreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.server.js";
import { toTreasuryBalanceSnapshotDto } from "../mappers/treasuryBalanceMappers.js";
import {
  writeTreasuryAuditLog,
  type TreasuryAuditDb,
} from "./treasuryAuditService.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

type Tx = TreasuryAuditDb & TreasuryBalanceDb;

export type TreasuryGuidedDailyOpeningActor = TreasuryAccountActor & {
  canViewToday: boolean;
};

export function buildTreasuryGuidedDailyOpeningActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryGuidedDailyOpeningActor {
  return {
    userId: user.id,
    userName: user.name,
    role: user.role,
    sessionId: user.sessionId,
    requestId,
    isSuperAdmin: user.role === "SUPER_ADMIN",
    canViewAccounts: canTreasuryCapability(user, "viewAccounts"),
    canManageAccounts: canTreasuryCapability(user, "manageAccounts"),
    canManageBalances: canTreasuryCapability(user, "manageBalances"),
    canViewToday:
      canTreasuryCapability(user, "viewDashboard") ||
      user.role === "SUPER_ADMIN",
  };
}

function money(value: { toFixed(d: number): string } | string): string {
  return normalizeTreasuryMoneyString(
    typeof value === "string" ? value : value.toFixed(2)
  );
}

function actorCtx(actor: TreasuryGuidedDailyOpeningActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

async function loadPreviousClosedByAccount(
  prisma: PrismaClient,
  accountIds: string[],
  beforeCivilDate: TreasuryCivilDate
): Promise<
  Map<
    string,
    { closingId: string; civilDate: string; observedBalance: string }
  >
> {
  const map = new Map<
    string,
    { closingId: string; civilDate: string; observedBalance: string }
  >();
  if (accountIds.length === 0) return map;

  const rows = await prisma.treasuryDailyClosingAccountPosition.findMany({
    where: {
      accountId: { in: accountIds },
      closing: {
        status: "CLOSED",
        civilDate: { lt: civilDateToLocalDate(beforeCivilDate) },
      },
    },
    include: {
      closing: { select: { id: true, civilDate: true, version: true } },
    },
    orderBy: [
      { closing: { civilDate: "desc" } },
      { closing: { version: "desc" } },
    ],
  });

  for (const row of rows) {
    if (map.has(row.accountId)) continue;
    const civil = toCivilDateKey(row.closing.civilDate);
    if (!civil) continue;
    map.set(row.accountId, {
      closingId: row.closing.id,
      civilDate: civil,
      observedBalance: money(row.observedBalance),
    });
  }
  return map;
}

async function loadCurrentOpeningsByAccount(
  prisma: PrismaClient,
  accountIds: string[],
  civilDate: TreasuryCivilDate
): Promise<Map<string, { amount: string; version: number }>> {
  const map = new Map<string, { amount: string; version: number }>();
  if (accountIds.length === 0) return map;

  const prefix = `daily-opening:${civilDate}:`;
  const rows = await prisma.treasuryBalanceSnapshot.findMany({
    where: {
      accountId: { in: accountIds },
      origin: "MANUAL",
      cancelledAt: null,
      idempotencyKey: { startsWith: prefix },
    },
    orderBy: { createdAt: "desc" },
  });

  for (const row of rows) {
    if (map.has(row.accountId)) continue;
    const parsed = parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey);
    if (!parsed || parsed.kind !== "opening" || parsed.civilDate !== civilDate) {
      continue;
    }
    map.set(row.accountId, {
      amount: money(row.availableBalance),
      version: parsed.version,
    });
  }
  return map;
}

export type TreasuryGuidedDailyOpeningService = {
  getWorkspace(
    actor: TreasuryGuidedDailyOpeningActor,
    query: { date?: string | null }
  ): Promise<TreasuryGuidedDailyOpeningWorkspaceDto>;
  saveOpenings(
    actor: TreasuryGuidedDailyOpeningActor,
    input: {
      civilDate?: string | null;
      items: TreasuryGuidedDailyOpeningSaveItemInput[];
    }
  ): Promise<TreasuryGuidedDailyOpeningSaveResultDto>;
};

export function createTreasuryGuidedDailyOpeningService(deps: {
  prisma: PrismaClient;
  accountRepository?: TreasuryAccountRepository;
  balanceRepository?: TreasuryBalanceRepository;
  runTransaction?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}): TreasuryGuidedDailyOpeningService {
  const prisma = deps.prisma;
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma);
  const balanceRepo =
    deps.balanceRepository ?? createTreasuryBalanceRepository(prisma);

  async function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma.$transaction(async (tx) => fn(tx as Tx));
  }

  async function buildSeeds(
    actor: TreasuryGuidedDailyOpeningActor,
    civilDate: TreasuryCivilDate
  ): Promise<TreasuryGuidedDailyOpeningAccountSeed[]> {
    const accounts = await prisma.treasuryFinancialAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 200,
    });

    const visible: typeof accounts = [];
    for (const acc of accounts) {
      const access = await accountRepo.findAccess(acc.id, actor.userId);
      if (!canTreasuryActorViewAccountBalance(actor, access)) continue;
      visible.push(acc);
    }

    const ids = visible.map((a) => a.id);
    const [previous, openings] = await Promise.all([
      loadPreviousClosedByAccount(prisma, ids, civilDate),
      loadCurrentOpeningsByAccount(prisma, ids, civilDate),
    ]);

    return visible.map((acc) => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      bank: acc.institutionName ?? null,
      isActive: acc.isActive,
      previousClosedPosition: previous.get(acc.id) ?? null,
      currentOpening: openings.get(acc.id) ?? null,
    }));
  }

  return {
    async getWorkspace(actor, query) {
      if (!actor.canViewToday && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar saldos iniciais da Tesouraria."
        );
      }
      const civilDate =
        query.date == null || query.date === ""
          ? todayTreasuryCivilDateInSaoPaulo()
          : parseTreasuryCivilDate(query.date, "date");

      const seeds = await buildSeeds(actor, civilDate);
      return buildTreasuryGuidedDailyOpeningWorkspace({
        civilDate,
        asOf: new Date(),
        accounts: seeds,
      });
    },

    async saveOpenings(actor, input) {
      if (!actor.canManageBalances && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para informar saldos iniciais."
        );
      }
      if (!Array.isArray(input.items) || input.items.length === 0) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Informe ao menos uma conta para salvar.",
          "items"
        );
      }

      const civilDate =
        input.civilDate == null || input.civilDate === ""
          ? todayTreasuryCivilDateInSaoPaulo()
          : parseTreasuryCivilDate(input.civilDate, "civilDate");

      const todayCivil = todayTreasuryCivilDateInSaoPaulo();
      if (civilDate > todayCivil) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Não é possível informar saldo de dias futuros.",
          "civilDate"
        );
      }
      if (civilDate < todayCivil && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Somente SUPER_ADMIN pode alterar saldos de dias passados. A alteração fica no log.",
          "civilDate"
        );
      }

      const seeds = await buildSeeds(actor, civilDate);
      const seedById = new Map(seeds.map((s) => [s.accountId, s]));
      const recordedAt = new Date();

      const planned = input.items.map((item) => {
        const seed = seedById.get(item.accountId);
        if (!seed) {
          throw new TreasuryDomainError(
            "NOT_FOUND",
            "Conta não encontrada ou sem acesso para saldo inicial.",
            "accountId"
          );
        }
        return {
          item,
          seed,
          plan: planTreasuryGuidedDailyOpeningSaveItem({
            seed,
            civilDate,
            item,
            actorUserId: actor.userId,
            recordedAt,
          }),
        };
      });

      for (const row of planned) {
        const access = await accountRepo.findAccess(
          row.seed.accountId,
          actor.userId
        );
        if (!canTreasuryActorMutateAccountBalance(actor, access)) {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            `Sem permissão para informar saldo da conta ${row.seed.accountName}.`,
            "accountId"
          );
        }
      }

      const saved = await runInTransaction(async (tx) => {
        const results: TreasuryGuidedDailyOpeningSaveResultDto["items"] = [];

        for (const row of planned) {
          const existing = await balanceRepo.findByIdempotency(
            row.seed.accountId,
            "MANUAL",
            row.plan.snapshotIdempotencyKey,
            tx
          );
          if (existing) {
            results.push({
              accountId: row.seed.accountId,
              openingBalance: money(existing.availableBalance),
              version: row.plan.next.version,
              origin: String(row.plan.next.openingBalance?.origin ?? "MANUAL"),
              snapshotId: existing.id,
              created: false,
            });
            continue;
          }

          const previous = await balanceRepo.findLatest(row.seed.accountId, tx);
          const created = await balanceRepo.create(
            {
              accountId: row.seed.accountId,
              referenceAt: recordedAt,
              availableBalance: row.plan.next.openingBalance!.amount,
              blockedBalance: "0.00",
              investmentsBalance: "0.00",
              usedLimit: "0.00",
              origin: "MANUAL",
              idempotencyKey: row.plan.snapshotIdempotencyKey,
              notes: row.item.notes?.trim() || null,
              attachmentUrl: null,
              createdByUserId: actor.userId,
              previousSnapshotId: previous?.id ?? null,
            },
            tx
          );
          const dto = toTreasuryBalanceSnapshotDto(created);

          await writeTreasuryAuditLog(
            tx,
            buildTreasuryCreatedAudit({
              entityType: "DAILY_OPENING",
              entityId: `${row.seed.accountId}:${civilDate}`,
              after: {
                ...row.plan.audit.afterJson,
                snapshotId: created.id,
                difference: row.plan.difference,
                justificationCode: row.plan.justificationCode,
              },
              metadata: {
                civilDate,
                accountId: row.seed.accountId,
                action: row.plan.audit.action,
                origin: row.plan.audit.origin,
                previousValue: row.plan.audit.previousValue,
                newValue: row.plan.audit.newValue,
              },
              justification: row.plan.audit.reason,
              actor: actorCtx(actor),
            })
          );

          await writeTreasuryAuditLog(
            tx,
            buildTreasuryCreatedAudit({
              entityType: "BALANCE_SNAPSHOT",
              entityId: created.id,
              after: dto,
              justification:
                row.plan.audit.reason ?? "Saldo inicial do dia informado",
              actor: actorCtx(actor),
            })
          );

          results.push({
            accountId: row.seed.accountId,
            openingBalance: row.plan.next.openingBalance!.amount,
            version: row.plan.next.version,
            origin: String(row.plan.next.openingBalance?.origin ?? "MANUAL"),
            snapshotId: created.id,
            created: true,
          });
        }

        return results;
      });

      return {
        ok: true,
        civilDate,
        savedCount: saved.length,
        items: saved,
        nextStepHref: TREASURY_GUIDED_DAILY_OPENING_NEXT_STEP_HREF,
      };
    },
  };
}
