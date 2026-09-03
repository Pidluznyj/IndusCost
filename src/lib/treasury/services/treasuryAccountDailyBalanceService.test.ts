/**
 * Leitura leve de saldo do dia por conta — permissões, custo e semântica.
 *
 * Sem PostgreSQL: repositório de saldo em memória + portas instrumentadas,
 * o que também serve de evidência de custo (contagem de chamadas).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type {
  TreasuryAccountAccessRow,
  TreasuryAccountRow,
} from "../mappers/treasuryAccountMappers.js";
import type { TreasuryAccountRepository } from "../repositories/treasuryAccountRepository.server.js";
import {
  createEmptyTreasuryBalanceMemoryStore,
  createMemoryTreasuryBalanceRepository,
} from "../repositories/treasuryBalanceRepository.memory.js";
import {
  createTreasuryAccountDailyBalanceService,
  type TreasuryAccountDailyBalanceActor,
  type TreasuryAccountDailyBalanceReader,
} from "./treasuryAccountDailyBalanceService.server.js";

const CIVIL = "2026-09-03" as const;
const ACCOUNT_ID = "acc-1";
const OTHER_ACCOUNT_ID = "acc-2";
const USER_ID = "user-1";

type Counters = {
  findById: number;
  findAccess: number;
  list: number;
  listAccessForUser: number;
  previousClosed: number;
  snapshotQueries: number;
};

function accountRow(over: Partial<TreasuryAccountRow> = {}): TreasuryAccountRow {
  return {
    id: ACCOUNT_ID,
    companyCode: "01",
    companyName: "Lazarios",
    code: "CX",
    name: "Caixa Itaú",
    institutionName: "Itaú",
    institutionCode: "341",
    accountType: "CHECKING",
    currency: "BRL",
    agencyMasked: "****1",
    accountNumberMasked: "****9",
    includeInConsolidated: true,
    minimumBalance: "0.00",
    allowNegativeBalance: false,
    liquidity: "IMMEDIATE",
    defaultBalanceOrigin: "MANUAL",
    sortOrder: 1,
    nomusBankAccountId: null,
    isActive: true,
    createdByUserId: USER_ID,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deactivatedAt: null,
    deactivatedByUserId: null,
    deactivationReason: null,
    ...over,
  };
}

function accessRow(
  over: Partial<TreasuryAccountAccessRow> = {}
): TreasuryAccountAccessRow {
  return {
    id: "access-1",
    accountId: ACCOUNT_ID,
    userId: USER_ID,
    accessLevel: "VIEW",
    canViewBalance: true,
    canMutateBalance: false,
    isActive: true,
    grantedByUserId: null,
    grantedAt: new Date("2026-01-01T00:00:00.000Z"),
    revokedAt: null,
    notes: null,
    ...over,
  };
}

function actor(
  over: Partial<TreasuryAccountDailyBalanceActor> = {}
): TreasuryAccountDailyBalanceActor {
  return {
    userId: USER_ID,
    userName: "Operador",
    role: "USER",
    sessionId: "s-1",
    requestId: "r-1",
    isSuperAdmin: false,
    canViewAccounts: true,
    canManageAccounts: false,
    canManageBalances: false,
    canViewToday: true,
    ...over,
  };
}

function buildHarness(input?: {
  accounts?: TreasuryAccountRow[];
  access?: TreasuryAccountAccessRow | null;
  snapshots?: Array<{
    accountId: string;
    key: string;
    amount: string;
    cancelled?: boolean;
  }>;
  previousClosed?: {
    closingId: string;
    civilDate: string;
    observedBalance: string;
  } | null;
}) {
  const counters: Counters = {
    findById: 0,
    findAccess: 0,
    list: 0,
    listAccessForUser: 0,
    previousClosed: 0,
    snapshotQueries: 0,
  };

  const accounts = input?.accounts ?? [accountRow()];
  const store = createEmptyTreasuryBalanceMemoryStore();
  for (const snap of input?.snapshots ?? []) {
    store.snapshots.push({
      id: `snap-${store.snapshots.length + 1}`,
      accountId: snap.accountId,
      referenceAt: new Date("2026-09-03T10:00:00.000Z"),
      availableBalance: snap.amount,
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      origin: "MANUAL",
      idempotencyKey: snap.key,
      notes: null,
      attachmentUrl: null,
      createdByUserId: USER_ID,
      previousSnapshotId: null,
      // createdAt crescente para que "mais recente primeiro" seja determinístico.
      createdAt: new Date(
        Date.UTC(2026, 8, 3, 10, 0, store.snapshots.length)
      ),
      cancelledAt: snap.cancelled ? new Date("2026-09-03T11:00:00.000Z") : null,
      cancelledByUserId: snap.cancelled ? USER_ID : null,
      cancelReason: snap.cancelled ? "teste" : null,
    });
  }

  const memoryBalanceRepo = createMemoryTreasuryBalanceRepository(store);
  const balanceRepository = {
    ...memoryBalanceRepo,
    async listActiveByIdempotencyPrefix(
      args: Parameters<typeof memoryBalanceRepo.listActiveByIdempotencyPrefix>[0]
    ) {
      counters.snapshotQueries += 1;
      return memoryBalanceRepo.listActiveByIdempotencyPrefix(args);
    },
  };

  const accountRepository = {
    async findById(id: string) {
      counters.findById += 1;
      return accounts.find((a) => a.id === id) ?? null;
    },
    async findAccess(accountId: string, userId: string) {
      counters.findAccess += 1;
      const access = input?.access === undefined ? accessRow() : input.access;
      if (!access) return null;
      if (access.accountId !== accountId || access.userId !== userId) {
        return null;
      }
      return access;
    },
    async list() {
      counters.list += 1;
      throw new Error("leitura por conta não deve listar todas as contas");
    },
    async listAccessForUser() {
      counters.listAccessForUser += 1;
      throw new Error("leitura por conta não deve varrer acessos em lote");
    },
  } as unknown as TreasuryAccountRepository;

  const reader: TreasuryAccountDailyBalanceReader = {
    async findPreviousClosedPosition() {
      counters.previousClosed += 1;
      return input?.previousClosed ?? null;
    },
  };

  const service = createTreasuryAccountDailyBalanceService({
    prisma: {} as PrismaClient,
    accountRepository,
    balanceRepository,
    reader,
  });

  return { service, counters };
}

describe("treasuryAccountDailyBalanceService", () => {
  it("devolve saldo inicial e final gravados com as versões da rotina", async () => {
    const { service } = buildHarness({
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v1`,
          amount: "125699.11",
        },
        {
          accountId: ACCOUNT_ID,
          key: `daily-closing-bank:${CIVIL}:v2`,
          amount: "130000.00",
        },
      ],
    });

    const dto = await service.getDailyBalance(actor(), ACCOUNT_ID, {
      date: CIVIL,
    });

    assert.equal(dto.ok, true);
    assert.equal(dto.accountId, ACCOUNT_ID);
    assert.equal(dto.civilDate, CIVIL);
    assert.equal(dto.opening.exists, true);
    assert.equal(dto.opening.amount, "125699.11");
    assert.equal(dto.opening.expectedVersion, 1);
    assert.equal(dto.closing.exists, true);
    assert.equal(dto.closing.amount, "130000.00");
    assert.equal(dto.closing.expectedVersion, 2);
  });

  it("saldo inexistente: exists=false, valor null e sugestão canônica", async () => {
    const { service } = buildHarness({
      previousClosed: {
        closingId: "c-1",
        civilDate: "2026-09-02",
        observedBalance: "980.00",
      },
    });

    const dto = await service.getDailyBalance(actor(), ACCOUNT_ID, {
      date: CIVIL,
    });

    assert.equal(dto.opening.exists, false);
    assert.equal(dto.opening.amount, null);
    assert.equal(dto.opening.suggestedBalance, "980.00");
    assert.equal(dto.closing.exists, false);
    assert.equal(dto.closing.amount, null);
    assert.equal(dto.closing.expectedVersion, 0);
  });

  it("é O(1) em contas: nunca lista todas as contas nem faz N+1 de acesso", async () => {
    const { service, counters } = buildHarness({
      accounts: [
        accountRow(),
        accountRow({ id: OTHER_ACCOUNT_ID, code: "BB", name: "Banco do Brasil" }),
        accountRow({ id: "acc-3", code: "SA", name: "Santander" }),
      ],
      snapshots: [
        {
          accountId: OTHER_ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v7`,
          amount: "1.00",
        },
      ],
    });

    await service.getDailyBalance(actor(), ACCOUNT_ID, { date: CIVIL });

    assert.equal(counters.list, 0, "não deve listar contas");
    assert.equal(counters.listAccessForUser, 0, "não deve varrer acessos");
    assert.equal(counters.findById, 1, "uma conta");
    assert.equal(counters.findAccess, 1, "um acesso");
    assert.equal(counters.snapshotQueries, 2, "abertura + fechamento");
    assert.equal(counters.previousClosed, 1, "um fechamento anterior");
  });

  it("não mistura snapshot de outra conta", async () => {
    const { service } = buildHarness({
      snapshots: [
        {
          accountId: OTHER_ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v9`,
          amount: "77777.77",
        },
      ],
    });

    const dto = await service.getDailyBalance(actor(), ACCOUNT_ID, {
      date: CIVIL,
    });

    assert.equal(dto.opening.exists, false);
    assert.equal(dto.opening.amount, null);
  });

  it("não mistura snapshot de outra data", async () => {
    const { service } = buildHarness({
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: "daily-opening:2026-09-02:v3",
          amount: "55555.55",
        },
      ],
    });

    const dto = await service.getDailyBalance(actor(), ACCOUNT_ID, {
      date: CIVIL,
    });

    assert.equal(dto.opening.exists, false);
    assert.equal(dto.opening.expectedVersion, 0);
  });

  it("snapshot cancelado não conta como saldo informado", async () => {
    const active = buildHarness({
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v1`,
          amount: "123.45",
        },
      ],
    });
    const dtoActive = await active.service.getDailyBalance(actor(), ACCOUNT_ID, {
      date: CIVIL,
    });
    assert.equal(dtoActive.opening.exists, true);
    assert.equal(dtoActive.opening.amount, "123.45");

    const cancelled = buildHarness({
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v1`,
          amount: "123.45",
          cancelled: true,
        },
      ],
    });
    const dtoCancelled = await cancelled.service.getDailyBalance(
      actor(),
      ACCOUNT_ID,
      { date: CIVIL }
    );
    assert.equal(dtoCancelled.opening.exists, false);
    assert.equal(dtoCancelled.opening.amount, null);
    assert.equal(dtoCancelled.opening.expectedVersion, 0);
  });

  it("corrigir saldo usa a versão mais recente, não a primeira gravada", async () => {
    const { service } = buildHarness({
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v1`,
          amount: "100.00",
        },
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v2`,
          amount: "200.00",
        },
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v3`,
          amount: "300.00",
        },
      ],
    });
    const dto = await service.getDailyBalance(actor(), ACCOUNT_ID, {
      date: CIVIL,
    });
    assert.equal(dto.opening.amount, "300.00");
    assert.equal(dto.opening.expectedVersion, 3);
  });

  it("conta inexistente devolve NOT_FOUND sem consultar saldo", async () => {
    const { service, counters } = buildHarness();
    await assert.rejects(
      () => service.getDailyBalance(actor(), "nao-existe", { date: CIVIL }),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "NOT_FOUND");
        return true;
      }
    );
    assert.equal(counters.snapshotQueries, 0);
    assert.equal(counters.findAccess, 0);
  });

  it("usuário sem grant na conta não lê o saldo (FORBIDDEN)", async () => {
    const { service, counters } = buildHarness({ access: null });
    await assert.rejects(
      () => service.getDailyBalance(actor(), ACCOUNT_ID, { date: CIVIL }),
      (err: unknown) => {
        assert.ok(err instanceof TreasuryDomainError);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      }
    );
    assert.equal(counters.snapshotQueries, 0, "não consulta saldo sem acesso");
  });

  it("grant sem canViewBalance não lê o saldo", async () => {
    const { service } = buildHarness({
      access: accessRow({ canViewBalance: false }),
    });
    await assert.rejects(
      () => service.getDailyBalance(actor(), ACCOUNT_ID, { date: CIVIL }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });

  it("grant revogado não lê o saldo", async () => {
    const { service } = buildHarness({
      access: accessRow({ isActive: false, revokedAt: new Date() }),
    });
    await assert.rejects(
      () => service.getDailyBalance(actor(), ACCOUNT_ID, { date: CIVIL }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });

  it("sem canViewToday e sem SUPER_ADMIN é FORBIDDEN antes de qualquer query", async () => {
    const { service, counters } = buildHarness();
    await assert.rejects(
      () =>
        service.getDailyBalance(
          actor({ canViewToday: false }),
          ACCOUNT_ID,
          { date: CIVIL }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
    assert.equal(counters.findById, 0);
    assert.equal(counters.snapshotQueries, 0);
  });

  it("SUPER_ADMIN lê qualquer conta, inclusive sem grant", async () => {
    const { service } = buildHarness({
      access: null,
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: `daily-opening:${CIVIL}:v1`,
          amount: "10.00",
        },
      ],
    });
    const dto = await service.getDailyBalance(
      actor({ isSuperAdmin: true, role: "SUPER_ADMIN" }),
      ACCOUNT_ID,
      { date: CIVIL }
    );
    assert.equal(dto.opening.amount, "10.00");
  });

  it("SUPER_ADMIN pode ler data passada pela mesma rota", async () => {
    const { service } = buildHarness({
      access: null,
      snapshots: [
        {
          accountId: ACCOUNT_ID,
          key: "daily-opening:2026-08-01:v1",
          amount: "42.00",
        },
      ],
    });
    const dto = await service.getDailyBalance(
      actor({ isSuperAdmin: true, role: "SUPER_ADMIN" }),
      ACCOUNT_ID,
      { date: "2026-08-01" }
    );
    assert.equal(dto.civilDate, "2026-08-01");
    assert.equal(dto.opening.amount, "42.00");
  });

  it("data inválida é rejeitada", async () => {
    const { service } = buildHarness();
    await assert.rejects(() =>
      service.getDailyBalance(actor(), ACCOUNT_ID, { date: "03/09/2026" })
    );
  });

  it("accountId vazio é rejeitado", async () => {
    const { service } = buildHarness();
    await assert.rejects(
      () => service.getDailyBalance(actor(), "   ", { date: CIVIL }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "REQUIRED_FIELD"
    );
  });
});
