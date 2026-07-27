import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "./repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryBalanceMemoryStore,
  createMemoryTreasuryBalanceRepository,
} from "./repositories/treasuryBalanceRepository.memory.js";
import { createTreasuryBalanceService } from "./services/treasuryBalanceService.server.js";
import { createTreasuryAccountService } from "./services/treasuryAccountService.server.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryAccountActor } from "./domain/treasuryAccountRules.js";

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

  return { accountService, balanceService, audits, balanceStore };
}

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

const outsider: TreasuryAccountActor = {
  userId: "out-1",
  role: "USER",
  isSuperAdmin: false,
  canViewAccounts: true,
  canManageAccounts: false,
  canManageBalances: true,
};

describe("treasuryBalanceService — integração (memory)", () => {
  it("informa saldo, preserva previous, calcula componentes e audita", async () => {
    const { accountService, balanceService, audits } = createHarness();
    const account = await accountService.createAccount(admin, {
      companyCode: "LZ",
      code: "CC01",
      name: "Conta",
      institutionName: "Banco",
      accountType: "CHECKING",
      agencyMasked: "****1",
      accountNumberMasked: "****99",
    });

    const first = await balanceService.createBalanceSnapshot(admin, account.id, {
      referenceAt: "2026-07-20T12:00:00.000Z",
      availableBalance: "1000.00",
      blockedBalance: "100.00",
      investmentsBalance: "50.00",
      usedLimit: "25.00",
      origin: "MANUAL",
      idempotencyKey: "snap-1",
      justification: "abertura",
    });
    assert.equal(first.created, true);
    assert.equal(first.snapshot.previousSnapshotId, null);
    assert.equal(first.snapshot.operationalAvailableBalance, "1000.00");
    assert.equal(first.snapshot.blockedBalance, "100.00");
    assert.equal(first.snapshot.investmentsBalance, "50.00");
    assert.equal(first.snapshot.usedLimit, "25.00");
    assert.equal(first.snapshot.observedBalance, "1150.00");
    assert.equal(first.snapshot.origin, "MANUAL");
    assert.ok(audits.some((a) => a.action === "CREATE"));

    const second = await balanceService.createBalanceSnapshot(admin, account.id, {
      referenceAt: "2026-07-21T12:00:00.000Z",
      availableBalance: "900.00",
      idempotencyKey: "snap-2",
    });
    assert.equal(second.created, true);
    assert.equal(second.snapshot.previousSnapshotId, first.snapshot.id);

    const latest = await balanceService.getLatestBalance(admin, account.id);
    assert.equal(latest?.id, second.snapshot.id);

    const history = await balanceService.listBalances(admin, account.id, {
      page: 1,
      pageSize: 10,
    });
    assert.equal(history.rows.length, 2);
    assert.equal(history.pagination.totalRows, 2);
  });

  it("idempotência: mesma chave não duplica nem reaudita", async () => {
    const { accountService, balanceService, audits, balanceStore } =
      createHarness();
    const account = await accountService.createAccount(admin, {
      companyCode: "LZ",
      code: "CC02",
      name: "Conta 2",
      institutionName: "Banco",
      accountType: "CHECKING",
      agencyMasked: "****2",
      accountNumberMasked: "****88",
    });

    const a = await balanceService.createBalanceSnapshot(admin, account.id, {
      referenceAt: "2026-07-22T10:00:00.000Z",
      availableBalance: "10.00",
      idempotencyKey: "same-key",
    });
    const auditCount = audits.length;
    const b = await balanceService.createBalanceSnapshot(admin, account.id, {
      referenceAt: "2026-07-22T11:00:00.000Z",
      availableBalance: "999.00",
      idempotencyKey: "same-key",
    });
    assert.equal(b.created, false);
    assert.equal(b.snapshot.id, a.snapshot.id);
    assert.equal(b.snapshot.availableBalance, "10.00");
    assert.equal(balanceStore.snapshots.length, 1);
    assert.equal(audits.length, auditCount);
  });

  it("nega consulta/criação sem autorização na conta", async () => {
    const { accountService, balanceService } = createHarness();
    const account = await accountService.createAccount(admin, {
      companyCode: "LZ",
      code: "CC03",
      name: "Conta 3",
      institutionName: "Banco",
      accountType: "CASH",
      agencyMasked: "****3",
      accountNumberMasked: "****77",
    });

    await assert.rejects(
      () => balanceService.getLatestBalance(outsider, account.id),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
    await assert.rejects(
      () =>
        balanceService.createBalanceSnapshot(outsider, account.id, {
          referenceAt: "2026-07-22T10:00:00.000Z",
          availableBalance: "1.00",
          idempotencyKey: "x",
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
