/**
 * Serviço — saldos finais guiados + preparação do fechamento formal.
 * Persiste em TreasuryBalanceSnapshot (daily-closing-bank); fecha via TreasuryDailyClosing.
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { civilDateToLocalDate, toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  todayTreasuryCivilDateInSaoPaulo,
  type TreasuryCivilDate,
  parseTreasuryCivilDate,
} from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryDailyClosingPreviewDto,
  TreasuryGuidedDailyClosingSaveResultDto,
  TreasuryGuidedDailyClosingWorkspaceDto,
} from "../contracts/treasuryDto.js";
import { buildTreasuryCreatedAudit } from "../treasuryAuditHelpers.js";
import {
  canTreasuryActorMutateAccountBalance,
  canTreasuryActorViewAccountBalance,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  TREASURY_GUIDED_DAILY_CLOSING_NEXT_STEP_HREF,
  buildTreasuryGuidedDailyClosingWorkspace,
  planTreasuryGuidedDailyClosingSaveItem,
  type TreasuryGuidedDailyClosingAccountSeed,
  type TreasuryGuidedDailyClosingSaveItemInput,
} from "../domain/treasuryGuidedDailyClosingRules.js";
import {
  emptyTreasuryDailyAccountRoutineDayFlow,
  parseTreasuryDailyRoutineSnapshotKey,
  type TreasuryDailyAccountRoutineDayFlow,
} from "../domain/treasuryDailyAccountRoutineRules.js";
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
import { treasuryCompanyCodePresentWhere } from "../treasuryPrismaFilters.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  buildTreasuryDailyClosingPreviewActor,
  createTreasuryDailyClosingPreviewService,
  type TreasuryDailyClosingPreviewService,
} from "./treasuryDailyClosingPreviewService.server.js";

type Tx = TreasuryAuditDb & TreasuryBalanceDb;

export type TreasuryGuidedDailyClosingActor = TreasuryAccountActor & {
  canViewToday: boolean;
  canViewClosing: boolean;
  rawUser: AppAuthContext;
};

export function buildTreasuryGuidedDailyClosingActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryGuidedDailyClosingActor {
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
    canViewClosing:
      canTreasuryCapability(user, "viewClosing") ||
      user.role === "SUPER_ADMIN",
    rawUser: user,
  };
}

function money(value: { toFixed(d: number): string } | string | null | undefined): string {
  if (value == null) return "0.00";
  return normalizeTreasuryMoneyString(
    typeof value === "string" ? value : value.toFixed(2)
  );
}

function actorCtx(actor: TreasuryGuidedDailyClosingActor) {
  return {
    userId: actor.userId,
    userName: actor.userName ?? null,
    sessionId: actor.sessionId ?? null,
    requestId: actor.requestId ?? null,
  };
}

async function loadRoutineBalancesByAccount(
  prisma: PrismaClient,
  accountIds: string[],
  civilDate: TreasuryCivilDate,
  kind: "opening" | "closingBank"
): Promise<Map<string, { amount: string; version: number }>> {
  const map = new Map<string, { amount: string; version: number }>();
  if (accountIds.length === 0) return map;
  const prefix =
    kind === "opening"
      ? `daily-opening:${civilDate}:`
      : `daily-closing-bank:${civilDate}:`;
  const rows = await prisma.treasuryBalanceSnapshot.findMany({
    where: {
      accountId: { in: accountIds },
      origin: "MANUAL",
      idempotencyKey: { startsWith: prefix },
    },
    orderBy: { createdAt: "desc" },
  });
  for (const row of rows) {
    if (map.has(row.accountId)) continue;
    const parsed = parseTreasuryDailyRoutineSnapshotKey(row.idempotencyKey);
    if (!parsed || parsed.kind !== kind || parsed.civilDate !== civilDate) {
      continue;
    }
    map.set(row.accountId, {
      amount: money(row.availableBalance),
      version: parsed.version,
    });
  }
  return map;
}

async function loadFormalClosingStatus(
  prisma: PrismaClient,
  civilDate: TreasuryCivilDate
): Promise<"OPEN" | "CLOSED" | "REOPENED" | null> {
  const row = await prisma.treasuryDailyClosing.findFirst({
    where: { civilDate: civilDateToLocalDate(civilDate) },
    orderBy: { version: "desc" },
    select: { status: true },
  });
  if (!row) return null;
  if (row.status === "CLOSED" || row.status === "REOPENED" || row.status === "OPEN") {
    return row.status;
  }
  return null;
}

async function loadDayFlowByAccount(
  prisma: PrismaClient,
  accounts: Array<{ id: string; nomusBankAccountId: string | number | null }>,
  civilDate: TreasuryCivilDate
): Promise<Map<string, TreasuryDailyAccountRoutineDayFlow>> {
  const map = new Map<string, TreasuryDailyAccountRoutineDayFlow>();
  for (const acc of accounts) {
    map.set(acc.id, emptyTreasuryDailyAccountRoutineDayFlow());
  }
  if (accounts.length === 0) return map;

  const accountIds = accounts.map((a) => a.id);
  const nomusToAccount = new Map<number | string, string>();
  for (const acc of accounts) {
    if (acc.nomusBankAccountId != null && acc.nomusBankAccountId !== "") {
      const strVal = String(acc.nomusBankAccountId).trim();
      nomusToAccount.set(strVal, acc.id);
      const parsedId = Number.parseInt(strVal, 10);
      if (Number.isFinite(parsedId)) {
        nomusToAccount.set(parsedId, acc.id);
      }
    }
  }

  const dayStart = civilDateToLocalDate(civilDate);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  const overlays = await prisma.treasuryTitleOperationalComplement.findMany({
    where: {
      cancelledAt: null,
      plannedAccountId: { in: accountIds },
    },
    select: {
      officialTitleId: true,
      titleType: true,
      plannedAccountId: true,
    },
  });
  const overlayAccountByTitle = new Map<string, string>();
  for (const o of overlays) {
    if (o.plannedAccountId) {
      overlayAccountByTitle.set(o.officialTitleId, o.plannedAccountId);
    }
  }

  const arRows = await prisma.nomusAccountsReceivable.findMany({
    where: {
      settlementDate: { gte: dayStart, lt: dayEnd },
      amountReceived: { gt: 0 },
    },
    select: {
      id: true,
      amountReceived: true,
      bankAccountId: true,
    },
    take: 2000,
  });
  for (const row of arRows) {
    const accountId =
      overlayAccountByTitle.get(row.id) ??
      (row.bankAccountId != null
        ? nomusToAccount.get(row.bankAccountId) ?? null
        : null);
    if (!accountId) continue;
    const flow = map.get(accountId);
    if (!flow) continue;
    flow.settledReceivables = addTreasuryMoney(
      flow.settledReceivables,
      money(row.amountReceived)
    );
  }

  const apRows = await prisma.nomusAccountsPayable.findMany({
    where: {
      settlementDate: { gte: dayStart, lt: dayEnd },
      amountPaid: { gt: 0 },
    },
    select: {
      id: true,
      amountPaid: true,
      bankAccountId: true,
    },
    take: 2000,
  });
  for (const row of apRows) {
    const accountId =
      overlayAccountByTitle.get(row.id) ??
      (row.bankAccountId != null
        ? nomusToAccount.get(row.bankAccountId) ?? null
        : null);
    if (!accountId) continue;
    const flow = map.get(accountId);
    if (!flow) continue;
    flow.settledPayables = addTreasuryMoney(
      flow.settledPayables,
      money(row.amountPaid)
    );
  }

  const ledger = await prisma.treasuryLedgerEntry.findMany({
    where: {
      accountId: { in: accountIds },
      civilDate: dayStart,
      status: "ACTIVE",
      transferGroupId: null,
    },
    select: {
      accountId: true,
      amount: true,
      direction: true,
    },
    take: 5000,
  });
  for (const row of ledger) {
    const flow = map.get(row.accountId);
    if (!flow) continue;
    if (row.direction === "CREDIT") {
      flow.realizedLocalInflows = addTreasuryMoney(
        flow.realizedLocalInflows,
        money(row.amount)
      );
    } else {
      flow.realizedLocalOutflows = addTreasuryMoney(
        flow.realizedLocalOutflows,
        money(row.amount)
      );
    }
  }

  const transfers = await prisma.treasuryTransfer.findMany({
    where: {
      cancelledAt: null,
      OR: [
        { fromAccountId: { in: accountIds } },
        { toAccountId: { in: accountIds } },
      ],
      status: { in: ["SENT", "RECEIVED", "RECONCILED"] },
    },
    select: {
      fromAccountId: true,
      toAccountId: true,
      amount: true,
      sentCivilDate: true,
      receivedCivilDate: true,
      civilDate: true,
      status: true,
    },
    take: 2000,
  });
  for (const t of transfers) {
    const sentDate = t.sentCivilDate
      ? toCivilDateKey(t.sentCivilDate)
      : toCivilDateKey(t.civilDate);
    const receivedDate = t.receivedCivilDate
      ? toCivilDateKey(t.receivedCivilDate)
      : toCivilDateKey(t.civilDate);
    if (sentDate === civilDate) {
      const flow = map.get(t.fromAccountId);
      if (flow) {
        flow.realizedTransferOut = addTreasuryMoney(
          flow.realizedTransferOut,
          money(t.amount)
        );
      }
    }
    if (receivedDate === civilDate) {
      const flow = map.get(t.toAccountId);
      if (flow) {
        flow.realizedTransferIn = addTreasuryMoney(
          flow.realizedTransferIn,
          money(t.amount)
        );
      }
    }
  }

  return map;
}

export type TreasuryGuidedDailyClosingService = {
  getWorkspace(
    actor: TreasuryGuidedDailyClosingActor,
    query: { date?: string | null }
  ): Promise<TreasuryGuidedDailyClosingWorkspaceDto>;
  saveFinalBalances(
    actor: TreasuryGuidedDailyClosingActor,
    input: {
      civilDate?: string | null;
      items: TreasuryGuidedDailyClosingSaveItemInput[];
    }
  ): Promise<TreasuryGuidedDailyClosingSaveResultDto>;
};

export function createTreasuryGuidedDailyClosingService(deps: {
  prisma: PrismaClient;
  accountRepository?: TreasuryAccountRepository;
  balanceRepository?: TreasuryBalanceRepository;
  closingPreviewService?: TreasuryDailyClosingPreviewService | null;
  runTransaction?: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
}): TreasuryGuidedDailyClosingService {
  const prisma = deps.prisma;
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(prisma);
  const balanceRepo =
    deps.balanceRepository ?? createTreasuryBalanceRepository(prisma);
  const closingPreviewService =
    deps.closingPreviewService === undefined
      ? createTreasuryDailyClosingPreviewService({ prisma })
      : deps.closingPreviewService;

  async function runInTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (deps.runTransaction) return deps.runTransaction(fn);
    return prisma.$transaction(async (tx) => fn(tx as Tx));
  }

  async function buildSeeds(
    actor: TreasuryGuidedDailyClosingActor,
    civilDate: TreasuryCivilDate
  ): Promise<TreasuryGuidedDailyClosingAccountSeed[]> {
    const accounts = await prisma.treasuryFinancialAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      take: 200,
      select: {
        id: true,
        code: true,
        name: true,
        institutionName: true,
        isActive: true,
        nomusBankAccountId: true,
        companyCode: true,
      },
    });

    const visible: typeof accounts = [];
    for (const acc of accounts) {
      const access = await accountRepo.findAccess(acc.id, actor.userId);
      if (!canTreasuryActorViewAccountBalance(actor, access)) continue;
      visible.push(acc);
    }

    const ids = visible.map((a) => a.id);
    const [openings, closings, dayFlows, formalStatus] = await Promise.all([
      loadRoutineBalancesByAccount(prisma, ids, civilDate, "opening"),
      loadRoutineBalancesByAccount(prisma, ids, civilDate, "closingBank"),
      loadDayFlowByAccount(prisma, visible, civilDate),
      loadFormalClosingStatus(prisma, civilDate),
    ]);

    return visible.map((acc) => ({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      bank: acc.institutionName ?? null,
      companyCode: acc.companyCode ?? null,
      isActive: acc.isActive,
      opening: openings.get(acc.id) ?? null,
      closingBank: closings.get(acc.id) ?? null,
      dayFlow: dayFlows.get(acc.id) ?? emptyTreasuryDailyAccountRoutineDayFlow(),
      formalClosingStatus: formalStatus,
    }));
  }

  async function resolveClosingCompanyCode(
    preferred?: string | null
  ): Promise<string | null> {
    const fromPreferred = preferred?.trim() || "";
    if (fromPreferred) return fromPreferred;
    const row = await prisma.treasuryFinancialAccount.findFirst({
      where: {
        isActive: true,
        ...treasuryCompanyCodePresentWhere(),
      },
      select: { companyCode: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    return row?.companyCode?.trim() || null;
  }

  async function loadPreview(
    actor: TreasuryGuidedDailyClosingActor,
    civilDate: TreasuryCivilDate,
    companyCode: string | null
  ): Promise<TreasuryDailyClosingPreviewDto | null> {
    if (!closingPreviewService) return null;
    if (!actor.canViewClosing && !actor.isSuperAdmin) return null;
    try {
      return await closingPreviewService.getPreview(
        buildTreasuryDailyClosingPreviewActor(actor.rawUser),
        {
          date: civilDate,
          companyCode,
          accountIds: null,
        }
      );
    } catch {
      return null;
    }
  }

  return {
    async getWorkspace(actor, query) {
      if (!actor.canViewToday && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar saldos finais da Tesouraria."
        );
      }
      const civilDate =
        query.date == null || query.date === ""
          ? todayTreasuryCivilDateInSaoPaulo()
          : parseTreasuryCivilDate(query.date, "date");

      const seeds = await buildSeeds(actor, civilDate);
      const companyCode = await resolveClosingCompanyCode(
        seeds.find((s) => s.companyCode)?.companyCode
      );
      const preview = await loadPreview(actor, civilDate, companyCode);

      return buildTreasuryGuidedDailyClosingWorkspace({
        civilDate,
        asOf: new Date(),
        accounts: seeds,
        preview,
      });
    },

    async saveFinalBalances(actor, input) {
      if (!actor.canManageBalances && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para informar saldos finais."
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
            "Conta não encontrada ou sem acesso para saldo final.",
            "accountId"
          );
        }
        return {
          item,
          seed,
          plan: planTreasuryGuidedDailyClosingSaveItem({
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
        const results: TreasuryGuidedDailyClosingSaveResultDto["items"] = [];

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
              informedClosingBalance: money(existing.availableBalance),
              realizedClosingBalance: row.plan.next.realizedClosingBalance!,
              divergence: row.plan.next.divergence!,
              version: row.plan.next.version,
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
              availableBalance: row.plan.next.closingBankBalance!.amount,
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
              entityType: "DAILY_CLOSING",
              entityId: `${row.seed.accountId}:${civilDate}`,
              after: {
                ...row.plan.audit.afterJson,
                snapshotId: created.id,
                realizedClosingBalance: row.plan.next.realizedClosingBalance,
                divergence: row.plan.next.divergence,
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
                row.plan.audit.reason ?? "Saldo final bancário informado",
              actor: actorCtx(actor),
            })
          );

          results.push({
            accountId: row.seed.accountId,
            informedClosingBalance: row.plan.next.closingBankBalance!.amount,
            realizedClosingBalance: row.plan.next.realizedClosingBalance!,
            divergence: row.plan.next.divergence!,
            version: row.plan.next.version,
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
        nextStepHref: TREASURY_GUIDED_DAILY_CLOSING_NEXT_STEP_HREF,
      };
    },
  };
}
