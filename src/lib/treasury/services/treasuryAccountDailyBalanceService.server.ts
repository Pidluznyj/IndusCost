/**
 * Serviço — leitura leve do saldo inicial/final de UMA conta em UMA data civil.
 *
 * Motivo de existir: o modal de saldos do Caixa edita uma conta, mas só havia
 * as leituras de workspace (`/today/opening` e `/today/closing`), que varrem
 * até 200 contas, checam acesso conta por conta e — no fechamento — ainda
 * carregam CR/CP, ledger, transferências, preview de fechamento e previsão do
 * dia. Nada disso responde “qual saldo já está gravado nesta conta/data?”.
 *
 * Aqui o custo é O(1) em relação ao número de contas da Tesouraria:
 * 1 conta + 1 acesso + 2 leituras de snapshot da conta/data + 1 fechamento
 * anterior. Sem CR/CP, sem preview, sem forecast, sem varredura de contas.
 *
 * Permissões: exatamente as mesmas dos workspaces guiados (nada de bypass).
 */

import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { civilDateToLocalDate, toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  parseTreasuryCivilDate,
  todayTreasuryCivilDateInSaoPaulo,
  type TreasuryCivilDate,
} from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryAccountDailyBalanceDto,
  TreasuryAccountDailyBalanceRoutineKind,
} from "../contracts/treasuryDto.js";
import {
  buildTreasuryAccountDailyBalanceDto,
  type TreasuryDailyRoutineSnapshotRow,
} from "../domain/treasuryAccountDailyBalanceRules.js";
import {
  canTreasuryActorViewAccountBalance,
  type TreasuryAccountActor,
} from "../domain/treasuryAccountRules.js";
import {
  TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX,
  TREASURY_DAILY_OPENING_SNAPSHOT_KEY_PREFIX,
} from "../domain/treasuryDailyAccountRoutineRules.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.server.js";
import {
  createTreasuryBalanceRepository,
  type TreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.server.js";
import { canTreasuryCapability } from "../treasuryPermissions.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryAccountDailyBalanceActor = TreasuryAccountActor & {
  canViewToday: boolean;
};

/** Mesmo actor dos workspaces guiados de abertura/fechamento. */
export function buildTreasuryAccountDailyBalanceActor(
  user: AppAuthContext,
  requestId?: string
): TreasuryAccountDailyBalanceActor {
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

export type TreasuryAccountDailyBalancePreviousClosedPosition = {
  closingId: string;
  civilDate: string;
  observedBalance: string;
};

/**
 * Porta de leitura do fechamento formal anterior (sugestão canônica de
 * abertura). Isolada para permitir teste sem PostgreSQL e contagem de queries.
 */
export type TreasuryAccountDailyBalanceReader = {
  findPreviousClosedPosition(input: {
    accountId: string;
    beforeCivilDate: TreasuryCivilDate;
  }): Promise<TreasuryAccountDailyBalancePreviousClosedPosition | null>;
};

function money(value: { toFixed(d: number): string } | string): string {
  return normalizeTreasuryMoneyString(
    typeof value === "string" ? value : value.toFixed(2)
  );
}

export function createTreasuryAccountDailyBalancePrismaReader(
  prisma: PrismaClient
): TreasuryAccountDailyBalanceReader {
  return {
    /**
     * Mesmo critério de `loadPreviousClosedByAccount` do workspace de
     * abertura (fechamento CLOSED anterior à data, versão mais recente),
     * restrito a uma conta — 1 linha, sem varrer contas.
     */
    async findPreviousClosedPosition({ accountId, beforeCivilDate }) {
      const row = await prisma.treasuryDailyClosingAccountPosition.findFirst({
        where: {
          accountId,
          closing: {
            status: "CLOSED",
            civilDate: { lt: civilDateToLocalDate(beforeCivilDate) },
          },
        },
        select: {
          observedBalance: true,
          closing: { select: { id: true, civilDate: true } },
        },
        orderBy: [
          { closing: { civilDate: "desc" } },
          { closing: { version: "desc" } },
        ],
      });
      if (!row) return null;
      const civil = toCivilDateKey(row.closing.civilDate);
      if (!civil) return null;
      return {
        closingId: row.closing.id,
        civilDate: civil,
        observedBalance: money(row.observedBalance),
      };
    },
  };
}

export type TreasuryAccountDailyBalanceService = {
  getDailyBalance(
    actor: TreasuryAccountDailyBalanceActor,
    accountId: string,
    query: { date?: string | null }
  ): Promise<TreasuryAccountDailyBalanceDto>;
};

export function createTreasuryAccountDailyBalanceService(deps: {
  prisma: PrismaClient;
  accountRepository?: TreasuryAccountRepository;
  balanceRepository?: TreasuryBalanceRepository;
  reader?: TreasuryAccountDailyBalanceReader;
}): TreasuryAccountDailyBalanceService {
  const accountRepo =
    deps.accountRepository ?? createTreasuryAccountRepository(deps.prisma);
  const balanceRepo =
    deps.balanceRepository ?? createTreasuryBalanceRepository(deps.prisma);
  const reader =
    deps.reader ?? createTreasuryAccountDailyBalancePrismaReader(deps.prisma);

  async function listRoutineSnapshots(
    accountId: string,
    civilDate: TreasuryCivilDate,
    kind: TreasuryAccountDailyBalanceRoutineKind
  ): Promise<TreasuryDailyRoutineSnapshotRow[]> {
    const prefix =
      kind === "opening"
        ? `${TREASURY_DAILY_OPENING_SNAPSHOT_KEY_PREFIX}:${civilDate}:`
        : `${TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX}:${civilDate}:`;
    const rows = await balanceRepo.listActiveByIdempotencyPrefix({
      accountId,
      origin: "MANUAL",
      idempotencyKeyPrefix: prefix,
    });
    return rows.map((row) => ({
      idempotencyKey: row.idempotencyKey,
      amount: money(row.availableBalance),
    }));
  }

  return {
    async getDailyBalance(actor, accountId, query) {
      if (!actor.canViewToday && !actor.isSuperAdmin) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar saldos do dia da Tesouraria."
        );
      }

      const id = accountId.trim();
      if (!id) {
        throw new TreasuryDomainError(
          "REQUIRED_FIELD",
          "Informe a conta financeira.",
          "accountId"
        );
      }

      const civilDate =
        query.date == null || query.date === ""
          ? todayTreasuryCivilDateInSaoPaulo()
          : parseTreasuryCivilDate(query.date, "date");

      // Autoriza a conta pedida — não lista todas as contas para filtrar.
      const account = await accountRepo.findById(id);
      if (!account) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Conta financeira não encontrada."
        );
      }
      const access = await accountRepo.findAccess(id, actor.userId);
      if (!canTreasuryActorViewAccountBalance(actor, access)) {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para consultar saldos desta conta."
        );
      }

      const [openingSnapshots, closingSnapshots, previousClosedPosition] =
        await Promise.all([
          listRoutineSnapshots(id, civilDate, "opening"),
          listRoutineSnapshots(id, civilDate, "closingBank"),
          reader.findPreviousClosedPosition({
            accountId: id,
            beforeCivilDate: civilDate,
          }),
        ]);

      return buildTreasuryAccountDailyBalanceDto({
        accountId: account.id,
        accountCode: account.code,
        accountName: account.name,
        bank: account.institutionName,
        isActive: account.isActive,
        civilDate,
        openingSnapshots,
        closingSnapshots,
        previousClosedPosition,
      });
    },
  };
}
