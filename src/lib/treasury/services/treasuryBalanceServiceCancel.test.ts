/**
 * Excluir (cancelar) saldo informado precisa ser SUPER_ADMIN — o registro
 * some de todos os cálculos (cancelledAt não nulo, todo consumidor filtra
 * cancelledAt IS NULL), então essa ação é mais sensível que criar.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "../repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryBalanceMemoryStore,
  createMemoryTreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.memory.js";
import { createTreasuryBalanceService } from "./treasuryBalanceService.server.js";
import { createTreasuryAccountService } from "./treasuryAccountService.server.js";
import type { TreasuryAuditDb } from "./treasuryAuditService.server.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryAccountActor } from "../domain/treasuryAccountRules.js";

function createHarness() {
  const accountStore = createEmptyTreasuryAccountMemoryStore();
  const balanceStore = createEmptyTreasuryBalanceMemoryStore();
  const accountRepository = createMemoryTreasuryAccountRepository(accountStore);
  const balanceRepository = createMemoryTreasuryBalanceRepository(balanceStore);
  const audits: Array<Record<string, unknown>> = [];

  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `audit-${audits.length + 1}`, ...args.data };
        audits.push(row);
        return row;
      },
    },
  } as unknown as TreasuryAuditDb;

  const runTransaction = async <T>(fn: (tx: TreasuryAuditDb) => Promise<T>) =>
    fn(fakeTx);

  const accountService = createTreasuryAccountService({
    prisma: {} as PrismaClient,
    repository: accountRepository,
    runTransaction,
  });
  const balanceService = createTreasuryBalanceService({
    prisma: {} as PrismaClient,
    accountRepository,
    balanceRepository,
    runTransaction: runTransaction as never,
  });

  return { accountService, balanceService, audits };
}

const superAdmin: TreasuryAccountActor = {
  userId: "super-1",
  userName: "Super",
  role: "SUPER_ADMIN",
  isSuperAdmin: true,
  canViewAccounts: true,
  canManageAccounts: true,
  canManageBalances: true,
  sessionId: "sess-s",
  requestId: "req-s",
};

const admin: TreasuryAccountActor = {
  userId: "admin-1",
  userName: "Admin",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewAccounts: true,
  canManageAccounts: true,
  canManageBalances: true,
  sessionId: "sess-a",
  requestId: "req-a",
};

async function seedAccountWithSnapshot(
  h: ReturnType<typeof createHarness>
) {
  const account = await h.accountService.createAccount(superAdmin, {
    companyCode: "LZ",
    code: "CC01",
    name: "Conta",
    institutionName: "Banco",
    accountType: "CHECKING",
    agencyMasked: "****1",
    accountNumberMasked: "****99",
  });
  const snapshot = await h.balanceService.createBalanceSnapshot(
    superAdmin,
    account.id,
    {
      referenceAt: "2026-07-20T12:00:00.000Z",
      availableBalance: "1000.00",
      blockedBalance: "100.00",
      idempotencyKey: "seed-1",
    }
  );
  return { account, snapshot: snapshot.snapshot };
}

describe("treasuryBalanceService — excluir (cancelar) exige SUPER_ADMIN", () => {
  it("ator sem SUPER_ADMIN é barrado (FORBIDDEN), mesmo com canManageBalances", async () => {
    const h = createHarness();
    const { account, snapshot } = await seedAccountWithSnapshot(h);

    await assert.rejects(
      () =>
        h.balanceService.cancelBalanceSnapshot(
          admin,
          account.id,
          snapshot.id,
          { reason: "motivo de teste" }
        ),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "FORBIDDEN");
        assert.match(err.message, /SUPER_ADMIN/);
        return true;
      }
    );

    const stillActive = await h.balanceService.getLatestBalance(
      superAdmin,
      account.id
    );
    assert.equal(stillActive?.id, snapshot.id);
  });

  it("SUPER_ADMIN com motivo curto (< 3 chars) recebe VALIDATION_ERROR", async () => {
    const h = createHarness();
    const { account, snapshot } = await seedAccountWithSnapshot(h);

    await assert.rejects(
      () =>
        h.balanceService.cancelBalanceSnapshot(
          superAdmin,
          account.id,
          snapshot.id,
          { reason: "ok" }
        ),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "VALIDATION_ERROR");
        return true;
      }
    );
  });

  it("SUPER_ADMIN com snapshot inexistente recebe NOT_FOUND", async () => {
    const h = createHarness();
    const { account } = await seedAccountWithSnapshot(h);

    await assert.rejects(
      () =>
        h.balanceService.cancelBalanceSnapshot(
          superAdmin,
          account.id,
          "snap-inexistente",
          { reason: "motivo de teste" }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "NOT_FOUND"
    );
  });

  it("SUPER_ADMIN cancela com sucesso: some do saldo atual e fica auditado", async () => {
    const h = createHarness();
    const { account, snapshot } = await seedAccountWithSnapshot(h);

    const cancelled = await h.balanceService.cancelBalanceSnapshot(
      superAdmin,
      account.id,
      snapshot.id,
      { reason: "duplicidade de lançamento" }
    );

    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancelledByUserId, superAdmin.userId);
    assert.equal(cancelled.cancelReason, "duplicidade de lançamento");

    const latest = await h.balanceService.getLatestBalance(
      superAdmin,
      account.id
    );
    assert.equal(latest, null);

    assert.ok(
      h.audits.some(
        (a) => a.entityId === snapshot.id && a.entityType === "BALANCE_SNAPSHOT"
      )
    );
  });

  it("cancelar um snapshot já cancelado retorna CONFLICT", async () => {
    const h = createHarness();
    const { account, snapshot } = await seedAccountWithSnapshot(h);

    await h.balanceService.cancelBalanceSnapshot(
      superAdmin,
      account.id,
      snapshot.id,
      { reason: "primeira exclusão" }
    );

    await assert.rejects(
      () =>
        h.balanceService.cancelBalanceSnapshot(
          superAdmin,
          account.id,
          snapshot.id,
          { reason: "segunda tentativa" }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });
});
