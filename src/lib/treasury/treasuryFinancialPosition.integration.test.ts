import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { TreasuryAccountActor } from "./domain/treasuryAccountRules.js";
import type { TreasuryAccountRow } from "./mappers/treasuryAccountMappers.js";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "./repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryBalanceMemoryStore,
  createMemoryTreasuryBalanceRepository,
} from "./repositories/treasuryBalanceRepository.memory.js";
import {
  createEmptyOfficialRealizedMovementMemoryStore,
  createMemoryTreasuryOfficialRealizedMovementRepository,
} from "./repositories/treasuryOfficialRealizedMovementRepository.server.js";
import {
  createEmptyReconciledBalanceMemoryStore,
  createMemoryTreasuryReconciledBalanceRepository,
} from "./repositories/treasuryReconciledBalanceRepository.server.js";
import { createTreasuryFinancialPositionService } from "./services/treasuryFinancialPositionService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

function accountRow(
  partial: Partial<TreasuryAccountRow> &
    Pick<TreasuryAccountRow, "id" | "code" | "name">
): TreasuryAccountRow {
  const now = new Date("2026-07-01T00:00:00.000Z");
  return {
    companyCode: "LAZARIOS",
    companyName: "Lazarios",
    institutionName: "Banco",
    institutionCode: null,
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "****",
    accountNumberMasked: "****",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: true,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: "admin-1",
    createdAt: now,
    updatedAt: now,
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
    ...partial,
  };
}

const admin: TreasuryAccountActor = {
  userId: "admin-1",
  userName: "Admin",
  role: "ADMIN",
  isSuperAdmin: true,
  canViewAccounts: true,
  canManageAccounts: true,
  canManageBalances: true,
};

const viewerDenied: TreasuryAccountActor = {
  userId: "v1",
  role: "VIEWER",
  isSuperAdmin: false,
  canViewAccounts: false,
  canManageAccounts: false,
};

function createHarness() {
  const accountStore = createEmptyTreasuryAccountMemoryStore();
  const balanceStore = createEmptyTreasuryBalanceMemoryStore();
  const movementStore = createEmptyOfficialRealizedMovementMemoryStore();
  const reconciledStore = createEmptyReconciledBalanceMemoryStore();

  accountStore.accounts.push(
    accountRow({
      id: "acc-cash",
      code: "CX01",
      name: "Caixa",
      sortOrder: 1,
      includeInConsolidated: true,
    }),
    accountRow({
      id: "acc-inv",
      code: "APL01",
      name: "Aplicação",
      accountType: "INVESTMENT",
      liquidity: "D_PLUS_1",
      sortOrder: 2,
      includeInConsolidated: true,
    }),
    accountRow({
      id: "acc-out",
      code: "ESC01",
      name: "Escrow fora",
      sortOrder: 3,
      includeInConsolidated: false,
    }),
    accountRow({
      id: "acc-empty",
      code: "NEW01",
      name: "Sem saldo",
      sortOrder: 4,
      includeInConsolidated: true,
      allowNegativeBalance: false,
    }),
    accountRow({
      id: "acc-neg",
      code: "NEG01",
      name: "Negativa",
      sortOrder: 5,
      includeInConsolidated: true,
      allowNegativeBalance: false,
    })
  );

  const now = new Date("2026-07-20T12:00:00.000Z");
  balanceStore.snapshots.push(
    {
      id: "snap-cash",
      accountId: "acc-cash",
      referenceAt: now,
      availableBalance: "100.00",
      blockedBalance: "20.00",
      investmentsBalance: "0.00",
      usedLimit: "5.00",
      origin: "MANUAL",
      idempotencyKey: "k-cash",
      notes: null,
      attachmentUrl: null,
      createdByUserId: "admin-1",
      previousSnapshotId: null,
      createdAt: now,
    },
    {
      id: "snap-inv",
      accountId: "acc-inv",
      referenceAt: now,
      availableBalance: "0.00",
      blockedBalance: "0.00",
      investmentsBalance: "500.00",
      usedLimit: "0.00",
      origin: "MANUAL",
      idempotencyKey: "k-inv",
      notes: null,
      attachmentUrl: null,
      createdByUserId: "admin-1",
      previousSnapshotId: null,
      createdAt: now,
    },
    {
      id: "snap-out",
      accountId: "acc-out",
      referenceAt: now,
      availableBalance: "1000.00",
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      origin: "MANUAL",
      idempotencyKey: "k-out",
      notes: null,
      attachmentUrl: null,
      createdByUserId: "admin-1",
      previousSnapshotId: null,
      createdAt: now,
    },
    {
      id: "snap-neg",
      accountId: "acc-neg",
      referenceAt: now,
      availableBalance: "-40.00",
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      origin: "MANUAL",
      idempotencyKey: "k-neg",
      notes: null,
      attachmentUrl: null,
      createdByUserId: "admin-1",
      previousSnapshotId: null,
      createdAt: now,
    }
  );

  movementStore.movements.push({
    id: "mov-1",
    accountId: "acc-cash",
    occurredAt: new Date("2026-07-21T09:00:00.000Z"),
    amount: "30.00",
    direction: "DEBIT",
    status: "ACTIVE",
    source: "OFFICIAL_SETTLEMENT",
  });

  const service = createTreasuryFinancialPositionService({
    prisma: {} as PrismaClient,
    accountRepository: createMemoryTreasuryAccountRepository(accountStore),
    balanceRepository: createMemoryTreasuryBalanceRepository(balanceStore),
    movementRepository:
      createMemoryTreasuryOfficialRealizedMovementRepository(movementStore),
    reconciledRepository:
      createMemoryTreasuryReconciledBalanceRepository(reconciledStore),
  });

  return { service, reconciledStore };
}

describe("treasuryFinancialPosition — integração", () => {
  it("posição multi-conta: consolidado, fora do consolidado, aplicação, bloqueado, negativo e ausência", async () => {
    const { service } = createHarness();
    const pos = await service.getCurrentPosition(admin, {
      companyCode: "LAZARIOS",
    });

    assert.equal(pos.accounts.length, 5);

    const cash = pos.accounts.find((a) => a.accountId === "acc-cash")!;
    assert.equal(cash.observedBalance, "120.00");
    assert.equal(cash.operationalAvailableBalance, "100.00");
    assert.equal(cash.blockedBalance, "20.00");
    assert.equal(cash.usedLimit, "5.00");
    assert.equal(cash.calculatedBalance, "90.00");
    assert.equal(cash.divergence, "30.00");
    assert.equal(cash.hasDivergence, true);
    assert.equal(cash.origins.observed.origin, "BALANCE_SNAPSHOT");
    assert.equal(
      cash.origins.calculated.origin,
      "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS"
    );

    const inv = pos.accounts.find((a) => a.accountId === "acc-inv")!;
    assert.equal(inv.investmentsBalance, "500.00");
    assert.equal(inv.liquidity, "D_PLUS_1");
    assert.ok(inv.alerts.some((a) => /liquidez/i.test(a)));

    const out = pos.accounts.find((a) => a.accountId === "acc-out")!;
    assert.equal(out.includeInConsolidated, false);
    assert.equal(out.observedBalance, "1000.00");

    const empty = pos.accounts.find((a) => a.accountId === "acc-empty")!;
    assert.equal(empty.observedBalance, null);
    assert.equal(empty.hasSnapshot, false);
    assert.equal(empty.origins.observed.origin, "MISSING");
    assert.ok(empty.alerts.some((a) => /Ausência de saldo/i.test(a)));

    const neg = pos.accounts.find((a) => a.accountId === "acc-neg")!;
    assert.equal(neg.isNegative, true);
    assert.equal(neg.operationalAvailableBalance, "-40.00");

    // consolidado: cash 120 + inv 500 + empty null + neg -40 = 580; escrow 1000 excluído
    assert.equal(pos.consolidated.excludedAccountCount, 1);
    assert.equal(pos.consolidated.accountsMissingSnapshot, 1);
    assert.equal(pos.consolidated.observedBalance, "580.00");
    assert.ok(
      pos.consolidated.alerts.some((a) => /fora do consolidado/i.test(a))
    );
    assert.ok(pos.alerts.some((a) => /Divergência/i.test(a) || /ausente/i.test(a)));
  });

  it("nega sem permissão de view", async () => {
    const { service } = createHarness();
    await assert.rejects(
      () => service.getCurrentPosition(viewerDenied),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
