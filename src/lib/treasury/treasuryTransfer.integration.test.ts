import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryAccountMemoryStore,
  createMemoryTreasuryAccountRepository,
} from "./repositories/treasuryAccountRepository.memory.js";
import {
  createEmptyTreasuryTransferMemoryStore,
  createMemoryTreasuryTransferRepository,
} from "./repositories/treasuryTransferRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "./services/treasuryProjectionRecalc.server.js";
import {
  createTreasuryTransferService,
  type TreasuryTransferActor,
} from "./services/treasuryTransferService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  buildTransferProjectionMovements,
} from "./domain/treasuryProjectionEngine.js";
import { toTreasuryProjectionTransferSeed } from "./mappers/treasuryTransferMappers.js";

function accountRow(
  id: string,
  code: string,
  companyCode = "EMP1"
): Parameters<
  ReturnType<typeof createMemoryTreasuryAccountRepository>["create"]
>[0] {
  return {
    companyCode,
    companyName: null,
    code,
    name: code,
    institutionName: "Bank",
    institutionCode: null,
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "**1",
    accountNumberMasked: "**99",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 0,
    nomusBankAccountId: null,
    createdByUserId: "user-admin",
  };
}

const actor: TreasuryTransferActor = {
  userId: "user-ops",
  userName: "Operador",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewTransfers: true,
  canManageTransfers: true,
  canViewAccounts: true,
  canManageAccounts: true,
  sessionId: "sess-t",
  requestId: "req-t-1",
};

async function createHarness() {
  const accountStore = createEmptyTreasuryAccountMemoryStore();
  const accountRepo = createMemoryTreasuryAccountRepository(accountStore);
  const from = await accountRepo.create(accountRow("will-be-replaced", "CXA"));
  const to = await accountRepo.create(accountRow("will-be-replaced-2", "CC"));
  // recreate with fixed ids by mutating store
  accountStore.accounts[0]!.id = "acc-from";
  accountStore.accounts[1]!.id = "acc-to";
  const fromId = "acc-from";
  const toId = "acc-to";

  accountStore.access.push(
    {
      id: "access-from",
      accountId: fromId,
      userId: actor.userId,
      accessLevel: "OPERATE",
      canViewBalance: true,
      canMutateBalance: true,
      isActive: true,
      grantedByUserId: null,
      grantedAt: new Date(),
      revokedAt: null,
      notes: null,
    },
    {
      id: "access-to",
      accountId: toId,
      userId: actor.userId,
      accessLevel: "OPERATE",
      canViewBalance: true,
      canMutateBalance: true,
      isActive: true,
      grantedByUserId: null,
      grantedAt: new Date(),
      revokedAt: null,
      notes: null,
    }
  );

  const transferStore = createEmptyTreasuryTransferMemoryStore();
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

  clearTreasuryProjectionRecalcRequests();

  const service = createTreasuryTransferService({
    prisma: {} as PrismaClient,
    accountRepository: accountRepo,
    transferRepository: createMemoryTreasuryTransferRepository(transferStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, transferStore, fromId, toId, from, to };
}

describe("treasuryTransfer — integração", () => {
  it("cria prevista, audita e solicita recálculo", async () => {
    const { service, audits, fromId, toId } = await createHarness();
    const created = await service.create(actor, {
      fromAccountId: fromId,
      toAccountId: toId,
      civilDate: "2026-08-10",
      amount: "250.00",
      memo: "Repasse",
      status: "FORECAST",
    });
    assert.equal(created.transfer.status, "FORECAST");
    assert.equal(created.transfer.amount, "250.00");
    assert.equal(created.transfer.fundsInTransit, false);
    assert.equal(created.projectionRecalc.accepted, true);
    assert.equal(audits[0]?.entityType, "TRANSFER");
    assert.equal(audits[0]?.action, "CREATE");
    assert.ok(
      listTreasuryProjectionRecalcRequests().some(
        (r) => r.reason === "transfer_created"
      )
    );
  });

  it("ciclo send→receive: em trânsito só na saída; consolidado 0 ao receber", async () => {
    const { service, transferStore, fromId, toId } = await createHarness();
    const created = await service.create(actor, {
      fromAccountId: fromId,
      toAccountId: toId,
      civilDate: "2026-08-10",
      amount: "100.00",
      memo: null,
      status: "SCHEDULED",
    });

    const sent = await service.send(actor, created.transfer.id, {
      expectedVersion: created.transfer.version,
      civilDate: "2026-08-11",
    });
    assert.equal(sent.transfer.status, "SENT");
    assert.equal(sent.transfer.fundsInTransit, true);

    const seedSent = toTreasuryProjectionTransferSeed(transferStore.rows[0]!);
    const movSent = buildTransferProjectionMovements({
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      transfers: [seedSent],
      knownAccountIds: new Set([fromId, toId]),
    });
    assert.equal(movSent.movements.length, 1);
    assert.equal(movSent.movements[0]?.direction, "OUTFLOW");
    assert.ok(
      movSent.skipped.some((s) => s.reason.includes("em trânsito"))
    );

    const received = await service.receive(actor, sent.transfer.id, {
      expectedVersion: sent.transfer.version,
      civilDate: "2026-08-12",
    });
    assert.equal(received.transfer.status, "RECEIVED");
    assert.equal(received.transfer.fundsInTransit, false);

    const seedRecv = toTreasuryProjectionTransferSeed(transferStore.rows[0]!);
    const movRecv = buildTransferProjectionMovements({
      periodFrom: "2026-08-01",
      periodTo: "2026-08-31",
      transfers: [seedRecv],
      knownAccountIds: new Set([fromId, toId]),
    });
    assert.equal(movRecv.movements.length, 2);
    const net = movRecv.movements.reduce((acc, m) => {
      return m.direction === "INFLOW" ? acc + 100 : acc - 100;
    }, 0);
    assert.equal(net, 0);
  });

  it("cancelamento exige justificativa auditada e para de projetar", async () => {
    const { service, audits, transferStore, fromId, toId } =
      await createHarness();
    const created = await service.create(actor, {
      fromAccountId: fromId,
      toAccountId: toId,
      civilDate: "2026-08-10",
      amount: "50.00",
      memo: null,
    });
    const cancelled = await service.cancel(actor, created.transfer.id, {
      expectedVersion: created.transfer.version,
      justification: "Duplicada",
    });
    assert.equal(cancelled.transfer.status, "CANCELLED");
    assert.equal(cancelled.transfer.cancellationReason, "Duplicada");
    assert.ok(
      audits.some(
        (a) =>
          a.action === "UPDATE" &&
          (a.metadataJson as { auditedCancellation?: boolean })
            ?.auditedCancellation === true
      )
    );
    const seed = toTreasuryProjectionTransferSeed(transferStore.rows[0]!);
    assert.equal(seed.isCancelled, true);
  });

  it("bloqueia mesma conta e usuário sem manage", async () => {
    const { service, fromId, toId } = await createHarness();
    await assert.rejects(
      () =>
        service.create(actor, {
          fromAccountId: fromId,
          toAccountId: fromId,
          civilDate: "2026-08-10",
          amount: "10.00",
          memo: null,
        }),
      TreasuryDomainError
    );
    const viewer: TreasuryTransferActor = {
      ...actor,
      canManageTransfers: false,
    };
    await assert.rejects(
      () =>
        service.create(viewer, {
          fromAccountId: fromId,
          toAccountId: toId,
          civilDate: "2026-08-10",
          amount: "10.00",
          memo: null,
        }),
      TreasuryDomainError
    );
  });
});
